const pool = require('./db/pool');
const journalEngine = require('./services/journalEngine');

async function run() {
  try {
    const payload = {
      date: '2026-07-10',
      description: 'Test manual JE',
      sourceType: 'manual',
      sourceId: null,
      lines: [
        { accountId: 1, debit: 100, credit: 0, narration: null, costCenterId: null, entityType: null, entityId: null, referenceNo: null },
        { accountId: 2, debit: 0, credit: 100, narration: null, costCenterId: null, entityType: null, entityId: null, referenceNo: null }
      ],
      autoPost: true,
      createdBy: 1,
      referenceNo: null
    };

    const res = await journalEngine.createEntry(payload);
    console.log('Success:', res.id);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
