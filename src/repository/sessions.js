const { query } = require("../config/db");

async function touch(tokenHash, idleSeconds) {
  const { rows } = await query(
    `UPDATE sessions s
        SET last_seen_at = now()
       FROM users u
      WHERE s.id = $1
        AND u.id = s.user_id
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(secs => $2)
  RETURNING u.id, u.email, u.role`,
    [tokenHash, idleSeconds]
  );
  return rows[0] || null;
}

async function removeExpired(previousTokenHash, idleSeconds) {
  return query(
    `DELETE FROM sessions
      WHERE id = $1
         OR expires_at <= now()
         OR last_seen_at <= now() - make_interval(secs => $2)`,
    [previousTokenHash, idleSeconds]
  );
}

async function create(tokenHash, userId, absoluteSeconds) {
  return query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [tokenHash, userId, absoluteSeconds]
  );
}

async function remove(tokenHash) {
  return query("DELETE FROM sessions WHERE id = $1", [tokenHash]);
}

module.exports = { touch, removeExpired, create, remove };
