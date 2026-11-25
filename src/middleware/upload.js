const path = require("node:path");

const MAX_SIZE = 2 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PDF = Buffer.from("%PDF-", "latin1");

const ALLOWED_TYPES = [
  { mime: "image/png", extensions: [".png"], signature: PNG },
  { mime: "image/jpeg", extensions: [".jpg", ".jpeg"], signature: JPEG },
  { mime: "application/pdf", extensions: [".pdf"], signature: PDF },
];

function detectType(buffer) {
  return ALLOWED_TYPES.find((type) => buffer.subarray(0, type.signature.length).equals(type.signature)) || null;
}

function checkFile(file) {
  if (!file || file.size === 0) {
    return { ok: false, reason: "Aucun fichier reçu." };
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const type = detectType(file.buffer);

  if (!type || !type.extensions.includes(extension)) {
    return { ok: false, reason: "Type de fichier refusé. Formats acceptés : PNG, JPEG, PDF." };
  }

  return { ok: true, type };
}

function safeName(originalName) {
  const base = path.basename(originalName).normalize("NFC");
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "");
  return (cleaned || "fichier").slice(0, 100);
}

module.exports = {
  MAX_SIZE,
  ACCEPT: ALLOWED_TYPES.flatMap((type) => type.extensions).join(","),
  checkFile,
  safeName,
};
