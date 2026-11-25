const express = require("express");
const accountService = require("../services/account");
const { clearSessionCookie } = require("../auth/session");
const { log } = require("../lib/errors");

const router = express.Router();

async function renderAccount(req, res, { status = 200, error = null } = {}) {
  const account = await accountService.summary(req.user);
  res.status(status).render("account", {
    title: "Mon compte",
    current: "account",
    account,
    confirmation: accountService.CONFIRMATION,
    error,
  });
}

router.get("/account", (req, res) => renderAccount(req, res));

router.post("/account/delete", async (req, res) => {
  const result = await accountService.deleteAccount(req.user, req.body);
  if (result.retryAfter) res.set("Retry-After", String(result.retryAfter));
  if (result.status !== 303) {
    log("warn", { event: "account.delete_refused", userId: req.user.id, status: result.status });
    return renderAccount(req, res, { status: result.status, error: result.error });
  }
  clearSessionCookie(res);
  log("info", { event: "account.deleted", userId: req.user.id, files: result.files });
  res.redirect(303, "/login?deleted=1");
});

module.exports = router;
