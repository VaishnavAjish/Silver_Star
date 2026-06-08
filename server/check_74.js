const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ user: 'postgres', password: '1', host: '127.0.0.1', database: 'silverstar_grow', port: 5432 });
pool.query(`SELECT mp.process_type, pm.process_group FROM machine_processes mp LEFT JOIN process_master pm ON pm.process_code = mp.process_type WHERE mp.id = 74`)
  .then(res => { fs.writeFileSync('out_74.txt', JSON.stringify(res.rows)); process.exit(0); })
  .catch(e => { fs.writeFileSync('out_74.txt', e.message); process.exit(1);});
