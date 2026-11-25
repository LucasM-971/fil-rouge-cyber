const argon2 = require("argon2");

const MIN_LENGTH = 6;
const MAX_LENGTH = 128;

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const dummyHash = argon2.hash("rempart-dummy-password", OPTIONS);

function isAcceptable(password) {
  if (typeof password !== "string") return false;
  const length = [...password].length;
  return length >= MIN_LENGTH && length <= MAX_LENGTH;
}

function hashPassword(password) {
  return argon2.hash(password, OPTIONS);
}

async function verifyPassword(hash, password) {
  const candidate = typeof password === "string" && password.length <= MAX_LENGTH * 4 ? password : "";
  try {
    return await argon2.verify(hash || (await dummyHash), candidate);
  } catch {
    return false;
  }
}

module.exports = { MIN_LENGTH, MAX_LENGTH, isAcceptable, hashPassword, verifyPassword };
