const pool = require('../db/pool');

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;
const round4 = value => Math.round((Number(value) || 0) * 10000) / 10000;

function stockQty(row) {
  const weight = Number(row.weight) || 0;
  const qty = Number(row.qty) || 0;
  return row.category === 'rough' && weight > 0 ? weight : qty;
}

async function applyPurchase(client, itemId, qty, rate, amount) {
  const quantity = Number(qty) || 0;
  const value = round2(amount);
  if (quantity <= 0 || value <= 0) throw new Error('Purchase quantity and value must be greater than zero');

  await client.query(
    `UPDATE items
     SET quantity_on_hand = quantity_on_hand + $1,
         inventory_value = inventory_value + $2,
         last_purchase_cost = $3,
         avg_cost = CASE
           WHEN quantity_on_hand + $1 > 0 THEN ROUND(((inventory_value + $2) / (quantity_on_hand + $1))::numeric, 4)
           ELSE 0
         END
     WHERE id = $4`,
    [quantity, value, Number(rate) || 0, itemId]
  );
}

async function applyStockOut(client, itemId, qty, value, options = {}) {
  const quantity = Number(qty) || 0;
  const stockValue = round2(value);
  if (quantity <= 0) throw new Error('Stock-out quantity must be greater than zero');

  const { referenceType = 'manual', referenceId = null, reserveOnly = false } = options;

  // Reserve stock first to prevent race conditions
  if (referenceType && referenceId) {
    await client.query(
      `INSERT INTO stock_reservations (item_id, reference_type, reference_id, quantity, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [itemId, referenceType, referenceId, quantity]
    );
  }

  const itemR = await client.query(
    'SELECT quantity_on_hand, inventory_value FROM items WHERE id = $1 FOR UPDATE',
    [itemId]
  );
  if (!itemR.rows.length) throw new Error('Item not found');

  const currentQty = Number(itemR.rows[0].quantity_on_hand) || 0;
  if (currentQty + 0.0001 < quantity) {
    // Release reservation on failure
    if (referenceType && referenceId) {
      await client.query(
        'UPDATE stock_reservations SET status = \'cancelled\' WHERE item_id = $1 AND reference_type = $2 AND reference_id = $3 AND status = \'pending\'',
        [itemId, referenceType, referenceId]
      );
    }
    throw new Error('Insufficient stock. Negative stock is not allowed.');
  }

  const currentValue = Number(itemR.rows[0].inventory_value) || 0;
  const nextQty = round4(currentQty - quantity);
  const nextValue = Math.max(0, round2(currentValue - stockValue));

  await client.query(
    `UPDATE items
     SET quantity_on_hand = $1,
         inventory_value = $2,
         avg_cost = CASE WHEN $1 > 0 THEN ROUND(($2 / $1)::numeric, 4) ELSE 0 END
     WHERE id = $3`,
    [nextQty, nextValue, itemId]
  );

  // Mark reservation as confirmed
  if (referenceType && referenceId) {
    await client.query(
      'UPDATE stock_reservations SET status = \'confirmed\', confirmed_at = NOW() WHERE item_id = $1 AND reference_type = $2 AND reference_id = $3 AND status = \'pending\'',
      [itemId, referenceType, referenceId]
    );
  }
}

async function getInventoryValuation(asOfDate, db = pool) {
  const overrideR = await db.query(
    `SELECT date, COALESCE(SUM(value), 0) AS value
     FROM inventory_closing_override
     WHERE date = (
       SELECT MAX(date) FROM inventory_closing_override WHERE date <= $1
     )
     GROUP BY date`,
    [asOfDate]
  );

  if (overrideR.rows.length) {
    return {
      mode: 'manual',
      as_of_date: overrideR.rows[0].date,
      value: round2(overrideR.rows[0].value),
    };
  }

  // Phase 4: Deterministic As-Of-Date valuation using General Ledger
  const liveR = await db.query(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS value
     FROM je_lines jl
     JOIN journal_entries je ON je.id = jl.je_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE je.status = 'posted' 
       AND je.date <= $1
       AND a.type = 'asset'
       AND (a.account_role LIKE 'INVENTORY_%' OR a.name ILIKE '%Inventory%')`
    , [asOfDate]
  );

  return {
    mode: 'system',
    as_of_date: asOfDate,
    value: round2(liveR.rows[0].value),
  };
}

async function getInventoryValuationLines(asOfDate, page = 1, pageSize = 50, db = pool) {
  const offset = (page - 1) * pageSize;
  
  const overrideR = await db.query(
    `SELECT ico.*, i.code AS item_code, i.name AS item_name, i.category
     FROM inventory_closing_override ico
     JOIN items i ON i.id = ico.item_id
     WHERE ico.date = (
       SELECT MAX(date) FROM inventory_closing_override WHERE date <= $1
     )
     ORDER BY i.code
     LIMIT $2 OFFSET $3`,
    [asOfDate, pageSize, offset]
  );
  
  const countOverrideR = await db.query(
    `SELECT COUNT(*) FROM inventory_closing_override 
     WHERE date = (SELECT MAX(date) FROM inventory_closing_override WHERE date <= $1)`,
    [asOfDate]
  );

  if (overrideR.rows.length || parseInt(countOverrideR.rows[0].count) > 0) {
    const totalCount = parseInt(countOverrideR.rows[0].count);
    const totalPages = Math.ceil(totalCount / pageSize);
    return {
      mode: 'manual',
      as_of_date: overrideR.rows[0].date,
      total_value: round2(overrideR.rows.reduce((s, r) => s + Number(r.value || 0), 0)),
      data: overrideR.rows.map(r => ({
        item_id: r.item_id,
        item_code: r.item_code,
        item_name: r.item_name,
        category: r.category,
        date: r.date,
        quantity: Number(r.quantity) || 0,
        rate: Number(r.rate) || 0,
        value: Number(r.value) || 0,
      })),
      totalCount, page, pageSize, totalPages,
    };
  }

  // Phase 4: Event Sourcing Reconstruction
  const query = `
    WITH movements AS (
      -- 1. Purchases (Inbound)
      SELECT pnl.item_id, pnl.qty AS qty_delta, pnl.total AS value_delta
      FROM purchase_note_lines pnl
      JOIN purchase_notes pn ON pn.id = pnl.purchase_note_id
      WHERE pn.doc_date <= $1 AND pn.status != 'cancelled'
      
      UNION ALL
      
      -- 2. Opening Stock (Inbound)
      SELECT io.item_id, io.quantity AS qty_delta, io.value AS value_delta
      FROM inventory_opening io
      WHERE io.as_of_date <= $1
      
      UNION ALL
      
      -- 3. Sales (Outbound)
      SELECT inv_lot.item_id, 
             CASE WHEN i.category = 'rough' THEN -il.weight ELSE -il.qty END AS qty_delta,
             -il.cost_value AS value_delta
      FROM invoice_lines il
      JOIN invoices inv ON inv.id = il.invoice_id
      JOIN inventory inv_lot ON inv_lot.id = il.inventory_id
      JOIN items i ON i.id = inv_lot.item_id
      WHERE inv.date <= $1 AND inv.status != 'cancelled'
      
      UNION ALL
      
      -- 4. Process Consumptions (Outbound Gas/Consumables)
      SELECT inv_lot.item_id, 
             -ptl.qty_in AS qty_delta,
             -(ptl.qty_in * COALESCE(inv_lot.rate, i.avg_cost, 0)) AS value_delta
      FROM process_transaction_lines ptl
      JOIN process_transactions pt ON pt.id = ptl.process_trs_id
      JOIN inventory inv_lot ON inv_lot.id = ptl.inventory_id
      JOIN items i ON i.id = inv_lot.item_id
      WHERE pt.trs_date <= $1 AND ptl.inventory_id IS NOT NULL AND ptl.qty_in > 0
      
      UNION ALL
      
      -- 5. Splits/Mixes Consumption (Outbound)
      SELECT inv.item_id,
             -lmp.quantity_consumed AS qty_delta,
             -(lmp.quantity_consumed * lmp.cost_per_unit) AS value_delta
      FROM lot_movement_parents lmp
      JOIN lot_movements lm ON lm.id = lmp.movement_id
      JOIN inventory inv ON inv.id = lmp.parent_lot_id
      WHERE lm.movement_date <= $1
      
      UNION ALL
      
      -- 6. Splits Creation (Inbound)
      SELECT inv.item_id,
             CASE WHEN i.category = 'rough' THEN inv.weight ELSE inv.qty END AS qty_delta,
             inv.total_value AS value_delta
      FROM lot_movement_children lmc
      JOIN lot_movements lm ON lm.id = lmc.movement_id
      JOIN inventory inv ON inv.id = lmc.child_lot_id
      JOIN items i ON i.id = inv.item_id
      WHERE lm.movement_date <= $1
      
      UNION ALL
      
      -- 7. Seed Mix Consumption (Outbound)
      SELECT inv.item_id,
             -lmc.qty AS qty_delta,
             -(lmc.qty * COALESCE(inv.rate, 0)) AS value_delta
      FROM lot_mix_components lmc
      JOIN inventory inv ON inv.id = lmc.source_lot_id
      JOIN inventory mixed_inv ON mixed_inv.id = lmc.mixed_lot_id
      WHERE mixed_inv.purchase_date <= $1
      
      UNION ALL
      
      -- 8. Rough Growth Outputs (Inbound)
      SELECT inv.item_id,
             rgl.weight AS qty_delta,
             (rgl.weight * COALESCE(inv.rate, 0)) AS value_delta
      FROM rough_growth_lines rgl
      JOIN inventory inv ON inv.id = rgl.inventory_id
      WHERE inv.purchase_date <= $1
    )
    SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.category,
           COALESCE(SUM(m.qty_delta), 0) AS quantity,
           COALESCE(SUM(m.value_delta), 0) AS value
    FROM items i
    JOIN movements m ON m.item_id = i.id
    GROUP BY i.id, i.code, i.name, i.category
    HAVING COALESCE(SUM(m.qty_delta), 0) > 0.001 OR COALESCE(SUM(m.value_delta), 0) > 0.01
  `;

  const liveR = await db.query(query + ` ORDER BY i.code LIMIT $2 OFFSET $3`, [asOfDate, pageSize, offset]);
  
  const countLiveR = await db.query(`SELECT COUNT(*) FROM (${query}) sub`, [asOfDate]);
  
  const totalCount = parseInt(countLiveR.rows[0].count);
  const totalPages = Math.ceil(totalCount / pageSize);

  const data = liveR.rows.map(r => {
    const quantity = Number(r.quantity) || 0;
    const value = Number(r.value) || 0;
    return {
      item_id: r.item_id,
      item_code: r.item_code,
      item_name: r.item_name,
      category: r.category,
      quantity: round4(quantity),
      rate: quantity > 0 ? round4(value / quantity) : 0,
      value: round2(value),
    };
  });

  return {
    mode: 'system',
    as_of_date: asOfDate,
    total_value: round2(data.reduce((s, r) => s + r.value, 0)),
    data, totalCount, page, pageSize, totalPages,
  };
}

module.exports = {
  applyPurchase,
  applyStockOut,
  getInventoryValuation,
  getInventoryValuationLines,
  round2,
  stockQty,
};
