require('dotenv').config();
const pool = require('./config/db');
pool.query("SELECT d.name as dept_name, l.name as loc_name, dl.name as dept_loc_name, inv.source_module FROM inventory inv LEFT JOIN locations l ON inv.location_id=l.id LEFT JOIN departments d ON inv.department_id=d.id LEFT JOIN locations dl ON d.location_id=dl.id WHERE inv.source_module='purchase' LIMIT 5").then(r=>{
  console.log(JSON.stringify(r.rows, null, 2));
  process.exit(0);
}).catch(e=>{
  console.error(e);
  process.exit(1);
});
