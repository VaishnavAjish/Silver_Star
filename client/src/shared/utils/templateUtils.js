export const SYSTEM_TEMPLATES = {
  basic: { id: 'basic', label: 'Basic', isSystem: true, cols: ['item_name', 'lot_op_id', 'lot_code', 'category', 'status', 'qty', 'unit', 'total_value'] },
  operational: { id: 'operational', label: 'Operational', isSystem: true, cols: ['item_name', 'lot_op_id', 'lot_code', 'category', 'operation_type', 'status', 'qty', 'unit', 'rate', 'total_value', 'source_module', 'dept_location_name'] },
  traceability: { id: 'traceability', label: 'Traceability', isSystem: true, cols: ['item_name', 'lot_op_id', 'lot_code', 'parent_lot_name', 'root_lot_name', 'operation_type', 'split_level', 'genealogy_path', 'status', 'purchase_date'] },
  stock: { id: 'stock', label: 'Stock', isSystem: true, cols: ['item_name', 'lot_op_id', 'lot_code', 'category', 'qty', 'unit', 'weight', 'rate', 'total_value', 'status', 'batch_no'] },
  dimensions: { id: 'dimensions', label: 'Dimensions', isSystem: true, cols: ['item_name', 'lot_op_id', 'lot_code', 'parent_lot_name', 'status', 'dim_length', 'dim_depth', 'dim_height', 'dim_preview'] },
};

const KEY_RENAMES = { dept_name: 'source_module' };

function migrateKeys(cols) {
  if (!Array.isArray(cols)) return cols;
  return cols.map(k => KEY_RENAMES[k] ?? k);
}

export const initActiveTemplateId = () => {
  const v2 = localStorage.getItem('inv_active_template_v2');
  if (v2) return v2;
  const old = localStorage.getItem('inv_template');
  if (old && SYSTEM_TEMPLATES[old]) return old;
  return localStorage.getItem('inv_default_template') || 'basic';
};

export const loadUserTemplates = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('inv_user_templates_v2')) || [];
    let changed = false;
    const migrated = raw.map(t => {
      const next = migrateKeys(t.cols);
      if (next !== t.cols) changed = true;
      return { ...t, cols: next };
    });
    if (changed) localStorage.setItem('inv_user_templates_v2', JSON.stringify(migrated));
    return migrated;
  } catch { return []; }
};

export const loadColOverrides = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('inv_col_overrides_v2')) || {};
    const migrated = {};
    let changed = false;
    for (const [tmpl, cols] of Object.entries(raw)) {
      const next = migrateKeys(cols);
      migrated[tmpl] = next;
      if (next.some((k, i) => k !== cols[i])) changed = true;
    }
    if (changed) localStorage.setItem('inv_col_overrides_v2', JSON.stringify(migrated));
    return migrated;
  } catch { return {}; }
};
