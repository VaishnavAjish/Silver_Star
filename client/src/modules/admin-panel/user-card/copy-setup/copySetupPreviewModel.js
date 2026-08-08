/**
 * RBAC Brick 6 — pure diff model for the read-only Copy Setup preview.
 *
 * PURE FUNCTIONS ONLY. No React, no network, no writes. This file predicts what
 * the existing POST /api/admin/users/:id/copy-setup would do; it never performs
 * any part of it.
 *
 * THE ONE INVARIANT
 *   For the same source, target and category selection, `buildCopyPreview` must
 *   predict the apply result exactly. Every semantic below is transcribed from
 *   server/routes/adminUsers.js, and copySetupParity.test.js re-derives each
 *   category from that SQL to keep the two from drifting.
 *
 * WHAT THE BACKEND ACTUALLY DOES (all five categories, verbatim reading)
 *   copy_permissions  DELETE every target user_permission_overrides row, INSERT
 *                     every source row. Then the SAME for the legacy
 *                     user_permissions table. REPLACE, not merge, and it carries
 *                     rows whose module/submodule no active catalog entry owns.
 *   copy_visibility   DELETE the target scope row and its department rows,
 *                     INSERT the source's. When the source has NO scope row the
 *                     target is left with none either — the delete still runs.
 *   copy_preferences  DELETE the target's preference rows EXCEPT `vis.%`, INSERT
 *                     the source's rows EXCEPT `vis.%`. RBAC Brick 7 gave the
 *                     DELETE the same filter the INSERT always had, so the
 *                     exclusion is symmetric: the target's own vis.* rows are
 *                     neither replaced nor destroyed, and a target with no vis.*
 *                     rows still gets none.
 *   copy_dashboard    DELETE target widgets, INSERT the source's.
 *   copy_templates    DELETE target template_shares, INSERT the source's shares,
 *                     then additionally share every non-global template the
 *                     SOURCE created. Ownership (`created_by`) is never written.
 *
 * WHAT IT NEVER TOUCHES
 *   users.role, users.department_id, username, email, password_hash, MFA state,
 *   refresh tokens, sessions, created_by/created_at, roles, role_permissions and
 *   user_roles. No statement in the copy transaction names any of them, and
 *   `NEVER_COPIED` below is rendered from that fact rather than from a promise.
 *
 * SAFE DEFAULTS
 *   `EMPTY_SELECTION` is every category off. The pre-Brick-6 modal pre-checked
 *   all five, which meant the default action of a blind flow was the maximum
 *   destructive one. Selection is now explicit and opt-in.
 */

/* ── Categories ─────────────────────────────────────────────── */

export const CATEGORY = Object.freeze({
  PERMISSIONS: 'permissions',
  VISIBILITY: 'visibility',
  PREFERENCES: 'preferences',
  DASHBOARD: 'dashboard',
  TEMPLATES: 'templates',
});

export const CATEGORY_ORDER = Object.freeze([
  CATEGORY.PERMISSIONS,
  CATEGORY.VISIBILITY,
  CATEGORY.PREFERENCES,
  CATEGORY.DASHBOARD,
  CATEGORY.TEMPLATES,
]);

/**
 * The five semantics the preview is allowed to claim. Only REPLACE is currently
 * reachable — every category's SQL is a delete followed by an insert — and the
 * label is deliberately not softened to "Copy", which would hide the deletion.
 */
export const SEMANTICS = Object.freeze({
  REPLACE: 'REPLACE',
  MERGE: 'MERGE',
  ADD_ONLY: 'ADD_ONLY',
  SYNC: 'SYNC',
  UNCHANGED: 'UNCHANGED',
});

export const SEMANTICS_LABELS = Object.freeze({
  REPLACE: 'Replace',
  MERGE: 'Merge',
  ADD_ONLY: 'Add only',
  SYNC: 'Sync',
  UNCHANGED: 'Unchanged',
});

export const CATEGORY_META = Object.freeze({
  [CATEGORY.PERMISSIONS]: Object.freeze({
    key: CATEGORY.PERMISSIONS,
    label: 'Permission Overrides',
    flag: 'copy_permissions',
    semantics: SEMANTICS.REPLACE,
    tables: Object.freeze(['user_permission_overrides', 'user_permissions']),
    semanticsNote: 'This will replace the target user\'s stored override set with the '
      + 'source user\'s copyable override set. Existing target overrides the source does '
      + 'not have are deleted, not kept.',
  }),
  [CATEGORY.VISIBILITY]: Object.freeze({
    key: CATEGORY.VISIBILITY,
    label: 'Inventory Visibility',
    flag: 'copy_visibility',
    semantics: SEMANTICS.REPLACE,
    tables: Object.freeze(['user_inventory_scopes', 'user_inventory_scope_depts']),
    semanticsNote: 'This will replace the target user\'s inventory scope mode and '
      + 'department selection with the source user\'s.',
  }),
  [CATEGORY.PREFERENCES]: Object.freeze({
    key: CATEGORY.PREFERENCES,
    label: 'Preferences',
    flag: 'copy_preferences',
    semantics: SEMANTICS.REPLACE,
    tables: Object.freeze(['user_preferences']),
    semanticsNote: 'This will replace the target user\'s stored preferences with the '
      + 'source user\'s non-vis.* preferences.',
  }),
  [CATEGORY.DASHBOARD]: Object.freeze({
    key: CATEGORY.DASHBOARD,
    label: 'Dashboard',
    flag: 'copy_dashboard',
    semantics: SEMANTICS.REPLACE,
    tables: Object.freeze(['user_dashboard_widgets']),
    semanticsNote: 'This will replace the target user\'s dashboard widget layout with '
      + 'the source user\'s.',
  }),
  [CATEGORY.TEMPLATES]: Object.freeze({
    key: CATEGORY.TEMPLATES,
    label: 'Templates',
    flag: 'copy_templates',
    semantics: SEMANTICS.REPLACE,
    tables: Object.freeze(['template_shares']),
    semanticsNote: 'This will replace the target user\'s inventory template shares with '
      + 'the source user\'s shares plus the non-global templates the source created.',
  }),
});

export const EMPTY_SELECTION = Object.freeze({
  [CATEGORY.PERMISSIONS]: false,
  [CATEGORY.VISIBILITY]: false,
  [CATEGORY.PREFERENCES]: false,
  [CATEGORY.DASHBOARD]: false,
  [CATEGORY.TEMPLATES]: false,
});

export function selectedCategories(selection) {
  return CATEGORY_ORDER.filter(key => Boolean(selection?.[key]));
}

export function toggleCategory(selection, key) {
  return { ...selection, [key]: !selection?.[key] };
}

/**
 * The apply payload, in the backend's existing contract. Categories the admin did
 * not select are sent as explicit `false` rather than omitted, so the request
 * states the whole decision instead of relying on the route's falsy defaults.
 */
export function buildApplyPayload({ sourceId, selection }) {
  const payload = { source_user_id: Number(sourceId) };
  for (const key of CATEGORY_ORDER) {
    payload[CATEGORY_META[key].flag] = Boolean(selection?.[key]);
  }
  return payload;
}

/* ── What copy setup never touches ──────────────────────────── */

export const NEVER_COPIED = Object.freeze([
  Object.freeze({ label: 'Role', detail: 'The target keeps its own role. No role assignment is read or written.' }),
  Object.freeze({ label: 'Primary department', detail: 'users.department_id is not part of any category.' }),
  Object.freeze({ label: 'Username and email', detail: 'Account identity is never copied.' }),
  Object.freeze({ label: 'Password', detail: 'No password or password hash is read or written.' }),
  Object.freeze({ label: 'MFA enrolment', detail: 'No MFA secret or enrolment state is touched.' }),
  Object.freeze({ label: 'Sessions and refresh tokens', detail: 'Active sessions are not transferred or revoked.' }),
  Object.freeze({ label: 'Account status', detail: 'Active/inactive state is not changed.' }),
  Object.freeze({ label: 'Audit history', detail: 'Existing audit rows are not copied or rewritten.' }),
  Object.freeze({ label: 'Template ownership', detail: 'inventory_templates.created_by is never reassigned — the source keeps its templates.' }),
]);

export const VIS_EXCLUSION_NOTE =
  'Stored visibility preferences that are not backend-enforced are not copied as security '
  + 'configuration. The copy excludes every vis.* key from what it writes.';

/**
 * RBAC Brick 7 replaced VIS_DELETION_WARNING with this.
 *
 * Brick 6 discovered that the copy's DELETE was unfiltered while its INSERT
 * excluded `vis.%`, so a key explicitly excluded from being COPIED was silently
 * being DELETED. Brick 6 could only report that asymmetry; Brick 7 fixed it, and
 * the wording moves from a destructive warning to a statement of preservation
 * because that is now what the SQL does.
 */
export const VIS_PRESERVATION_NOTE =
  'Security-sensitive stored visibility preferences are preserved on the target and '
  + 'are not copied. The copy excludes every vis.* key from both the rows it removes '
  + 'and the rows it writes, so the target keeps its own values unchanged.';

export const SCOPE_AUTHORITY_NOTE =
  'Inventory visibility controls which inventory records can be viewed. It does not grant '
  + 'transaction or approval authority.';

export const SUPER_ADMIN_TARGET_NOTE =
  'Super Admin effective access is controlled by the Super Admin bypass. Permission '
  + 'overrides do not restrict the bypass, so copied deny rows will be stored but will not '
  + 'reduce this user\'s access.';

export const SUPER_ADMIN_SOURCE_NOTE =
  'Only the source user\'s stored override rows are copied. The Super Admin bypass is not a '
  + 'stored grant, so it is not materialised into override rows and is not transferred.';

export const DASHBOARD_AUTHORITY_NOTE =
  'A dashboard widget is a layout preference. Copying it does not grant permission to the '
  + 'underlying feature — the widget only renders for a user the resolver already allows.';

/* ── Generic keyed REPLACE diff ─────────────────────────────── */

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

/**
 * REPLACE semantics for a row set identified by `keyOf`.
 *
 * The result IS the source set — that is what "replace" means, and the caller
 * must not be shown a union. `removed` is what the target loses, and it is the
 * number the destructive warning is built from.
 *
 * Input arrays are never mutated: only reads, `map` and `filter` are used.
 */
export function diffReplace({ sourceRows = [], targetRows = [], keyOf, valueOf }) {
  const sourceByKey = new Map(sourceRows.map(row => [keyOf(row), row]));
  const targetByKey = new Map(targetRows.map(row => [keyOf(row), row]));

  const added = [];
  const changed = [];
  const unchanged = [];
  const removed = [];

  for (const [key, row] of sourceByKey) {
    const before = targetByKey.get(key);
    if (before === undefined) {
      added.push({ key, before: null, after: row });
    } else if (stableStringify(valueOf(before)) !== stableStringify(valueOf(row))) {
      changed.push({ key, before, after: row });
    } else {
      unchanged.push({ key, before, after: row });
    }
  }
  for (const [key, row] of targetByKey) {
    if (!sourceByKey.has(key)) removed.push({ key, before: row, after: null });
  }

  return {
    added,
    changed,
    unchanged,
    removed,
    result: [...sourceByKey.values()],
    counts: {
      source: sourceByKey.size,
      target: targetByKey.size,
      result: sourceByKey.size,
      added: added.length,
      changed: changed.length,
      unchanged: unchanged.length,
      removed: removed.length,
    },
  };
}

/* ── Per-category diffs ─────────────────────────────────────── */

export const overrideKeyOf = row => `${row.module}:${row.submodule || ''}`;
const overrideValueOf = row => ({
  allow_mask: Number(row.allow_mask) || 0,
  deny_mask: Number(row.deny_mask) || 0,
});

/** `{ 'module:submodule': { allow_mask, deny_mask } }` — the shape Brick 3/5 read. */
export function overridesToMap(rows = []) {
  const map = {};
  for (const row of rows) map[overrideKeyOf(row)] = overrideValueOf(row);
  return map;
}

function diffPermissions(category) {
  const overrides = diffReplace({
    sourceRows: category.source?.overrides || [],
    targetRows: category.target?.overrides || [],
    keyOf: overrideKeyOf,
    valueOf: overrideValueOf,
  });

  // The copy replaces the legacy user_permissions table in the same statement
  // block. Those rows are invisible in every Brick 3/4/5 surface, so they are
  // reported as their own diagnostic count rather than folded into the totals
  // above, which would misstate how many overrides the editor will show.
  const legacy = diffReplace({
    sourceRows: category.source?.legacy || [],
    targetRows: category.target?.legacy || [],
    keyOf: row => `${row.module}:${row.permission_key}`,
    valueOf: row => ({ allowed: Boolean(row.allowed) }),
  });

  return {
    overrides,
    legacy,
    counts: overrides.counts,
    destructive: overrides.counts.removed > 0
      || overrides.counts.changed > 0
      || legacy.counts.removed > 0
      || legacy.counts.changed > 0,
  };
}

/**
 * Scope has no natural row key, so it is diffed as one value.
 *
 * `has_row: false` is preserved on both sides. A source with no row leaves the
 * target with no row after the copy, which resolves as ALL — describing that as
 * "no change" when the target was on SELECTED would be wrong, and describing it
 * as an explicit ALL would claim a row that will not exist.
 */
function diffVisibility(category) {
  const before = normaliseScope(category.target);
  const after = normaliseScope(category.source);

  const departmentsChanged = stableStringify(before.department_ids)
    !== stableStringify(after.department_ids);
  const modeChanged = before.effective_mode !== after.effective_mode
    || before.has_row !== after.has_row;
  const unassignedChanged = Boolean(before.include_unassigned) !== Boolean(after.include_unassigned);

  return {
    before,
    after,
    modeChanged,
    departmentsChanged,
    unassignedChanged,
    changed: modeChanged || departmentsChanged || unassignedChanged,
    destructive: modeChanged || departmentsChanged || unassignedChanged,
    counts: {
      source: after.departments.length,
      target: before.departments.length,
      result: after.departments.length,
    },
  };
}

function normaliseScope(side) {
  const departments = [...(side?.departments || [])]
    .map(d => ({
      department_id: Number(d.department_id),
      name: d.name || `Department ${d.department_id}`,
    }))
    .sort((a, b) => a.department_id - b.department_id);

  const hasRow = Boolean(side?.has_row);
  return {
    has_row: hasRow,
    scope_mode: side?.scope_mode ?? null,
    /* What the resolver will read. No stored row resolves to ALL today, but the
       two states stay distinguishable through `has_row`. */
    effective_mode: hasRow ? (side.scope_mode || 'ALL') : 'ALL',
    include_unassigned: hasRow ? Boolean(side?.include_unassigned) : false,
    departments,
    department_ids: departments.map(d => d.department_id),
  };
}

const isExcludedPrefKey = (key, prefix) => String(key || '').startsWith(prefix);

function diffPreferences(category) {
  const prefix = category.excluded_key_prefix || 'vis.';
  const sourceRows = category.source || [];
  const targetRows = category.target || [];

  const copyable = sourceRows.filter(r => !isExcludedPrefKey(r.pref_key, prefix));
  const excluded = sourceRows.filter(r => isExcludedPrefKey(r.pref_key, prefix));

  const diff = diffReplace({
    sourceRows: copyable,
    targetRows: targetRows.filter(r => !isExcludedPrefKey(r.pref_key, prefix)),
    keyOf: row => row.pref_key,
    valueOf: row => ({ pref_value: String(row.pref_value ?? '') }),
  });

  /* The target's own vis.* rows. RBAC Brick 7 filtered the copy's DELETE the
     same way its INSERT was already filtered, so these now SURVIVE the copy
     untouched. They are still surfaced — an administrator should be told which
     security-relevant keys the copy is deliberately leaving alone — but they are
     a preservation fact, not a loss, so they are excluded from `destructive`. */
  const preservedExcluded = targetRows
    .filter(r => isExcludedPrefKey(r.pref_key, prefix))
    .map(row => ({ key: row.pref_key, before: row, after: row }));

  return {
    ...diff,
    excludedPrefix: prefix,
    excluded,
    preservedExcluded,
    counts: {
      ...diff.counts,
      source: sourceRows.length,
      copyable: copyable.length,
      excluded: excluded.length,
      /* `target` counts every stored row, including vis.*, because that is the
         size of the target's preference set. `targetCopyable` is the subset the
         replacement actually reaches. */
      target: targetRows.length,
      targetCopyable: targetRows.filter(r => !isExcludedPrefKey(r.pref_key, prefix)).length,
      preservedExcluded: preservedExcluded.length,
    },
    destructive: diff.counts.removed > 0 || diff.counts.changed > 0,
  };
}

function diffDashboard(category) {
  const diff = diffReplace({
    sourceRows: category.source || [],
    targetRows: category.target || [],
    keyOf: row => row.widget_key,
    valueOf: row => ({ position: Number(row.position) || 0, is_visible: Boolean(row.is_visible) }),
  });
  return { ...diff, destructive: diff.counts.removed > 0 || diff.counts.changed > 0 };
}

/**
 * The copy inserts the source's shares and then its own non-global templates
 * with ON CONFLICT DO NOTHING, so the result is the DISTINCT union of the two —
 * a template appearing in both yields one share, not two.
 */
function diffTemplates(category) {
  const shares = category.source?.shares || [];
  const owned = category.source?.owned_non_global || [];

  const unionById = new Map();
  for (const row of [...shares, ...owned]) {
    const id = Number(row.template_id);
    if (!unionById.has(id)) {
      unionById.set(id, {
        template_id: id,
        name: row.name || `Template ${id}`,
        via_share: false,
        via_owned: false,
      });
    }
  }
  for (const row of shares) unionById.get(Number(row.template_id)).via_share = true;
  for (const row of owned) unionById.get(Number(row.template_id)).via_owned = true;

  const diff = diffReplace({
    sourceRows: [...unionById.values()],
    targetRows: (category.target?.shares || []).map(r => ({
      template_id: Number(r.template_id),
      name: r.name || `Template ${r.template_id}`,
    })),
    keyOf: row => String(row.template_id),
    valueOf: () => ({}),
  });

  return {
    ...diff,
    counts: {
      ...diff.counts,
      sourceShares: shares.length,
      sourceOwned: owned.length,
      duplicatesIgnored: shares.length + owned.length - unionById.size,
    },
    destructive: diff.counts.removed > 0,
  };
}

const DIFFERS = Object.freeze({
  [CATEGORY.PERMISSIONS]: diffPermissions,
  [CATEGORY.VISIBILITY]: diffVisibility,
  [CATEGORY.PREFERENCES]: diffPreferences,
  [CATEGORY.DASHBOARD]: diffDashboard,
  [CATEGORY.TEMPLATES]: diffTemplates,
});

/* ── The preview ────────────────────────────────────────────── */

/**
 * A deterministic digest of the TARGET's stored state across all five
 * categories, used to notice that the target changed underneath an open preview.
 *
 * This is a staleness CHECK, not a lock. It is re-read immediately before apply
 * and compared; a change between that read and the copy transaction is still
 * possible. Closing that window needs a precondition on the write endpoint,
 * which is a Brick 7 concern and deliberately not invented here.
 */
export function fingerprintTargetState(payload) {
  const categories = payload?.categories || {};
  const material = CATEGORY_ORDER.map((key) => {
    const side = categories[key]?.target;
    // Templates carry an always-empty owned list on the target side; digesting
    // it would add bytes that can never change.
    if (key === CATEGORY.TEMPLATES) return [key, side?.shares || []];
    return [key, side ?? null];
  });

  // FNV-1a over the stable serialisation. Not cryptographic — it only has to
  // change when the bytes change.
  const text = stableStringify(material);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp1_${hash.toString(16).padStart(8, '0')}_${text.length}`;
}

/**
 * Stored row counts per category for BOTH users, so the category step can say
 * what is at stake before anything is selected.
 *
 * These are sizes of the fetched row sets, not a diff — selecting a category is
 * what produces a diff, and an unselected category is never previewed.
 */
export function categoryRowCounts(payload) {
  const c = payload?.categories || {};
  const scopeCount = side => (side?.has_row ? Math.max(1, (side.departments || []).length) : 0);

  return {
    [CATEGORY.PERMISSIONS]: {
      source: (c.permissions?.source?.overrides || []).length,
      target: (c.permissions?.target?.overrides || []).length,
      sourceLegacy: (c.permissions?.source?.legacy || []).length,
      targetLegacy: (c.permissions?.target?.legacy || []).length,
    },
    [CATEGORY.VISIBILITY]: {
      source: scopeCount(c.visibility?.source),
      target: scopeCount(c.visibility?.target),
      sourceMode: c.visibility?.source?.has_row ? (c.visibility.source.scope_mode || 'ALL') : 'ALL',
      targetMode: c.visibility?.target?.has_row ? (c.visibility.target.scope_mode || 'ALL') : 'ALL',
    },
    [CATEGORY.PREFERENCES]: {
      source: (c.preferences?.source || []).length,
      target: (c.preferences?.target || []).length,
      sourceCopyable: (c.preferences?.source || [])
        .filter(r => !isExcludedPrefKey(r.pref_key, c.preferences?.excluded_key_prefix || 'vis.')).length,
    },
    [CATEGORY.DASHBOARD]: {
      source: (c.dashboard?.source || []).length,
      target: (c.dashboard?.target || []).length,
    },
    [CATEGORY.TEMPLATES]: {
      source: (c.templates?.source?.shares || []).length,
      target: (c.templates?.target?.shares || []).length,
      sourceOwned: (c.templates?.source?.owned_non_global || []).length,
    },
  };
}

/**
 * The digest of everything the copy READS — both sides.
 *
 * The staleness check uses this one rather than the target-only digest: a source
 * that changed after the preview was generated would produce a copy the admin
 * never reviewed, exactly as a changed target would.
 */
export function fingerprintCopyState(payload) {
  const categories = payload?.categories || {};
  const material = CATEGORY_ORDER.map(key => [key, categories[key]?.source ?? null]);
  const text = stableStringify(material);

  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${fingerprintTargetState(payload)}~s${hash.toString(16).padStart(8, '0')}`;
}

export function isSelfCopy(payload) {
  const sourceId = payload?.source?.id;
  const targetId = payload?.target?.id;
  return sourceId != null && targetId != null && Number(sourceId) === Number(targetId);
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function buildDestructiveWarnings(categories) {
  const warnings = [];

  const permissions = categories[CATEGORY.PERMISSIONS];
  if (permissions.selected) {
    const { removed, changed } = permissions.diff.counts;
    if (removed > 0) warnings.push(`${removed} existing target permission ${plural(removed, 'override', 'overrides')} will be removed.`);
    if (changed > 0) warnings.push(`${changed} existing target permission ${plural(changed, 'override', 'overrides')} will be overwritten.`);
    const legacyRemoved = permissions.diff.legacy.counts.removed;
    if (legacyRemoved > 0) warnings.push(`${legacyRemoved} legacy stored permission ${plural(legacyRemoved, 'row', 'rows')} on the target will be removed.`);
  }

  const visibility = categories[CATEGORY.VISIBILITY];
  if (visibility.selected && visibility.diff.changed) {
    warnings.push('The target user\'s inventory department selection will be replaced.');
  }

  const preferences = categories[CATEGORY.PREFERENCES];
  if (preferences.selected) {
    const { changed, removed } = preferences.diff.counts;
    if (changed > 0) warnings.push(`${changed} target ${plural(changed, 'preference', 'preferences')} will be changed.`);
    if (removed > 0) warnings.push(`${removed} target ${plural(removed, 'preference', 'preferences')} will be removed.`);
    /* No vis.* warning. Brick 6 emitted one because the copy destroyed those
       rows; Brick 7 preserves them, so a warning here would now be false. The
       preservation is stated positively in the diff summary instead. */
  }

  const dashboard = categories[CATEGORY.DASHBOARD];
  if (dashboard.selected) {
    const { removed, changed } = dashboard.diff.counts;
    if (removed > 0) warnings.push(`${removed} target dashboard ${plural(removed, 'widget', 'widgets')} will be removed.`);
    if (changed > 0) warnings.push(`${changed} target dashboard ${plural(changed, 'widget', 'widgets')} will be repositioned or hidden.`);
  }

  const templates = categories[CATEGORY.TEMPLATES];
  if (templates.selected && templates.diff.counts.removed > 0) {
    const n = templates.diff.counts.removed;
    warnings.push(`${n} target template ${plural(n, 'share', 'shares')} will be removed.`);
  }

  return warnings;
}

/**
 * The full preview for one (source, target, selection).
 *
 * Categories the admin did not select carry `selected: false` and NO diff — an
 * unselected category is not previewed at all, so nothing on screen can suggest
 * it will be written.
 */
export function buildCopyPreview({ payload, selection = EMPTY_SELECTION }) {
  const selected = selectedCategories(selection);
  const selfCopy = isSelfCopy(payload);

  const categories = {};
  for (const key of CATEGORY_ORDER) {
    const meta = CATEGORY_META[key];
    if (!selection?.[key] || selfCopy || !payload?.categories?.[key]) {
      categories[key] = { ...meta, selected: false, diff: null, destructive: false };
      continue;
    }
    const diff = DIFFERS[key](payload.categories[key]);
    categories[key] = { ...meta, selected: true, diff, destructive: Boolean(diff.destructive) };
  }

  const destructiveCategories = CATEGORY_ORDER.filter(key => categories[key].destructive);

  return {
    ready: !selfCopy && selected.length > 0,
    selfCopy,
    selectedKeys: selected,
    selectedCount: selected.length,
    categories,
    destructiveCategories,
    destructiveWarnings: buildDestructiveWarnings(categories),
    isDestructive: destructiveCategories.length > 0,
    /* What the staleness check compares. `targetFingerprint` is kept separate so
       a stale report can say whether it was the target that moved. */
    fingerprint: fingerprintCopyState(payload),
    targetFingerprint: fingerprintTargetState(payload),
  };
}
