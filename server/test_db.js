require('dotenv').config(); 
const { Client } = require('pg'); 
const client = new Client(); 
client.connect().then(() => 
  client.query("SELECT COUNT(*) FROM machine_processes WHERE status='completed' AND process_type ILIKE 'growth'").then(res => { 
    console.log("Growth completed count:", res.rows[0].count); 
    return client.query("SELECT * FROM machines LIMIT 1");
  }).then(res => {
    client.end(); 
  })
).catch(e => console.log(e.message));
