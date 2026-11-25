const { query } = require("../config/db");

async function findByOwner(ownerId) {
  const { rows } = await query(
    `SELECT id, original_name, mime, size, created_at
       FROM files
      WHERE owner_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [ownerId]
  );
  return rows;
}

async function create(id, ownerId, originalName, mime, size) {
  return query(
    "INSERT INTO files (id, owner_id, original_name, mime, size) VALUES ($1, $2, $3, $4, $5)",
    [id, ownerId, originalName, mime, size]
  );
}

async function findOwnedById(id, ownerId) {
  const { rows } = await query(
    "SELECT id, original_name, mime FROM files WHERE id = $1 AND owner_id = $2",
    [id, ownerId]
  );
  return rows[0] || null;
}

async function removeOwned(id, ownerId) {
  const { rows } = await query(
    "DELETE FROM files WHERE id = $1 AND owner_id = $2 RETURNING id",
    [id, ownerId]
  );
  return rows[0] || null;
}

module.exports = { findByOwner, create, findOwnedById, removeOwned };
