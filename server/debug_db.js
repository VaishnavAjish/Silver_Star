const pool = require('./db/pool');

async function run() {
  try {
    const res = await pool.query("SELECT id FROM purchase_notes WHERE doc_number = 'PN-B-19972440'");
    if (res.rows.length === 0) {
      console.log('PN not found');
      return;
    }
    const pnId = res.rows[0].id;
    console.log('PN ID:', pnId);
    
    const lines = await pool.query("SELECT * FROM purchase_note_lines WHERE purchase_note_id = $1", [pnId]);
    console.log('Lines count:', lines.rows.length);
    console.log('Lines:', lines.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
