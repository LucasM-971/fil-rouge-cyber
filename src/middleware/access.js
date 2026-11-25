const { httpError } = require("../lib/errors");

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === "GET" || req.method === "HEAD") return res.redirect(303, "/login");
  next(httpError(401));
}

function requireRole(role) {
  return function checkRole(req, res, next) {
    if (req.user && req.user.role === role) return next();
    next(httpError(403));
  };
}

module.exports = { requireAuth, requireRole };
