const express = require("express");
const multer = require("multer");
const path = require("node:path");
const filesService = require("../services/files");
const { MAX_SIZE, ACCEPT } = require("../middleware/upload");

const router = express.Router();

const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1, fields: 5, parts: 6 },
}).single("file");

async function renderFiles(req, res, { error = null, status = 200 } = {}) {
  const rows = await filesService.list(req.user.id);
  res.status(status).render("files", { title: "Mes fichiers", current: "files", files: rows, accept: ACCEPT, error });
}

router.get("/files", async (req, res) => {
  await renderFiles(req, res);
});

router.post("/files", (req, res, next) => {
  receive(req, res, async (err) => {
    try {
      if (err instanceof multer.MulterError) {
        const tooLarge = err.code === "LIMIT_FILE_SIZE";
        return await renderFiles(req, res, { status: tooLarge ? 413 : 400, error: tooLarge ? "Fichier trop volumineux (2 Mo maximum)." : "Envoi invalide." });
      }
      if (err) throw err;

      const result = await filesService.upload(req.user.id, req.file);
      if (!result.ok) return await renderFiles(req, res, { status: result.status, error: result.reason });
      res.redirect(303, "/files");
    } catch (error) {
      next(error);
    }
  });
});

router.get("/files/:id", async (req, res, next) => {
  const file = await filesService.getOwned(req.user.id, req.params.id);
  if (!file) return next();
  res.set({ "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" });
  res.attachment(file.original_name);
  res.type(file.mime);
  res.sendFile(path.join(filesService.UPLOAD_DIR, file.id));
});

router.post("/files/:id/delete", async (req, res, next) => {
  const file = await filesService.remove(req.user.id, req.params.id);
  if (!file) return next();
  res.redirect(303, "/files");
});

module.exports = router;
