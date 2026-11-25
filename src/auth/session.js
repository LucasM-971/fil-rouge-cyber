const { randomBytes, createHash } = require("node:crypto");
const { sessions } = require("../repository");

const COOKIE_NAME = "rempart_sid";
const IDLE_SECONDS = 30 * 60;
const ABSOLUTE_SECONDS = 8 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE !== "false",
  sameSite: "lax",
  path: "/",
};

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function readToken(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value;
  }
  return null;
}

async function loadSession(req, res, next) {
  const token = readToken(req);
  if (!token) return next();

  const session = await sessions.touch(hashToken(token), IDLE_SECONDS);

  if (!session) {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    return next();
  }

  req.user = session;
  res.locals.user = req.user;
  res.set("Cache-Control", "no-store");
  next();
}

async function startSession(req, res, userId) {
  const previous = readToken(req);
  await sessions.removeExpired(previous ? hashToken(previous) : null, IDLE_SECONDS);

  const token = randomBytes(32).toString("base64url");
  await sessions.create(hashToken(token), userId, ABSOLUTE_SECONDS);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ABSOLUTE_SECONDS * 1000 });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

async function endSession(req, res) {
  const token = readToken(req);
  if (token) await sessions.remove(hashToken(token));
  clearSessionCookie(res);
}

module.exports = { loadSession, startSession, endSession, clearSessionCookie };
