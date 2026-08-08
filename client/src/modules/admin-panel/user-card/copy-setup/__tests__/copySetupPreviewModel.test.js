import { describe, it, expect } from 'vitest';
import {
  CATEGORY,
  CATEGORY_ORDER,
  CATEGORY_META,
  EMPTY_SELECTION,
  NEVER_COPIED,
  SEMANTICS,
  buildApplyPayload,
  buildCopyPreview,
  categoryRowCounts,
  diffReplace,
  fingerprintCopyState,
  fingerprintTargetState,
  isSelfCopy,
  overrideKeyOf,
  overridesToMap,
  selectedCategories,
  toggleCategory,
} from '../copySetupPreviewModel';
import { payload, user, ALL_SELECTED } from './copySetupFixtures';

/**
 * RBAC Brick 6 — copy preview model.
 *
 * The invariants the brick specifies, in its own order. Every semantic asserted
 * here is transcribed from server/routes/adminUsers.js's copy-setup transaction;
 * the server-side copySetupPreview.test.js re-derives the same expectations
 * straight from that SQL so the two cannot drift.
 */

const only = key => ({ ...EMPTY_SELECTION, [key]: true });

describe('selection and payload contract', () => {
  it('1. blocks a self-copy and previews nothing', () => {
    const selfPayload = payload({ source: user({ id: 9 }), target: user({ id: 9 }) });
    const preview = buildCopyPreview({ payload: selfPayload, selection: ALL_SELECTED });

    expect(isSelfCopy(selfPayload)).toBe(true);
    expect(preview.selfCopy).toBe(true);
    expect(preview.ready).toBe(false);
    for (const key of CATEGORY_ORDER) {
      expect(preview.categories[key].selected).toBe(false);
      expect(preview.categories[key].diff).toBeNull();
    }
  });

  it('2. is not ready when no category is selected', () => {
    const preview = buildCopyPreview({ payload: payload(), selection: EMPTY_SELECTION });
    expect(preview.selectedCount).toBe(0);
    expect(preview.ready).toBe(false);
    expect(preview.destructiveWarnings).toEqual([]);
  });

  it('defaults every category to off', () => {
    expect(selectedCategories(EMPTY_SELECTION)).toEqual([]);
    expect(Object.values(EMPTY_SELECTION).every(v => v === false)).toBe(true);
  });

  it('9-13. the apply payload can only ever carry the five copy flags', () => {
    const body = buildApplyPayload({ sourceId: '2', selection: only(CATEGORY.PERMISSIONS) });

    expect(Object.keys(body).sort()).toEqual([
      'copy_dashboard', 'copy_permissions', 'copy_preferences',
      'copy_templates', 'copy_visibility', 'source_user_id',
    ]);
    // 9. role, 10. primary department, 11. password, 12. MFA, 13. sessions —
    // none of them is expressible in this request.
    for (const forbidden of ['role', 'role_id', 'department_id', 'password',
      'password_hash', 'mfa', 'mfa_secret', 'sessions', 'refresh_token', 'username', 'email']) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(body.source_user_id).toBe(2);
    expect(body.copy_permissions).toBe(true);
    expect(body.copy_visibility).toBe(false);
  });

  it('36. deselecting a category removes it from the result entirely', () => {
    const before = buildCopyPreview({ payload: payload(), selection: ALL_SELECTED });
    const after = buildCopyPreview({
      payload: payload(),
      selection: toggleCategory(ALL_SELECTED, CATEGORY.PREFERENCES),
    });

    expect(before.categories[CATEGORY.PREFERENCES].diff).not.toBeNull();
    expect(after.categories[CATEGORY.PREFERENCES].diff).toBeNull();
    expect(after.selectedKeys).not.toContain(CATEGORY.PREFERENCES);
  });

  it('every category reports REPLACE, which is what the SQL does', () => {
    for (const key of CATEGORY_ORDER) {
      expect(CATEGORY_META[key].semantics).toBe(SEMANTICS.REPLACE);
      expect(CATEGORY_META[key].semanticsNote).toMatch(/replace/i);
    }
  });

  it('names role, department, password, MFA and sessions as never copied', () => {
    const labels = NEVER_COPIED.map(n => n.label).join(' | ');
    expect(labels).toMatch(/Role/);
    expect(labels).toMatch(/Primary department/);
    expect(labels).toMatch(/Password/);
    expect(labels).toMatch(/MFA/);
    expect(labels).toMatch(/Sessions/);
  });
});

describe('3, 16-20. permission override diff', () => {
  const preview = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.PERMISSIONS) });
  const diff = preview.categories[CATEGORY.PERMISSIONS].diff;

  it('3. replaces rather than merges — the result is exactly the source set', () => {
    expect(diff.counts.source).toBe(3);
    expect(diff.counts.target).toBe(3);
    expect(diff.counts.result).toBe(3);
    expect(diff.overrides.result.map(overrideKeyOf).sort()).toEqual([
      'accounting:journal_entries', 'inventory:stock_transfer', 'purchase:notes',
    ]);
  });

  it('16. reports the added row', () => {
    expect(diff.overrides.added.map(e => e.key)).toEqual(['inventory:stock_transfer']);
  });

  it('17. reports the changed row with both masks', () => {
    expect(diff.overrides.changed).toHaveLength(1);
    const [changed] = diff.overrides.changed;
    expect(changed.key).toBe('accounting:journal_entries');
    expect(changed.before.allow_mask).toBe(1);
    expect(changed.after.deny_mask).toBe(1);
  });

  it('18. reports the removed target row', () => {
    expect(diff.overrides.removed.map(e => e.key)).toEqual(['reports:stock']);
  });

  it('reports the unchanged row without counting it as a change', () => {
    expect(diff.overrides.unchanged.map(e => e.key)).toEqual(['purchase:notes']);
  });

  it('19/20. represents the legacy user_permissions rows the copy also replaces', () => {
    expect(diff.legacy.counts.source).toBe(1);
    expect(diff.legacy.counts.target).toBe(1);
    expect(diff.legacy.counts.removed).toBe(1);
    expect(diff.legacy.removed[0].key).toBe('reports:legacy_export');
    // Not folded into the override totals, which the editor also shows.
    expect(diff.counts.removed).toBe(1);
  });

  it('warns about the removals and the overwrite', () => {
    const text = preview.destructiveWarnings.join(' ');
    expect(text).toMatch(/1 existing target permission override will be removed/);
    expect(text).toMatch(/1 existing target permission override will be overwritten/);
    expect(text).toMatch(/1 legacy stored permission row/);
  });

  it('14. a Super Admin source contributes only its stored rows', () => {
    const p = payload();
    p.source.role = 'super_admin';
    p.categories.permissions.source.overrides = [
      { module: 'inventory', submodule: 'stock_transfer', allow_mask: 1, deny_mask: 0 },
    ];
    const d = buildCopyPreview({ payload: p, selection: only(CATEGORY.PERMISSIONS) })
      .categories[CATEGORY.PERMISSIONS].diff;

    // One stored row in, one row out. The bypass is never materialised.
    expect(d.counts.result).toBe(1);
    expect(d.overrides.result).toHaveLength(1);
  });
});

describe('4, 21-24. inventory visibility diff', () => {
  const scoped = (source, target) => {
    const p = payload();
    p.categories.visibility.source = source;
    p.categories.visibility.target = target;
    return buildCopyPreview({ payload: p, selection: only(CATEGORY.VISIBILITY) })
      .categories[CATEGORY.VISIBILITY].diff;
  };

  const SELECTED_34 = {
    has_row: true,
    scope_mode: 'SELECTED',
    include_unassigned: false,
    departments: [{ department_id: 3, name: 'Growing' }, { department_id: 4, name: 'Polish 2' }],
  };
  const ALL_ROW = { has_row: true, scope_mode: 'ALL', include_unassigned: false, departments: [] };
  const NONE_ROW = { has_row: true, scope_mode: 'NONE', include_unassigned: false, departments: [] };
  const NO_ROW = { has_row: false, scope_mode: null, include_unassigned: null, departments: [] };

  it('4/22. replaces the mode, the flag and the department list', () => {
    const diff = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.VISIBILITY) })
      .categories[CATEGORY.VISIBILITY].diff;

    expect(diff.before.department_ids).toEqual([3]);
    expect(diff.after.department_ids).toEqual([3, 4]);
    expect(diff.departmentsChanged).toBe(true);
    expect(diff.unassignedChanged).toBe(true);
    expect(diff.destructive).toBe(true);
  });

  it('21. NONE is carried as NONE, not softened to an empty selection', () => {
    const diff = scoped(NONE_ROW, SELECTED_34);
    expect(diff.after.effective_mode).toBe('NONE');
    expect(diff.modeChanged).toBe(true);
  });

  it('23. ALL is carried as ALL', () => {
    const diff = scoped(ALL_ROW, SELECTED_34);
    expect(diff.after.effective_mode).toBe('ALL');
    expect(diff.after.departments).toEqual([]);
  });

  it('24. an explicit ALL row and no row at all stay distinguishable', () => {
    const explicit = scoped(ALL_ROW, NO_ROW);
    const absent = scoped(NO_ROW, NO_ROW);

    expect(explicit.after.has_row).toBe(true);
    expect(absent.after.has_row).toBe(false);
    // Both resolve as ALL, but only one leaves a row behind.
    expect(explicit.after.effective_mode).toBe('ALL');
    expect(absent.after.effective_mode).toBe('ALL');
    expect(explicit.modeChanged).toBe(true);
    expect(absent.changed).toBe(false);
  });

  it('reports an identical scope as no change', () => {
    expect(scoped(SELECTED_34, SELECTED_34).changed).toBe(false);
  });
});

describe('5, 8, 25-27. preferences diff', () => {
  const preview = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.PREFERENCES) });
  const diff = preview.categories[CATEGORY.PREFERENCES].diff;

  it('25. reports the added key', () => {
    expect(diff.added.map(e => e.key)).toEqual(['landing_page']);
  });

  it('26. reports the replaced value', () => {
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].key).toBe('theme');
    expect(diff.changed[0].before.pref_value).toBe('light');
    expect(diff.changed[0].after.pref_value).toBe('dark');
  });

  it('reports the removed non-vis key', () => {
    expect(diff.removed.map(e => e.key)).toEqual(['compact_mode']);
  });

  it('8. excludes source vis.* keys from what is written', () => {
    expect(diff.excluded.map(r => r.pref_key)).toEqual(['vis.show_cogs']);
    expect(diff.result.map(r => r.pref_key)).not.toContain('vis.show_cogs');
    expect(diff.counts.copyable).toBe(3);
  });

  /* RBAC Brick 7 inverted the assertion this test used to make.
   *
   * Brick 6 found that the copy's DELETE was unfiltered while its INSERT
   * excluded `vis.%`, so the target's own vis.* rows were destroyed and never
   * replaced — and this test asserted that destruction, because it was true.
   * Brick 7 gave the DELETE the same filter, so those rows now SURVIVE. The test
   * is not removed; it is inverted to pin the corrected contract, and it fails
   * loudly if the unfiltered DELETE is ever reintroduced.
   */
  it('27. reports the target vis.* rows preserved by the filtered DELETE', () => {
    expect(diff.preservedExcluded.map(e => e.key)).toEqual(['vis.show_margin']);
    expect(diff.counts.preservedExcluded).toBe(1);
    // Preserved rows are reported unchanged, not as a before/after transition.
    expect(diff.preservedExcluded[0].before).toEqual(diff.preservedExcluded[0].after);
  });

  it('27b. raises no destructive warning for preserved vis.* rows', () => {
    expect(preview.destructiveWarnings.join(' ')).not.toMatch(/vis\./);
    expect(preview.destructiveWarnings.join(' ')).not.toMatch(/deleted and not replaced/);
  });

  it('27c. separates the stored target size from the subset the replacement reaches', () => {
    // Four stored target rows, one of which is vis.* and therefore out of reach
    // of both the DELETE and the INSERT.
    expect(diff.counts.target).toBe(4);
    expect(diff.counts.targetCopyable).toBe(3);
  });

  it('does not activate a vis.* key the target never had', () => {
    const p = payload();
    p.categories.preferences.target = [{ pref_key: 'theme', pref_value: 'light' }];
    const d = buildCopyPreview({ payload: p, selection: only(CATEGORY.PREFERENCES) })
      .categories[CATEGORY.PREFERENCES].diff;

    // Nothing to preserve, and — the point of the test — nothing created either.
    expect(d.preservedExcluded).toEqual([]);
    expect(d.result.some(r => r.pref_key.startsWith('vis.'))).toBe(false);
  });
});

describe('6, 28. dashboard diff', () => {
  const diff = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.DASHBOARD) })
    .categories[CATEGORY.DASHBOARD].diff;

  it('28. reports added, changed and removed widgets', () => {
    expect(diff.added.map(e => e.key)).toEqual(['pending_transfers']);
    expect(diff.changed.map(e => e.key)).toEqual(['stock_summary']);
    expect(diff.removed.map(e => e.key)).toEqual(['cash_position']);
  });

  it('6. treats position and visibility as part of the value', () => {
    const [changed] = diff.changed;
    expect(changed.before.position).toBe(2);
    expect(changed.after.position).toBe(0);
    expect(changed.before.is_visible).toBe(false);
    expect(changed.after.is_visible).toBe(true);
  });
});

describe('7, 29, 30. template diff', () => {
  const diff = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.TEMPLATES) })
    .categories[CATEGORY.TEMPLATES].diff;

  it('29. results in the union of the source shares and its own non-global templates', () => {
    expect(diff.result.map(r => r.template_id).sort()).toEqual([11, 12, 13]);
    expect(diff.added.map(e => e.key).sort()).toEqual(['12', '13']);
    expect(diff.removed.map(e => e.key)).toEqual(['20']);
  });

  it('30. counts a template that is both shared and owned once', () => {
    expect(diff.counts.sourceShares).toBe(2);
    expect(diff.counts.sourceOwned).toBe(2);
    expect(diff.counts.duplicatesIgnored).toBe(1);
    expect(diff.counts.result).toBe(3);
  });

  it('7. records how each resulting share arises without transferring ownership', () => {
    const owned = diff.result.find(r => r.template_id === 13);
    expect(owned.via_owned).toBe(true);
    expect(owned.via_share).toBe(false);
    expect(NEVER_COPIED.some(n => /ownership/i.test(n.label))).toBe(true);
  });
});

describe('35, 37-40. determinism and purity', () => {
  it('35. does not mutate its input', () => {
    const input = payload();
    const snapshot = JSON.stringify(input);
    buildCopyPreview({ payload: input, selection: ALL_SELECTED });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('40. returns the same result for identical inputs', () => {
    const a = buildCopyPreview({ payload: payload(), selection: ALL_SELECTED });
    const b = buildCopyPreview({ payload: payload(), selection: ALL_SELECTED });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('38. a changed target invalidates the fingerprint', () => {
    const before = fingerprintTargetState(payload());
    const p = payload();
    p.categories.preferences.target.push({ pref_key: 'default_branch', pref_value: 'A' });
    expect(fingerprintTargetState(p)).not.toBe(before);
    expect(fingerprintCopyState(p)).not.toBe(fingerprintCopyState(payload()));
  });

  it('37. a changed source invalidates the copy-state fingerprint', () => {
    const p = payload();
    p.categories.dashboard.source.push({ widget_key: 'extra', position: 9, is_visible: true });

    // The target did not move…
    expect(fingerprintTargetState(p)).toBe(fingerprintTargetState(payload()));
    // …but what would be copied did, so the staleness check must still fire.
    expect(fingerprintCopyState(p)).not.toBe(fingerprintCopyState(payload()));
  });

  it('39. changing the category selection changes the preview', () => {
    const one = buildCopyPreview({ payload: payload(), selection: only(CATEGORY.DASHBOARD) });
    const two = buildCopyPreview({ payload: payload(), selection: ALL_SELECTED });
    expect(one.selectedCount).toBe(1);
    expect(two.selectedCount).toBe(5);
    expect(one.destructiveWarnings).not.toEqual(two.destructiveWarnings);
  });

  it('is stable against key order in the stored rows', () => {
    const a = fingerprintTargetState(payload());
    const p = payload();
    p.categories.preferences.target = p.categories.preferences.target.map(
      r => ({ pref_value: r.pref_value, pref_key: r.pref_key }),
    );
    expect(fingerprintTargetState(p)).toBe(a);
  });
});

describe('helpers', () => {
  it('diffReplace never returns a union', () => {
    const diff = diffReplace({
      sourceRows: [{ k: 'a', v: 1 }],
      targetRows: [{ k: 'b', v: 2 }],
      keyOf: r => r.k,
      valueOf: r => ({ v: r.v }),
    });
    expect(diff.result.map(r => r.k)).toEqual(['a']);
    expect(diff.counts.removed).toBe(1);
  });

  it('overridesToMap produces the shape Brick 3 and Brick 5 read', () => {
    expect(overridesToMap([
      { module: 'inventory', submodule: 'stock_transfer', allow_mask: 8, deny_mask: 0 },
      { module: 'reports', submodule: '', allow_mask: 0, deny_mask: 2 },
    ])).toEqual({
      'inventory:stock_transfer': { allow_mask: 8, deny_mask: 0 },
      'reports:': { allow_mask: 0, deny_mask: 2 },
    });
  });

  it('categoryRowCounts reports both sides without computing a diff', () => {
    const counts = categoryRowCounts(payload());
    expect(counts[CATEGORY.PERMISSIONS]).toMatchObject({ source: 3, target: 3, sourceLegacy: 1 });
    expect(counts[CATEGORY.PREFERENCES]).toMatchObject({ source: 4, target: 4, sourceCopyable: 3 });
    expect(counts[CATEGORY.TEMPLATES]).toMatchObject({ source: 2, target: 2, sourceOwned: 2 });
    expect(counts[CATEGORY.VISIBILITY].sourceMode).toBe('SELECTED');
  });
});
