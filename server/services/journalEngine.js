const pool = require('../db/pool');

/**
 * JOURNAL ENGINE — The accounting spine of Silverstar Grow
 * 
 * Every financial transaction in the system calls this engine.
 * It guarantees:
 * 1. Debit always equals Credit (DB constraint + code validation)
 * 2. Account balances update atomically (PostgreSQL transaction)
 * 3. Full audit trail via source_type + source_id
 */

class JournalEngine {

  /**
   * Generate next JE number
   */
  async getNextJENumber(client) {
    const result = await client.query("SELECT nextval('je_seq') as num");
    return `JE-${result.rows[0].num}`;
  }

  /**
   * Create and optionally post a journal entry
   * 
   * @param {Object} params
   * @param {string} params.date - JE date (YYYY-MM-DD)
   * @param {string} params.description - Description of the transaction
   * @param {string} params.sourceType - 'purchase', 'expense', 'growth', 'invoice', 'payment', 'receipt', 'manual'
   * @param {number|null} params.sourceId - ID of the source document
   * @param {Array} params.lines - Array of {accountId, debit, credit, narration}
   * @param {boolean} params.autoPost - Whether to post immediately (default: true)
   * @param {number} params.createdBy - User ID
   * @returns {Object} The created journal entry with lines
   */
  async createEntry({ date, description, sourceType, sourceId, lines, autoPost = true, createdBy, client: existingClient, referenceNo }) {
    // Validate lines
    if (!lines || lines.length < 2) {
      throw new Error('Journal entry must have at least 2 lines');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new Error('Debit and credit amounts must be non-negative');
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new Error('A line cannot have both debit and credit');
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new Error('A line must have either debit or credit');
      }
      totalDebit += parseFloat(line.debit) || 0;
      totalCredit += parseFloat(line.credit) || 0;
    }

    // Round to 2 decimals to avoid floating point issues
    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (totalDebit !== totalCredit) {
      throw new Error(`Entry is not balanced: Debit ₹${totalDebit} ≠ Credit ₹${totalCredit}`);
    }

    const client = existingClient || await pool.primaryPool.connect();
    try {
      if (!existingClient) await client.query('BEGIN');

      const jeNumber = await this.getNextJENumber(client);

      // Insert journal entry header
      const jeResult = await client.query(
        `INSERT INTO journal_entries (je_number, date, description, source_type, source_id, total_debit, total_credit, status, created_by, reference_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [jeNumber, date, description, sourceType, sourceId, totalDebit, totalCredit, autoPost ? 'posted' : 'draft', createdBy, referenceNo || null]
      );
      const je = jeResult.rows[0];

      // Insert lines
      const insertedLines = [];
      for (const line of lines) {
        const lineResult = await client.query(
          `INSERT INTO je_lines (je_id, account_id, debit, credit, narration, cost_center_id, entity_type, entity_id, reference_no)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [je.id, line.accountId, parseFloat(line.debit) || 0, parseFloat(line.credit) || 0, line.narration || null, line.costCenterId || null,
           line.entityType || null, line.entityId ? parseInt(line.entityId) : null, line.referenceNo || null]
        );
        insertedLines.push(lineResult.rows[0]);
      }

      // If auto-posting, update account balances
      if (autoPost) {
        await this.updateBalances(client, lines);
        await client.query(
          'UPDATE journal_entries SET posted_at = NOW() WHERE id = $1',
          [je.id]
        );
      }

      if (!existingClient) await client.query('COMMIT');

      return { ...je, lines: insertedLines };
    } catch (err) {
      if (!existingClient) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!existingClient) client.release();
    }
  }

  /**
   * Post a draft journal entry (update account balances)
   */
  async postEntry(jeId) {
    const client = await pool.primaryPool.connect();
    try {
      await client.query('BEGIN');

      // Get the JE
      const jeResult = await client.query('SELECT * FROM journal_entries WHERE id = $1', [jeId]);
      if (jeResult.rows.length === 0) throw new Error('Journal entry not found');
      const je = jeResult.rows[0];
      if (je.status === 'posted') throw new Error('Journal entry already posted');
      if (je.status === 'cancelled') throw new Error('Cannot post a cancelled entry');

      // Get lines
      const linesResult = await client.query('SELECT * FROM je_lines WHERE je_id = $1', [jeId]);
      const lines = linesResult.rows.map(l => ({
        accountId: l.account_id,
        debit: parseFloat(l.debit),
        credit: parseFloat(l.credit),
      }));

      // Update balances
      await this.updateBalances(client, lines);

      // Mark as posted
      await client.query(
        "UPDATE journal_entries SET status = 'posted', posted_at = NOW() WHERE id = $1",
        [jeId]
      );

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update account balances based on JE lines — single batched query.
   * Asset/Expense: Debit increases, Credit decreases (natural debit)
   * Liability/Equity/Revenue: Credit increases, Debit decreases (natural credit)
   *
   * Uses a single UPDATE … FROM (VALUES …) JOIN to avoid N+1 round-trips.
   */
  async updateBalances(client, lines) {
    if (!lines || lines.length === 0) return;

    // Collect unique account IDs and validate they all exist in one query
    const uniqueIds = [...new Set(lines.map(l => l.accountId))];
    const accResult = await client.query(
      `SELECT id, type FROM accounts WHERE id = ANY($1::bigint[])`,
      [uniqueIds]
    );

    if (accResult.rows.length !== uniqueIds.length) {
      const foundIds = new Set(accResult.rows.map(r => r.id));
      const missing  = uniqueIds.find(id => !foundIds.has(id));
      throw new Error(`Account ID ${missing} not found`);
    }

    const typeMap = {};
    for (const row of accResult.rows) typeMap[row.id] = row.type;

    // Aggregate balance changes per account (a single account can appear
    // in multiple lines, e.g. partial payments)
    const changeMap = {};
    for (const line of lines) {
      const accType = typeMap[line.accountId];
      const delta   = ['asset', 'expense'].includes(accType)
        ? (parseFloat(line.debit) || 0) - (parseFloat(line.credit) || 0)
        : (parseFloat(line.credit) || 0) - (parseFloat(line.debit) || 0);

      changeMap[line.accountId] = Math.round(
        ((changeMap[line.accountId] || 0) + delta) * 100
      ) / 100;
    }

    // Build a single UPDATE using unnest to apply all balance changes in one round-trip
    const ids     = Object.keys(changeMap).map(Number);
    const deltas  = ids.map(id => changeMap[id]);

    await client.query(
      `UPDATE accounts
       SET    balance = accounts.balance + v.delta
       FROM   (SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::numeric[]) AS delta) v
       WHERE  accounts.id = v.id`,
      [ids, deltas]
    );
  }

  /**
   * Get ledger entries for an account
   */
  async getLedger(accountId, fromDate, toDate) {
    const result = await pool.query(
      `SELECT je.je_number, je.date, je.description, je.source_type,
              jl.debit, jl.credit, jl.narration
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.account_id = $1 AND je.status = 'posted'
         AND je.date BETWEEN $2 AND $3
       ORDER BY je.date, je.id`,
      [accountId, fromDate, toDate]
    );
    return result.rows;
  }
}

module.exports = new JournalEngine();
