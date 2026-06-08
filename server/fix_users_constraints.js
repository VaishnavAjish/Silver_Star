require('dotenv').config();
const pool = require('./db/pool');

async function fixConstraints() {
  try {
    console.log("Adding PRIMARY KEY to users.id...");
    await pool.query('ALTER TABLE users ADD PRIMARY KEY (id);');
    console.log("Added primary key to id.");
    
    console.log("Adding UNIQUE to users.username...");
    await pool.query('ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);');
    console.log("Added unique constraint to username.");
    
  } catch (err) {
    console.error("Error adding constraints:", err.message);
  } finally {
    process.exit(0);
  }
}
fixConstraints();
