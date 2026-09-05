const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const hash = bcrypt.hashSync("test123", 10);
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect().then(async () => {
  await client.query("UPDATE employees SET password_hash = $1 WHERE username = $2", [hash, "admin"]);
  console.log("Updated admin password to test123");
  console.log("Hash:", hash);
  await client.end();
}).catch(e => { console.error(e); process.exit(1); });
