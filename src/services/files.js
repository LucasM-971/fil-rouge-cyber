const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { files } = require("../repository");
const { checkFile, safeName } = require("../middleware/upload");

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function list(ownerId) {
  return files.findByOwner(ownerId);
}

async function upload(ownerId, file) {
  const check = checkFile(file);
  if (!check.ok) return { ok: false, status: 415, reason: check.reason };

  const id = randomUUID();
  await fs.writeFile(path.join(UPLOAD_DIR, id), file.buffer, { flag: "wx", mode: 0o600 });
  try {
    await files.create(id, ownerId, safeName(file.originalname), check.type.mime, file.size);
  } catch (error) {
    await fs.rm(path.join(UPLOAD_DIR, id), { force: true });
    throw error;
  }
  return { ok: true, id };
}

async function getOwned(ownerId, id) {
  return UUID.test(id) ? files.findOwnedById(id, ownerId) : null;
}

async function remove(ownerId, id) {
  if (!UUID.test(id)) return null;
  const file = await files.removeOwned(id, ownerId);
  if (file) await fs.rm(path.join(UPLOAD_DIR, file.id), { force: true });
  return file;
}

module.exports = { UPLOAD_DIR, UUID, list, upload, getOwned, remove };
