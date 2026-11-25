const { notes } = require("../repository");

const TITLE_MAX = 120;
const BODY_MAX = 5000;
const SEARCH_MAX = 100;
const ID = /^[1-9][0-9]{0,9}$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function readForm(body) {
  return { title: text(body.title), body: text(body.body) };
}

function validate(form) {
  if (!form.title || form.title.length > TITLE_MAX || form.body.length > BODY_MAX) {
    return `Le titre est obligatoire (${TITLE_MAX} caractères max) et le contenu limité à ${BODY_MAX} caractères.`;
  }
  return null;
}

async function list(ownerId, search = "") {
  const q = text(search).slice(0, SEARCH_MAX);
  return { q, notes: await notes.findByOwner(ownerId, `%${escapeLike(q)}%`) };
}

async function getOwned(ownerId, id) {
  return ID.test(id) ? notes.findOwnedById(ownerId, id) : null;
}

async function create(ownerId, form) {
  return notes.create(ownerId, form.title, form.body);
}

async function update(ownerId, noteId, form) {
  return notes.updateOwned(noteId, ownerId, form.title, form.body);
}

async function remove(ownerId, noteId) {
  if (!ID.test(noteId)) return 0;
  return notes.removeOwned(noteId, ownerId);
}

module.exports = { TITLE_MAX, BODY_MAX, SEARCH_MAX, readForm, validate, list, getOwned, create, update, remove };
