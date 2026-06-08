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

async function applyStockOut(client, itemId, qty, value) {
  const quantity = Number(qty) || 0;
  const stockValue = round2(value);
  if (quantity <= 0) throw new Error('Stock-out quantity must be greater than zero');

  const itemR = await client.query(
    'SELECT quantity_on_hand, inventory_value FROM items WHERE id = $1 FOR UPDATE',
    [itemId]
  );
  if (!itemR.rows.length) throw new Error('Item not found');

  const currentQty = Number(itemR.rows[0].quantity_on_hand) || 0;
  if (currentQty + 0.0001 < quantity) throw new Error('Insufficient stock. Negative stock is not allowed.');

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

  const liveR = await db.query(
    `SELECT COALESCE(SUM(total_value), 0) AS value
     FROM inventory
     WHERE status NOT IN ('SOLD', 'CONSUMED', 'CANCELLED')`
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

  const liveR = await db.query(
    `SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.category,
            COALESCE(SUM(CASE WHEN i.category = 'rough' AND inv.weight > 0 THEN inv.weight ELSE inv.qty END), 0) AS quantity,
            COALESCE(SUM(inv.total_value), 0) AS value
     FROM items i
     LEFT JOIN inventory inv ON inv.item_id = i.id
       AND inv.status NOT IN ('SOLD', 'CONSUMED', 'CANCELLED')
     GROUP BY i.id, i.code, i.name, i.category
     HAVING COALESCE(SUM(inv.total_value), 0) <> 0
     ORDER BY i.code
     LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  const countLiveR = await db.query(
    `SELECT COUNT(*) FROM (
      SELECT i.id
      FROM items i
      LEFT JOIN inventory inv ON inv.item_id = i.id
        AND inv.status NOT IN ('SOLD', 'CONSUMED', 'CANCELLED')
      GROUP BY i.id
      HAVING COALESCE(SUM(inv.total_value), 0) <> 0
    ) sub`
  );

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
      quantity,
      rate: quantity > 0 ? round4(value / quantity) : 0,
      value,
    };
  });

  return {
    mode: 'system',
    as_of_date: asOfDate,
    total_value: round2(data.reduce((s, r) => s + r.value, 0)), // This might only reflect the page's total, but we keep it
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
