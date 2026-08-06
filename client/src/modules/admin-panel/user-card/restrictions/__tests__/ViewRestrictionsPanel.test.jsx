import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/* ── Boundary mocks: no network, no auth context, no toasts ──── */
let api;
const refreshUser = vi.fn();
let currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };

vi.mock('../../../../../shared/hooks/useApi', () => ({
  useApi: () => api,
  default: () => api,
}));

vi.mock('../../../../../core/context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, refreshUser }),
  ROLE_DEFAULTS: {},
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('react-hot-toast', () => ({ default: toast, toast }));

const { default: UserDrawer } = await import('../../../pages/UserDrawer');

/* ══════════════════════════════════════════════════════════════
   Fixtures — the real catalog payload shape
   ══════════════════════════════════════════════════════════════ */

const USER = {
  id: 1,
  username: 'testop',
  full_name: 'Test Operator',
  email: 'op@example.com',
  role: 'operator',
  is_active: true,
  department_id: 3,
  created_at: '2026-01-15T00:00:00.000Z',
};

const DEPARTMENTS = [
  { id: 1, name: 'Growing' },
  { id: 2, name: 'Polish 2' },
  { id: 3, name: 'Surat HO' },
  { id: 4, name: 'Mumbai' },
  { id: 5, name: 'Assortment' },
];

const ENFORCED = {
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'ENFORCED',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const permission = over => ({
  business_group: 'Inventory',
  description: '',
  status: 'ACTIVE',
  risk_level: 'MEDIUM',
  control_type: 'ACTION_MATRIX',
  supported_actions: ['view'],
  has_baseline_rows: true,
  canonical_code: null,
  empty_submodule_meaning: null,
  enforcement: ENFORCED,
  notes: [],
  ...over,
});

const visMeta = (code, label) => ({
  code,
  business_group: 'View Restrictions',
  label,
  description: `Stored per-user flag intended to control whether ${label} is displayed.`,
  setting_type: 'USER_PREFERENCE',
  storage: 'user_preferences.pref_key (TEXT "true"/"false", default "true")',
  status: 'STORED_NOT_ENFORCED',
  risk_level: 'LOW',
  warning: 'Stored configuration; no active backend enforcement.',
  enforced_by: [],
  refs: ['client/src/core/context/AuthContext.jsx:241'],
  notes: ['AuthContext exposes getVisibility(key) but no component calls it.'],
});

/** The seven vis.* keys the account holds. */
const VIS_KEYS = [
  ['vis.show_cogs', 'Cost of Goods (COGS)'],
  ['vis.show_purchase_rate', 'Purchase Rate'],
  ['vis.show_sale_rate', 'Sale Rate'],
  ['vis.show_margin', 'Margin %'],
  ['vis.show_gross_profit', 'Gross Profit'],
  ['vis.show_net_profit', 'Net Profit'],
  ['vis.show_balances', 'Account Balances'],
];

/** Catalogued, but this account holds no value for it. */
const UNSTORED_KEY = ['vis.show_landed_cost', 'Landed Cost'];

const CATALOG = {
  version: '1.0.0',
  groups: [{ name: 'Inventory' }],
  totals: { total: 2, by_status: { ACTIVE: 2 } },
  enforcement_summary: { active_permission_count: 2, api_unguarded_active: [] },
  permissions: [
    permission({
      code: 'inventory.stock_transfer',
      backend_module: 'inventory', backend_submodule: 'stock_transfer',
      label: 'Stock Transfer', supported_actions: ['view', 'approve'],
    }),
    permission({
      code: 'inventory.inventory_financial',
      backend_module: 'inventory', backend_submodule: 'inventory_financial',
      label: 'Financial Fields', has_baseline_rows: false,
    }),
  ],
  view_restrictions: [
    {
      code: 'scope.inventory_department',
      business_group: 'View Restrictions',
      label: 'Inventory Departments',
      description: "Restricts which departments' lots a user may see.",
      setting_type: 'DEPARTMENT_SCOPE',
      storage: 'user_inventory_scopes.scope_mode + user_inventory_scope_depts.department_id',
      status: 'ENFORCED',
      risk_level: 'CRITICAL',
      warning: null,
      enforced_by: ['server/services/inventoryAuth.js:168 buildDeptScopeClause'],
      refs: [],
      notes: [],
    },
    {
      code: 'inventory.inventory_financial',
      business_group: 'View Restrictions',
      label: 'Financial Fields',
      description: 'Controls whether rate / cost / value / margin fields are serialised.',
      setting_type: 'CAPABILITY_PERMISSION',
      storage: 'role_permissions / user_permission_overrides',
      status: 'ENFORCED',
      risk_level: 'CRITICAL',
      warning: null,
      enforced_by: ['server/services/inventoryAuth.js:57 resolveCanViewFinancial'],
      refs: [],
      notes: [],
    },
    ...VIS_KEYS.map(([code, label]) => visMeta(code, label)),
    visMeta(...UNSTORED_KEY),
  ],
};

const ROLE_TREE = [
  {
    module: 'inventory',
    label: 'Inventory',
    submodules: [{ key: 'stock_transfer', label: 'Stock Transfer', permissions: 1 }],
  },
];

/** A hidden legacy override row the panel must never disturb. */
const HIDDEN_ROW = { module: 'manufacturing', submodule: 'machines', allow_mask: 1, deny_mask: 2 };

const PREF_ROWS = VIS_KEYS.map(([pref_key], i) => ({
  pref_key,
  pref_value: i === 3 ? 'false' : 'true', // Margin % hidden, the rest visible
}));

function makeApi({
  catalog = CATALOG,
  catalogFails = false,
  scope = { scope_mode: 'SELECTED', departments: [{ department_id: 1 }, { department_id: 2 }] },
  overrides = [HIDDEN_ROW],
  failures = {},
} = {}) {
  const fail = url => Object.keys(failures).find(k => url.includes(k));
  const write = (url) => {
    const key = fail(url);
    return key ? Promise.reject(new Error(failures[key])) : Promise.resolve({ success: true });
  };
  // put and post are separate spies so "no password/reset request went out" is a
  // distinct fact from "the scope PUT went out".
  const put = vi.fn(write);
  const post = vi.fn(write);

  return {
    get: vi.fn((url) => {
      if (url.includes('/permission-catalog')) {
        return catalogFails ? Promise.reject(new Error('boom')) : Promise.resolve(catalog);
      }
      if (url.includes('/preferences')) return Promise.resolve(PREF_ROWS);
      if (url.includes('/api/departments')) return Promise.resolve(DEPARTMENTS);
      if (url.includes('/permission-overrides')) return Promise.resolve({ data: overrides });
      if (url.includes('/permissions')) return Promise.resolve({ data: ROLE_TREE });
      if (url === '/api/roles') {
        return Promise.resolve({ data: [{ id: 2, slug: 'operator', name: 'Operator' }] });
      }
      if (url.includes('/inventory-scope')) return Promise.resolve(scope);
      return Promise.resolve(null);
    }),
    put,
    post,
    del: vi.fn(() => Promise.resolve({ success: true })),
  };
}

/* ── Helpers ────────────────────────────────────────────────── */

const tab = name => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const status = category => screen.getByTestId(`uc-status-${category}`).textContent;

async function openAccessControl(props = {}) {
  const utils = render(<UserDrawer user={USER} onClose={vi.fn()} {...props} />);
  await screen.findByLabelText('Username *');
  fireEvent.click(tab('Access Control'));
  return utils;
}

async function openAsSuperAdmin() {
  render(<UserDrawer user={{ ...USER, role: 'super_admin' }} onClose={vi.fn()} />);
  await screen.findByLabelText('Username *');
  fireEvent.click(tab('Access Control'));
}

const editBtn = () => screen.getByRole('button', { name: 'Edit Inventory Departments' });
const applyBtn = () => screen.getByRole('button', { name: 'Apply' });
const cancelBtn = () => screen.getByRole('button', { name: 'Cancel' });
const detailsBtn = label => screen.getByRole('button', { name: `Details for ${label}` });
const deptDialog = () => screen.getByRole('dialog', { name: /Edit Inventory Departments/ });

/** Every write verb, so "sent no request" can be asserted as one fact. */
const writeCount = () =>
  api.put.mock.calls.length + api.post.mock.calls.length + api.del.mock.calls.length;

const putsTo = fragment => api.put.mock.calls.filter(([url]) => url.includes(fragment));

/**
 * The row containing a given label, for scoped assertions. Scoped to the panel
 * because the card header also carries an "Inventory Departments" summary tile.
 */
const panel = () => document.querySelector('.vr-panel');
const rowFor = label => within(panel()).getByText(label).closest('.vr-row');

beforeEach(() => {
  api = makeApi();
  currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  document.body.style.overflow = '';
});

/* ══════════════════════════════════════════════════════════════
   Panel rendering — component tests 1, 2, 20 to 22
   ══════════════════════════════════════════════════════════════ */

describe('compact panel', () => {
  it('renders the restriction groups (test 1)', async () => {
    await openAccessControl();

    expect(screen.getByText('View Restrictions')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Active and enforced' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Permission controlled' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Stored but not enforced' })).toBeTruthy();
  });

  it('summarises the inventory department scope on one line (test 2)', async () => {
    await openAccessControl();

    const row = rowFor('Inventory Departments');
    expect(within(row).getByText('Growing, Polish 2')).toBeTruthy();
    expect(within(row).getByText('Enforced')).toBeTruthy();
  });

  it('shows an overflow summary rather than a permanent checkbox list', async () => {
    api = makeApi({
      scope: {
        scope_mode: 'SELECTED',
        departments: DEPARTMENTS.map(d => ({ department_id: d.id })),
      },
    });
    await openAccessControl();

    expect(within(rowFor('Inventory Departments')).getByText('Growing, Polish 2 +3 more'))
      .toBeTruthy();
    // No department checkbox list and no search box are mounted on the tab.
    expect(screen.queryByLabelText('Growing')).toBeNull();
    expect(screen.queryByLabelText('Search departments')).toBeNull();
  });

  it('keeps every stored-but-unenforced row read-only (tests 20, 21, 22)', async () => {
    await openAccessControl();

    // The Brick 2 honesty string survives verbatim, once per stored key.
    expect(screen.getAllByText('Stored setting — backend enforcement not implemented'))
      .toHaveLength(7);

    for (const [, label] of VIS_KEYS) {
      const row = rowFor(label);
      expect(within(row).getByText('Not enforced')).toBeTruthy();
      // The only affordance is Details — no switch, checkbox or radio anywhere.
      expect(within(row).queryByRole('switch')).toBeNull();
      expect(within(row).queryByRole('checkbox')).toBeNull();
      expect(within(row).getByRole('button').textContent).toBe('Details');
    }

    expect(within(rowFor('Margin %')).getByText('Hidden')).toBeTruthy();
    expect(within(rowFor('Purchase Rate')).getByText('Visible')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Department dialog — component tests 3 to 9
   ══════════════════════════════════════════════════════════════ */

describe('inventory department dialog', () => {
  it('opens as a focus-trapped modal (test 3)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    const dialog = deptDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: 'Selected Departments' }).checked).toBe(true);
    expect(within(dialog).getByLabelText('Growing').checked).toBe(true);
    expect(within(dialog).getByLabelText('Mumbai').checked).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('filters the department list as you search (test 4)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    expect(within(deptDialog()).getAllByRole('checkbox')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('Search departments'), { target: { value: 'pol' } });

    const dialog = deptDialog();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(dialog).getByLabelText('Polish 2')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Growing')).toBeNull();
  });

  it('selects and clears all departments (tests 5, 6)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    fireEvent.click(screen.getByRole('button', { name: 'Select all departments' }));
    expect(screen.getByText('5 of 5 departments selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all selected departments' }));
    expect(screen.getByText('0 of 5 departments selected')).toBeTruthy();
    // The empty whitelist the API rejects is called out rather than silently applied.
    expect(screen.getByRole('alert').textContent).toMatch(/rejected by the inventory-scope/);
  });

  it('restricts Select All to the current search', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    fireEvent.click(screen.getByRole('button', { name: 'Clear all selected departments' }));
    fireEvent.change(screen.getByLabelText('Search departments'), { target: { value: 'mum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all matching departments' }));

    expect(screen.getByText('1 of 5 departments selected')).toBeTruthy();
  });

  it('discards local dialog changes on Cancel (test 7)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    fireEvent.click(screen.getByLabelText('Mumbai'));
    fireEvent.click(cancelBtn());

    expect(screen.queryByRole('dialog', { name: /Edit Inventory Departments/ })).toBeNull();
    expect(within(rowFor('Inventory Departments')).getByText('Growing, Polish 2')).toBeTruthy();
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });

  it('updates pending card state on Apply (test 8)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    fireEvent.click(screen.getByLabelText('Mumbai'));
    fireEvent.click(applyBtn());

    expect(within(rowFor('Inventory Departments')).getByText('Growing, Polish 2 +1 more'))
      .toBeTruthy();
    expect(tab('Access Control').textContent).toContain('has unsaved changes');
    // Pending, not written.
    expect(writeCount()).toBe(0);
  });

  it('cannot apply an unchanged scope (test 9)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());

    expect(applyBtn().disabled).toBe(true);

    // Toggling a department and toggling it back returns to unchanged.
    fireEvent.click(screen.getByLabelText('Mumbai'));
    expect(applyBtn().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Mumbai'));
    expect(applyBtn().disabled).toBe(true);

    // Department order alone is not a change either.
    fireEvent.click(screen.getByLabelText('Growing'));
    fireEvent.click(screen.getByLabelText('Growing'));
    expect(applyBtn().disabled).toBe(true);
  });

  it('returns focus to the row button when the dialog closes', async () => {
    await openAccessControl();
    // fireEvent.click does not move focus in jsdom, so focus the trigger the way
    // a real keyboard or pointer interaction would before opening.
    editBtn().focus();
    fireEvent.click(editBtn());
    expect(deptDialog().contains(document.activeElement)).toBe(true);

    fireEvent.click(cancelBtn());
    expect(document.activeElement).toBe(editBtn());
  });

  it('closes on Escape without closing the user card', async () => {
    const onClose = vi.fn();
    await openAccessControl({ onClose });
    fireEvent.click(editBtn());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Edit Inventory Departments/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════
   Dirty state and save isolation — component tests 10 to 16
   ══════════════════════════════════════════════════════════════ */

describe('dirty state and save isolation', () => {
  it('marks only Access Control dirty on a scope change (test 10)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    fireEvent.click(applyBtn());

    expect(tab('Access Control').textContent).toContain('has unsaved changes');
    expect(tab('General').textContent).not.toContain('has unsaved changes');
    expect(tab('Preferences').textContent).not.toContain('has unsaved changes');
    expect(tab('Security').textContent).not.toContain('has unsaved changes');
  });

  it('clears the dirty flag when the original scope is restored (test 11)', async () => {
    await openAccessControl();

    fireEvent.click(editBtn());
    fireEvent.click(screen.getByLabelText('Mumbai'));
    fireEvent.click(applyBtn());
    expect(tab('Access Control').textContent).toContain('has unsaved changes');

    fireEvent.click(editBtn());
    fireEvent.click(screen.getByLabelText('Mumbai'));
    fireEvent.click(applyBtn());
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });

  it('saves through the existing endpoint with a byte-compatible payload (tests 12, 13)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());
    fireEvent.click(screen.getByLabelText('Mumbai'));
    fireEvent.click(applyBtn());

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    const calls = putsTo('/inventory-scope');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/api/admin/users/1/inventory-scope');
    expect(calls[0][1]).toEqual({
      scope_mode: 'SELECTED',
      include_unassigned: false,
      department_ids: [1, 2, 4],
    });
    expect(Object.keys(calls[0][1]))
      .toEqual(['scope_mode', 'include_unassigned', 'department_ids']);
  });

  it('sends nothing but the scope request (tests 14, 15, 16)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'No Access' }));
    fireEvent.click(applyBtn());

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(putsTo('/inventory-scope')).toHaveLength(1);
    expect(putsTo('/permission-overrides')).toHaveLength(0);
    expect(putsTo('/preferences')).toHaveLength(0);
    expect(putsTo('/roles')).toHaveLength(0);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.del).not.toHaveBeenCalled();

    // NONE clears the whitelist, matching the pre-Brick-4 contract.
    expect(putsTo('/inventory-scope')[0][1])
      .toEqual({ scope_mode: 'NONE', include_unassigned: false, department_ids: [] });
  });

  it('leaves the hidden legacy override row untouched by a scope edit', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    fireEvent.click(applyBtn());

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    // No override PUT at all, so the stored rows — including the hidden one — stand.
    expect(putsTo('/permission-overrides')).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   Financial Fields — component tests 17 to 19
   ══════════════════════════════════════════════════════════════ */

describe('financial fields row', () => {
  it('derives its state from the effective permission (test 17)', async () => {
    await openAccessControl();

    const row = rowFor('Financial Fields');
    expect(within(row).getByText('Hidden')).toBeTruthy();
    expect(within(row).getByText('Permission controlled')).toBeTruthy();
    expect(within(row).getByText('Default deny — no baseline configured')).toBeTruthy();
  });

  it('follows a user allow override', async () => {
    api = makeApi({
      overrides: [
        HIDDEN_ROW,
        { module: 'inventory', submodule: 'inventory_financial', allow_mask: 1, deny_mask: 0 },
      ],
    });
    await openAccessControl();

    const row = rowFor('Financial Fields');
    expect(within(row).getByText('Visible')).toBeTruthy();
    expect(within(row).getByText('Explicit user allow')).toBeTruthy();
  });

  it('deep-links to the same capability in the Brick 3 editor (test 18)', async () => {
    await openAccessControl();

    fireEvent.click(screen.getByRole('button', {
      name: 'View Financial Fields in the permission editor',
    }));

    const search = screen.getByLabelText(
      'Search permissions by capability, description, action or backend key',
    );
    expect(search.value).toBe('inventory.inventory_financial');
    // The capability is revealed in the editor, not duplicated into the row.
    expect(await screen.findByRole('button', { name: /^Inventory/ })).toBeTruthy();
  });

  it('offers no second Allow/Deny control (test 19)', async () => {
    await openAccessControl();

    const row = rowFor('Financial Fields');
    expect(within(row).queryByRole('radiogroup')).toBeNull();
    expect(within(row).queryByRole('radio')).toBeNull();
    expect(within(row).queryByRole('switch')).toBeNull();
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByRole('button').textContent).toBe('View Permission');
  });
});

/* ══════════════════════════════════════════════════════════════
   Details dialog and diagnostics — component tests 23, 24
   ══════════════════════════════════════════════════════════════ */

describe('details and diagnostics', () => {
  it('shows a read-only details dialog with no activation control (test 23)', async () => {
    await openAccessControl();
    fireEvent.click(detailsBtn('Margin %'));

    const dialog = screen.getByRole('dialog', { name: 'Margin %' });
    expect(within(dialog).getByText('vis.show_margin')).toBeTruthy();
    expect(within(dialog).getByText('false')).toBeTruthy();
    expect(within(dialog).getByText(/no active backend enforcement/)).toBeTruthy();
    expect(within(dialog).getByText(/would not protect any data/)).toBeTruthy();

    // Close is the only action; nothing here can activate the setting.
    expect(within(dialog).getAllByRole('button').map(b => b.textContent)).toEqual(['Close']);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('switch')).toBeNull();
    expect(writeCount()).toBe(0);
  });

  it('hides inactive diagnostics from a normal admin (test 23)', async () => {
    await openAccessControl();

    expect(screen.queryByRole('region', { name: 'Inactive diagnostics' })).toBeNull();
    expect(screen.queryByText('Landed Cost')).toBeNull();
  });

  it('shows inactive diagnostics read-only to Super Admin (test 24)', async () => {
    await openAsSuperAdmin();

    const region = screen.getByRole('region', { name: 'Inactive diagnostics' });
    const row = within(region).getByText('Landed Cost').closest('.vr-row');
    expect(within(row).getByText('Inactive')).toBeTruthy();
    expect(within(row).getByText('Inactive — not granted to any standard role')).toBeTruthy();
    expect(within(row).getByText('No stored value')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Details for Landed Cost' }));
    const dialog = screen.getByRole('dialog', { name: 'Landed Cost' });
    expect(within(dialog).getByText(/No value stored for this user — Brick 4 does not create one/))
      .toBeTruthy();
    expect(within(dialog).getAllByRole('button').map(b => b.textContent)).toEqual(['Close']);
    expect(writeCount()).toBe(0);
  });

  it('marks the department scope Not applicable for Super Admin and offers no editor', async () => {
    await openAsSuperAdmin();

    const row = rowFor('Inventory Departments');
    expect(within(row).getByText('Not applicable')).toBeTruthy();
    expect(within(row).getByText(/bypasses inventory department scope entirely/)).toBeTruthy();
    expect(within(row).getByText('Read-only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Inventory Departments' })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Catalog failure — component tests 25, 26
   ══════════════════════════════════════════════════════════════ */

describe('catalog failure fallback', () => {
  it('keeps the scope editor usable and says why (test 25)', async () => {
    api = makeApi({ catalogFails: true });
    await openAccessControl();

    expect(screen.getByText(
      'View restriction diagnostics unavailable. Existing inventory scope controls remain available.',
    )).toBeTruthy();

    fireEvent.click(editBtn());
    expect(within(deptDialog()).getByRole('radio', { name: 'Selected Departments' }).checked)
      .toBe(true);
    expect(within(deptDialog()).getByLabelText('Growing').checked).toBe(true);
  });

  it('resets no value and claims no enforcement it cannot verify (test 26)', async () => {
    api = makeApi({ catalogFails: true });
    await openAccessControl();

    // The stored values survive, still labelled honestly, and nothing was written.
    expect(screen.getAllByText('Stored setting — backend enforcement not implemented'))
      .toHaveLength(7);
    expect(within(rowFor('Inventory Departments')).getByText('Growing, Polish 2')).toBeTruthy();
    expect(within(rowFor('Inventory Departments')).getByText('Unverified')).toBeTruthy();
    expect(screen.queryByText('Enforced')).toBeNull();
    expect(writeCount()).toBe(0);
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });
});

/* ══════════════════════════════════════════════════════════════
   Brick 2 and Brick 3 unchanged — component tests 27 to 34
   ══════════════════════════════════════════════════════════════ */

describe('earlier bricks are unchanged', () => {
  it('keeps the Brick 3 grouped editor functional (test 27)', async () => {
    await openAccessControl();

    const group = screen.getByRole('button', { name: /^Inventory/ });
    fireEvent.click(group);
    expect(screen.getByRole('button', { name: /^Inventory/ }).getAttribute('aria-expanded'))
      .toBe('true');
    expect(screen.getByText('Stock Transfer')).toBeTruthy();
  });

  it('keeps Brick 2 dirty-close protection (test 28)', async () => {
    const onClose = vi.fn();
    await openAccessControl({ onClose });

    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    fireEvent.click(applyBtn());

    fireEvent.click(screen.getByRole('button', { name: 'Close user card' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('keeps partial-save reporting honest (test 29)', async () => {
    api = makeApi({ failures: { '/inventory-scope': 'nope' } });
    await openAccessControl();

    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    fireEvent.click(applyBtn());

    fireEvent.click(tab('General'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('access')).toContain('Failed'));
    expect(status('general')).toContain('Saved');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('leaves General, Preferences and Security unaffected (test 30)', async () => {
    await openAccessControl();
    fireEvent.click(editBtn());
    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    fireEvent.click(applyBtn());

    fireEvent.click(tab('Preferences'));
    expect(screen.getByRole('switch', { name: 'Compact Mode' })).toBeTruthy();
    // The unenforced vis.* keys are still absent from the editable preferences tab.
    expect(screen.queryByRole('switch', { name: 'Margin %' })).toBeNull();

    fireEvent.click(tab('Security'));
    expect(screen.getByLabelText('New Password')).toBeTruthy();

    fireEvent.click(tab('General'));
    expect(screen.getByLabelText('Full Name *').value).toBe('Test Operator');
  });

  it('keeps Copy Setup, Audit History and Password Reset wired (tests 31, 32, 33)', async () => {
    const onCopySetup = vi.fn();
    const onViewAudit = vi.fn();
    await openAccessControl({ onCopySetup, onViewAudit });

    fireEvent.click(screen.getByRole('button', { name: /Copy Setup/ }));
    expect(onCopySetup).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /View Audit/ }));
    expect(onViewAudit).toHaveBeenCalled();

    fireEvent.click(tab('Security'));
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/admin/users/1/reset-password', { password: 'newpass123' },
    ));
  });

  it('changes no role or permission value merely by rendering (test 34)', async () => {
    await openAccessControl();

    // Opening the panel, a dialog, searching and cancelling are all read-only.
    fireEvent.click(editBtn());
    fireEvent.change(screen.getByLabelText('Search departments'), { target: { value: 'pol' } });
    fireEvent.click(cancelBtn());
    fireEvent.click(detailsBtn('Account Balances'));
    const details = screen.getByRole('dialog', { name: 'Account Balances' });
    fireEvent.click(within(details).getByRole('button', { name: 'Close' }));

    expect(writeCount()).toBe(0);
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    expect(writeCount()).toBe(0);
  });
});
