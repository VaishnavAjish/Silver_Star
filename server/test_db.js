const db = require('./db/pool');
async function test() {
  try {
    const res = await db.query('SELECT 1 as val');
    console.log('DB ok:', res.rows);
  } catch(e) {
    console.error('DB err:', e);
  } finally {
    process.exit(0);
  }
}
test();
