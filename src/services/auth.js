const crypto = require("node:crypto");
const QRCode = require("qrcode");
const { users, mfa } = require("../repository");
const { MIN_LENGTH, MAX_LENGTH, isAcceptable, hashPassword, verifyPassword } = require("../auth/password");
const { generateSecret, verifyTotp, provisioningUri, generateBackupCodes } = require("../auth/totp");
const { startSession, endSession } = require("../auth/session");
const limits = require("../middleware/rate-limit");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MFA_COOKIE = "rempart_mfa";
const MFA_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE !== "false",
  sameSite: "lax",
  path: "/",
  maxAge: 5 * 60 * 1000,
};

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readMfaCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === MFA_COOKIE) return value;
  }
  return null;
}

function normalizeBackupCode(value) {
  if (typeof value !== "string") return "";
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : "";
}

async function register(ip, body) {
  const email = normalizeEmail(body.email);
  const password = body.password;
  const confirmation = body.confirmation;
  const retryAfter = limits.registerByIp.retryAfter(ip);
  if (retryAfter > 0) return { status: 429, email, error: "Trop de tentatives. Réessayez dans quelques minutes.", retryAfter };
  limits.registerByIp.hit(ip);

  if (!email) return { status: 400, email: "", error: "Adresse e-mail invalide." };
  if (!isAcceptable(password)) return { status: 400, email, error: `Le mot de passe doit faire entre ${MIN_LENGTH} et ${MAX_LENGTH} caractères.` };
  if (password !== confirmation) return { status: 400, email, error: "Les deux mots de passe ne correspondent pas." };

  await users.create(email, await hashPassword(password));
  return { status: 303, email };
}

async function login(ip, body) {
  const email = normalizeEmail(body.email);
  const password = body.password;
  const accountKey = email || "invalid";
  const retryAfter = Math.max(limits.loginByIp.retryAfter(ip), limits.loginByAccount.retryAfter(accountKey));
  if (retryAfter > 0) return { status: 429, email, error: "Trop de tentatives. Réessayez dans quelques minutes.", retryAfter };

  const user = email ? await users.findByEmail(email) : null;
  if (!user || !(await verifyPassword(user.password_hash, password))) {
    limits.loginByIp.hit(ip);
    limits.loginByAccount.hit(accountKey);
    return { status: 401, email, error: "E-mail ou mot de passe incorrect." };
  }

  limits.loginByAccount.reset(accountKey);
  return { status: 200, user };
}

async function createMfaChallenge(req, res, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  await mfa.createChallenge(user.id, hashToken(token));
  res.cookie(MFA_COOKIE, token, MFA_COOKIE_OPTIONS);
}

async function getMfaChallenge(req) {
  const token = readMfaCookie(req);
  return token ? mfa.getChallenge(hashToken(token)) : null;
}

function clearMfaCookie(res) {
  res.clearCookie(MFA_COOKIE, MFA_COOKIE_OPTIONS);
}

async function verifyMfa(ip, req, code) {
  const token = readMfaCookie(req);
  const challenge = token ? await mfa.getChallenge(hashToken(token)) : null;
  if (!challenge) return { status: 404 };

  const accountKey = String(challenge.user_id);
  const retryAfter = Math.max(limits.mfaByIp.retryAfter(ip), limits.mfaByAccount.retryAfter(accountKey));
  if (retryAfter > 0) return { status: 429, retryAfter };

  const credential = await mfa.getCredential(challenge.user_id);
  let authenticated = false;
  if (credential?.enabled) {
    const counter = verifyTotp(credential.secret, code);
    const lastCounter = credential.last_counter === null ? -1 : Number(credential.last_counter);
    if (counter !== null && counter > lastCounter) authenticated = await mfa.updateCounter(challenge.user_id, counter);
  }

  if (!authenticated) {
    const backupCode = normalizeBackupCode(code);
    if (backupCode) {
      for (const row of await mfa.unusedBackupCodes(challenge.user_id)) {
        if (await verifyPassword(row.code_hash, backupCode)) {
          authenticated = await mfa.consumeBackupCode(row.id);
          break;
        }
      }
    }
  }

  if (!authenticated) {
    limits.mfaByIp.hit(ip);
    limits.mfaByAccount.hit(accountKey);
    return { status: 401 };
  }

  limits.mfaByIp.reset(ip);
  limits.mfaByAccount.reset(accountKey);
  const consumed = await mfa.consumeChallenge(hashToken(token));
  return consumed ? { status: 200, userId: consumed.user_id } : { status: 404 };
}

async function getMfaSetup(user) {
  const credential = await mfa.getCredential(user.id);
  if (credential?.enabled) return { enabled: true, qr: null, secret: null, codes: null };
  let secret = credential?.secret;
  if (!secret) {
    secret = generateSecret();
    await mfa.createPending(user.id, secret);
  }
  return { enabled: false, qr: await QRCode.toDataURL(provisioningUri(secret, user.email)), secret, codes: null };
}

async function enableMfa(user, code) {
  const credential = await mfa.getCredential(user.id);
  if (credential?.enabled) return { enabled: true, codes: null };
  if (!credential?.secret) return { status: 400 };
  const counter = verifyTotp(credential.secret, code);
  if (counter === null) return { status: 400 };
  await mfa.enable(user.id, counter);
  const codes = generateBackupCodes(10);
  await mfa.addBackupCodes(user.id, await Promise.all(codes.map((codeValue) => hashPassword(codeValue))));
  return { status: 200, enabled: true, codes };
}

async function disableMfa(user, password) {
  if (!(await verifyPassword(await users.findPasswordHash(user.id), password))) return false;
  await mfa.disable(user.id);
  return true;
}

module.exports = {
  MIN_LENGTH, MAX_LENGTH, MFA_COOKIE_OPTIONS,
  normalizeEmail, register, login, createMfaChallenge, getMfaChallenge, clearMfaCookie,
  verifyMfa, getMfaSetup, enableMfa, disableMfa, startSession, endSession,
};
