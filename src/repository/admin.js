const { query } = require("../config/db");

async function listUsers() {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.created_at,
            (SELECT count(*) FROM notes n WHERE n.owner_id = u.id)::int AS notes,
            (SELECT count(*) FROM files f WHERE f.owner_id = u.id)::int AS files,
            (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())::int AS sessions
       FROM users u
      ORDER BY u.created_at DESC
      LIMIT 200`
  );
  return rows;
}

module.exports = { listUsers };
