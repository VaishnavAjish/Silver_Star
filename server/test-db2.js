const fs = require('fs');
const {Pool} = require("pg");
const pool = new Pool({
  host: "localhost",
  port: 5433,
  user: "postgres",
  password: "nidhi",
  database: "silverstar_grow"
});

pool.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active = true", ["admin"])
  .then(res => {
    fs.writeFileSync('db-result.txt', "SUCCESS: " + JSON.stringify(res.rows));
  })
  .catch(e => {
    fs.writeFileSync('db-result.txt', "DB ERROR: " + e.message);
  })
  .finally(() => pool.end());
