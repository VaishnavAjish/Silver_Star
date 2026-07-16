/**
 * Navigation selectors — PURE, framework-free. No React/icon imports so these
 * can be unit-tested under `node --test`. Every navigation surface (sidebar,
 * command palette, Create menu, header shortcuts) filters through the SAME
 * `isEntryVisible` rule, so a shortcut/palette result can never grant access.
 *
 * ctx = { hasPermission(module, action, submodule?), hasRole(...roles) }
 */

/** Authoritative per-entry visibility — mirrors AuthContext.hasPermission gates. */
export function isEntryVisible(entry, ctx) {
  if (!entry) return false;
  const hasPermission = (ctx && ctx.hasPermission) || (() => false);
  const hasRole = (ctx && ctx.hasRole) || (() => false);

  if (entry.adminOnly) return hasRole('admin', 'super_admin');
  if (entry.requiredAction) {
    return !entry.module || hasPermission(entry.module, entry.requiredAction, entry.submodule || '');
  }
  if (entry.editorOnly) {
    return !entry.module || hasPermission(entry.module, 'create') || hasPermission(entry.module, 'edit');
  }
  if (entry.submodule) return hasPermission(entry.module, 'sidebar', entry.submodule);
  if (entry.module) return hasPermission(entry.module, 'view');
  return true;
}

/** Sidebar: keep visible children; drop empty groups; keep visible direct links. */
export function filterNavigation(navigation, ctx) {
  const out = [];
  for (const node of navigation || []) {
    if (node.children) {
      const visibleChildren = node.children.filter(c => isEntryVisible(c, ctx));
      if (visibleChildren.length > 0) out.push({ ...node, children: visibleChildren });
    } else if (isEntryVisible(node, ctx)) {
      out.push(node);
    }
  }
  return out;
}

/** Flatten every leaf (group children + direct links) — no permission filter. */
export function flattenLeaves(navigation) {
  const out = [];
  for (const node of navigation || []) {
    if (node.children) {
      for (const c of node.children) out.push({ ...c, icon: c.icon || node.icon });
    } else if (node.path) {
      out.push(node);
    }
  }
  return out;
}

/** Command palette: searchable leaves the user is permitted to see. */
export function filterPages(navigation, ctx) {
  return flattenLeaves(navigation).filter(e => e.searchable !== false && isEntryVisible(e, ctx));
}

/** Create menu: create actions the user is permitted to run. */
export function filterCreateActions(createActions, ctx) {
  return (createActions || []).filter(a => isEntryVisible(a, ctx));
}

/**
 * Resolve stored shortcut ids → concrete entries, in order. Unknown ids,
 * non-pinnable ids, and permission-denied ids are silently skipped. Never
 * resolves an arbitrary URL — only known registry ids.
 */
export function resolveShortcutIds(ids, getEntry, ctx) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const entry = getEntry(id);
    if (!entry || !entry.pinnable) continue;
    if (!isEntryVisible(entry, ctx)) continue;
    out.push(entry);
  }
  return out;
}

/** Prune ids to the valid, pinnable, de-duplicated set (for persistence). */
export function sanitizeShortcutIds(ids, getEntry) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const entry = getEntry(id);
    if (entry && entry.pinnable) { seen.add(id); out.push(id); }
  }
  return out;
}

/** Parse a versioned nav.shortcuts preference value; safe fallback on garbage. */
export function parseShortcutPref(raw, fallbackPreset) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (obj && obj.v === 1 && Array.isArray(obj.ids)) {
      return { preset: typeof obj.preset === 'string' ? obj.preset : null, ids: obj.ids };
    }
  } catch { /* fall through to fallback */ }
  return { preset: fallbackPreset || null, ids: null };
}

/** Serialize the versioned nav.shortcuts value. */
export function serializeShortcutPref(ids, preset) {
  return JSON.stringify({ v: 1, preset: preset || null, ids: Array.isArray(ids) ? ids : [] });
}
