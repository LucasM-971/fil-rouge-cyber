const express = require("express");
const authService = require("../services/auth");
const { log } = require("../lib/errors");

const router = express.Router();

const LOGIN_FAILED = "E-mail ou mot de passe incorrect.";
const TOO_MANY_ATTEMPTS = "Trop de tentatives. Réessayez dans quelques minutes.";
const DELETED = "Votre compte et toutes vos données ont été supprimés.";
const REGISTERED = "Si cette adresse n'était pas déjà utilisée, votre compte est créé. Vous pouvez vous connecter.";

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function renderLogin(res, { status = 200, email = "", error = null, notice = null } = {}) {
  res.status(status).render("login", { title: "Connexion", current: "login", email, error, notice });
}

function renderRegister(res, { status = 200, email = "", error = null } = {}) {
  res.status(status).render("register", {
    title: "Inscription",
    current: "register",
    email,
    error,
    minLength: authService.MIN_LENGTH,
    maxLength: authService.MAX_LENGTH,
  });
}

function redirectIfSignedIn(req, res, next) {
  if (req.user) return res.redirect(303, "/");
  next();
}

router.get("/login", redirectIfSignedIn, (req, res) => {
  const notice = req.query.registered === "1" ? REGISTERED : req.query.deleted === "1" ? DELETED : null;
  renderLogin(res, { notice });
});

router.post("/login", async (req, res) => {
  const result = await authService.login(req.ip, req.body);
  if (result.retryAfter) {
    log("warn", { event: "auth.login_throttled", email: result.email || null, ip: req.ip });
    res.set("Retry-After", String(result.retryAfter));
    return renderLogin(res, { status: 429, email: result.email, error: result.error });
  }
  if (result.status !== 200) {
    log("warn", { event: "auth.login_failed", email: result.email || null, ip: req.ip });
    return renderLogin(res, { status: result.status, email: result.email, error: result.error });
  }

  if (result.user.totp_enabled) {
    await authService.createMfaChallenge(req, res, result.user);
    log("info", { event: "auth.login_mfa_required", userId: result.user.id, ip: req.ip });
    return res.redirect(303, "/2fa/challenge");
  }

  await authService.startSession(req, res, result.user.id);
  log("info", { event: "auth.login", userId: result.user.id, ip: req.ip });
  res.redirect(303, "/");
});

router.get("/register", redirectIfSignedIn, (req, res) => {
  renderRegister(res);
});

router.post("/register", async (req, res) => {
  const result = await authService.register(req.ip, req.body);
  if (result.retryAfter) res.set("Retry-After", String(result.retryAfter));
  if (result.status !== 303) return renderRegister(res, { status: result.status, email: result.email, error: result.error });
  log("info", { event: "auth.register", email: result.email, ip: req.ip });
  res.redirect(303, "/login?registered=1");
});

router.post("/logout", async (req, res) => {
  await authService.endSession(req, res);
  if (req.user) log("info", { event: "auth.logout", userId: req.user.id });
  res.redirect(303, "/login");
});

router.get("/2fa/challenge", async (req, res) => {
  if (req.user) return res.redirect(303, "/");
  const challenge = await authService.getMfaChallenge(req);
  if (!challenge) {
    authService.clearMfaCookie(res);
    return res.redirect(303, "/login");
  }
  res.status(200).render("mfa-challenge", { title: "Vérification à deux facteurs", current: "login", error: null });
});

router.post("/2fa/challenge", async (req, res) => {
  if (req.user) return res.redirect(303, "/");
  const result = await authService.verifyMfa(req.ip, req, req.body.code);
  if (result.retryAfter) {
    res.set("Retry-After", String(result.retryAfter));
    return res.status(429).render("mfa-challenge", { title: "Vérification à deux facteurs", current: "login", error: TOO_MANY_ATTEMPTS });
  }
  if (result.status === 404) {
    authService.clearMfaCookie(res);
    return res.redirect(303, "/login");
  }
  if (result.status === 401) {
    log("warn", { event: "auth.mfa_failed", ip: req.ip });
    return res.status(401).render("mfa-challenge", { title: "Vérification à deux facteurs", current: "login", error: "Code authentificateur ou code de secours incorrect." });
  }
  authService.clearMfaCookie(res);
  await authService.startSession(req, res, result.userId);
  log("info", { event: "auth.mfa_success", userId: result.userId, ip: req.ip });
  res.redirect(303, "/");
});

router.get("/2fa/setup", async (req, res) => {
  if (!req.user) return res.redirect(303, "/login");
  const setup = await authService.getMfaSetup(req.user);
  res.status(200).render("mfa", { title: "Authentification à deux facteurs", current: "mfa", ...setup, error: null, notice: null });
});

router.post("/2fa/setup", async (req, res) => {
  if (!req.user) return res.redirect(303, "/login");
  const result = await authService.enableMfa(req.user, req.body.code);
  if (result.status === 400) {
    const setup = await authService.getMfaSetup(req.user);
    return res.status(400).render("mfa", { title: "Authentification à deux facteurs", current: "mfa", ...setup, error: "Code invalide. Utilisez le code affiché par votre application.", notice: null });
  }
  res.status(200).render("mfa", { title: "Authentification à deux facteurs", current: "mfa", enabled: true, qr: null, secret: null, codes: result.codes, error: null, notice: "Authentification à deux facteurs activée. Conservez ces codes de secours." });
});

router.post("/2fa/disable", async (req, res) => {
  if (!req.user) return res.redirect(303, "/login");
  const valid = await authService.disableMfa(req.user, req.body.password);
  if (!valid) {
    return res.status(401).render("mfa", { title: "Authentification à deux facteurs", current: "mfa", enabled: true, qr: null, secret: null, codes: null, error: "Mot de passe incorrect.", notice: null });
  }
  res.redirect(303, "/2fa/setup");
});

module.exports = router;
