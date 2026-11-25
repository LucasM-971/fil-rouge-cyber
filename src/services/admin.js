const { admin } = require("../repository");

async function listUsers() {
  return admin.listUsers();
}

module.exports = { listUsers };
