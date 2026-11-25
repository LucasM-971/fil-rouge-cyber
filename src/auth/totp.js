const crypto = require("node:crypto");

const STEP_SECONDS = 30;

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const input = String(value).toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes = [];
  let bits = 0;
  let accumulator = 0;
  for (const char of input) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

function verifyTotp(secret, value, now = Date.now(), window = 1) {
  const candidate = typeof value === "string" ? value.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(candidate)) return null;
  const counterNow = Math.floor(now / 1000 / STEP_SECONDS);
  for (let delta = -window; delta <= window; delta++) {
    const counter = counterNow + delta;
    if (counter >= 0 && crypto.timingSafeEqual(Buffer.from(hotp(secret, counter)), Buffer.from(candidate))) {
      return counter;
    }
  }
  return null;
}

function provisioningUri(secret, email, issuer = "Rempart") {
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(STEP_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?${params.toString()}`;
}

function generateBackupCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(5);
    return bytes.toString("hex").toUpperCase().match(/.{1,5}/g).join("-");
  });
}

module.exports = { generateSecret, verifyTotp, provisioningUri, generateBackupCodes };