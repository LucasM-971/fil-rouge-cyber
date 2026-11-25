const { query } = require("../config/db");

async function findByOwner(ownerId, search) {
  const { rows } = await query(
    `SELECT id, title, body, created_at
       FROM notes
      WHERE owner_id = $1
        AND (title ILIKE $2 ESCAPE '\\' OR body ILIKE $2 ESCAPE '\\')
      ORDER BY created_at DESC
      LIMIT 50`,
    [ownerId, search]
  );
  return rows;
}

async function findOwnedById(ownerId, id) {
  const { rows } = await query(
    "SELECT id, title, body, created_at, updated_at FROM notes WHERE id = $1 AND owner_id = $2",
    [id, ownerId]
  );
  return rows[0] || null;
}

async function create(ownerId, title, body) {
  return query("INSERT INTO notes (owner_id, title, body) VALUES ($1, $2, $3)", [ownerId, title, body]);
}

async function updateOwned(id, ownerId, title, body) {
  return query(
    "UPDATE notes SET title = $1, body = $2, updated_at = now() WHERE id = $3 AND owner_id = $4",
    [title, body, id, ownerId]
  );
}

async function removeOwned(id, ownerId) {
  const { rowCount } = await query("DELETE FROM notes WHERE id = $1 AND owner_id = $2", [id, ownerId]);
  return rowCount;
}

module.exports = { findByOwner, findOwnedById, create, updateOwned, removeOwned };
