const { httpError } = require("../lib/errors");

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  next();
}

function sameOriginOnly(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const site = req.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return next(httpError(403));

  const origin = req.get("Origin");
  if (origin && origin !== `${req.protocol}://${req.get("Host")}`) return next(httpError(403));

  next();
}

module.exports = { securityHeaders, sameOriginOnly };
