const fs = require("node:fs/promises");
const path = require("node:path");
const { users } = require("../repository");
const { verifyPassword } = require("../auth/password");
const { UPLOAD_DIR, UUID } = require("./files");
const limits = require("../middleware/rate-limit");

const CONFIRMATION = "SUPPRIMER";

async function summary(user) {
  return users.findAccount(user.id);
}

async function deleteAccount(user, body) {
  const retryAfter = limits.loginByAccount.retryAfter(user.email);
  if (retryAfter > 0) return { status: 429, retryAfter, error: "Trop de tentatives. Réessayez dans quelques minutes." };

  if (body.confirmation !== CONFIRMATION) return { status: 400, error: `Tapez ${CONFIRMATION} pour confirmer.` };

  const hash = await users.findPasswordHash(user.id);
  if (!hash || !(await verifyPassword(hash, body.password))) {
    limits.loginByAccount.hit(user.email);
    return { status: 401, error: "Mot de passe incorrect." };
  }

  const { deleted, fileIds } = await users.remove(user.id);
  if (!deleted) return { status: 404, error: "Compte introuvable." };

  const safeIds = fileIds.filter((id) => UUID.test(id));
  await Promise.all(safeIds.map((id) => fs.rm(path.join(UPLOAD_DIR, id), { force: true })));
  limits.loginByAccount.reset(user.email);
  return { status: 303, files: safeIds.length };
}

module.exports = { CONFIRMATION, summary, deleteAccount };
