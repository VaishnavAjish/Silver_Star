const fs = require('fs');
const {Pool} = require("pg");
const pool = new Pool({ host: "localhost", port: 5433, user: "postgres", password: "nidhi", database: "silverstar_grow" });

pool.query("SELECT id, username, password_hash FROM users")
  .then(res => {
    fs.writeFileSync('users_out.txt', JSON.stringify(res.rows, null, 2));
  })
  .catch(e => {
    fs.writeFileSync('users_out.txt', "ERROR: " + e.message);
  })
  .finally(() => pool.end());
