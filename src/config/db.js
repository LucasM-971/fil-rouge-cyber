const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 3000,
});

pool.on("error", (err) => console.error(JSON.stringify({ level: "error", source: "db", message: err.message })));

function query(text, params = []) {
  return pool.query(text, params);
}

module.exports = { query };
