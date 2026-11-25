const express = require("express");
const { query } = require("../config/db");
const { log } = require("../lib/errors");

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch (err) {
    log("error", { source: "health", message: err.message });
    res.status(503).json({ status: "degraded", db: "down" });
  }
});

module.exports = router;
