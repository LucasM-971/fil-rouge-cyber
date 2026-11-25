const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkFile, safeName } = require("../../src/middleware/upload");

test("checkFile refuse les fichiers dont le contenu ne correspond pas à l'extension", () => {
  const result = checkFile({ size: 20, originalname: "image.png", buffer: Buffer.from("<svg></svg>") });
  assert.equal(result.ok, false);
});

test("safeName supprime les séparateurs de chemin et conserve une extension", () => {
  assert.equal(safeName("../../secret.png"), "secret.png");
});
