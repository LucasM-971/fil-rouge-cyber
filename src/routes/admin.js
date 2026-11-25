const express = require("express");
const adminService = require("../services/admin");
const { requireRole } = require("../middleware/access");

const router = express.Router();

router.use(requireRole("admin"));

router.get("/", async (req, res) => {
  const users = await adminService.listUsers();
  res.render("admin", { title: "Administration", current: "admin", users });
});

module.exports = router;
