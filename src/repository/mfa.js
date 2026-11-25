const { query } = require("../config/db");

async function getCredential(userId) {
  const { rows } = await query(
    "SELECT secret, enabled, last_counter FROM totp_credentials WHERE user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

async function createPending(userId, secret) {
  await query(
    `INSERT INTO totp_credentials (user_id, secret, enabled)
     VALUES ($1, $2, false)
     ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = false, last_counter = NULL`,
    [userId, secret]
  );
}

async function enable(userId, counter) {
  await query(
    "UPDATE totp_credentials SET enabled = true, last_counter = $2 WHERE user_id = $1",
    [userId, counter]
  );
}

async function updateCounter(userId, counter) {
  const { rowCount } = await query(
    "UPDATE totp_credentials SET last_counter = $2 WHERE user_id = $1 AND (last_counter IS NULL OR last_counter < $2)",
    [userId, counter]
  );
  return rowCount > 0;
}

async function disable(userId) {
  await query("DELETE FROM totp_credentials WHERE user_id = $1", [userId]);
  await query("DELETE FROM backup_codes WHERE user_id = $1", [userId]);
}

async function addBackupCodes(userId, hashes) {
  await query("DELETE FROM backup_codes WHERE user_id = $1", [userId]);
  for (const codeHash of hashes) {
    await query("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, $2)", [userId, codeHash]);
  }
}

async function unusedBackupCodes(userId) {
  const { rows } = await query(
    "SELECT id, code_hash FROM backup_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId]
  );
  return rows;
}

async function consumeBackupCode(codeId) {
  const { rowCount } = await query(
    "UPDATE backup_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL",
    [codeId]
  );
  return rowCount > 0;
}

async function createChallenge(userId, tokenHash, seconds = 300) {
  await query("DELETE FROM mfa_challenges WHERE user_id = $1 OR expires_at <= now()", [userId]);
  await query(
    "INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [tokenHash, userId, seconds]
  );
}

async function getChallenge(tokenHash) {
  const { rows } = await query(
    "SELECT user_id FROM mfa_challenges WHERE token_hash = $1 AND expires_at > now()",
    [tokenHash]
  );
  return rows[0] || null;
}

async function consumeChallenge(tokenHash) {
  const { rows } = await query(
    `DELETE FROM mfa_challenges
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function clearChallenge(tokenHash) {
  await query("DELETE FROM mfa_challenges WHERE token_hash = $1", [tokenHash]);
}

module.exports = {
  getCredential, createPending, enable, updateCounter, disable,
  addBackupCodes, unusedBackupCodes, consumeBackupCode,
  createChallenge, getChallenge, consumeChallenge, clearChallenge,
};