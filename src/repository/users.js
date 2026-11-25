const { query } = require("../config/db");

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.password_hash, c.enabled AS totp_enabled
       FROM users u
       LEFT JOIN totp_credentials c ON c.user_id = u.id
      WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function findPasswordHash(id) {
  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [id]);
  return rows[0]?.password_hash || null;
}

async function create(email, passwordHash) {
  return query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
    [email, passwordHash]
  );
}

async function findAccount(id) {
  const { rows } = await query(
    `SELECT u.email, u.created_at,
            (SELECT count(*) FROM notes WHERE owner_id = u.id)::int AS notes,
            (SELECT count(*) FROM files WHERE owner_id = u.id)::int AS files
       FROM users u
      WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await query(
    `WITH owned AS (SELECT id FROM files WHERE owner_id = $1),
          deleted AS (DELETE FROM users WHERE id = $1 RETURNING id)
     SELECT (SELECT count(*) FROM deleted)::int AS users,
            coalesce((SELECT array_agg(id::text) FROM owned), '{}') AS file_ids`,
    [id]
  );
  return { deleted: rows[0].users === 1, fileIds: rows[0].file_ids };
}

module.exports = { findByEmail, findPasswordHash, create, findAccount, remove };
