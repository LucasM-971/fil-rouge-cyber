const express = require("express");
const notesService = require("../services/notes");

const router = express.Router();

async function renderNotes(req, res, { q = "", form = { title: "", body: "" }, error = null, status = 200 } = {}) {
  const result = await notesService.list(req.user.id, q);
  res.status(status).render("notes", { title: "Mes notes", current: "notes", notes: result.notes, q: result.q, form, error });
}

function renderNote(res, note, { form = note, error = null, status = 200 } = {}) {
  res.status(status).render("note", { title: note.title, current: "notes", note, form, error });
}

router.get("/", async (req, res) => {
  await renderNotes(req, res, { q: req.query.q });
});

router.post("/notes", async (req, res) => {
  const form = notesService.readForm(req.body);
  const error = notesService.validate(form);
  if (error) return renderNotes(req, res, { form, error, status: 400 });
  await notesService.create(req.user.id, form);
  res.redirect(303, "/");
});

router.get("/notes/:id", async (req, res, next) => {
  const note = await notesService.getOwned(req.user.id, req.params.id);
  if (!note) return next();
  renderNote(res, note);
});

router.post("/notes/:id", async (req, res, next) => {
  const note = await notesService.getOwned(req.user.id, req.params.id);
  if (!note) return next();
  const form = notesService.readForm(req.body);
  const error = notesService.validate(form);
  if (error) return renderNote(res, note, { form, error, status: 400 });
  await notesService.update(req.user.id, note.id, form);
  res.redirect(303, `/notes/${note.id}`);
});

router.post("/notes/:id/delete", async (req, res, next) => {
  const rowCount = await notesService.remove(req.user.id, req.params.id);
  if (rowCount === 0) return next();
  res.redirect(303, "/");
});

module.exports = router;
