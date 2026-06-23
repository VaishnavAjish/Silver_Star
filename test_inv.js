require('./server/db/pool').query('SELECT inv.weight, inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit FROM inventory inv LIMIT 1')
  .then(r => console.log('INVENTORY:', r.rows))
  .catch(e => console.log('ERROR:', e.message))
  .finally(() => process.exit(0));
