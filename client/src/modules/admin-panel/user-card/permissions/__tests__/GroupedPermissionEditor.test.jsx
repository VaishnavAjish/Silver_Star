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
   Fixtures
   ══════════════════════════════════════════════════════════════ */

const USER = {
  id: 1,
  username: 'testadmin',
  full_name: 'Test Admin',
  email: 'test@example.com',
  role: 'operator',
  is_active: true,
  department_id: 3,
  created_at: '2026-01-15T00:00:00.000Z',
};

const ENFORCED = {
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'ENFORCED',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const UNGUARDED = {
  navigation: 'NOT_ENFORCED', frontend_route: 'NOT_ENFORCED', frontend_action: 'NOT_ENFORCED',
  api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY', api_create: 'AUTHENTICATE_ONLY',
  api_edit: 'AUTHENTICATE_ONLY', api_delete: 'AUTHENTICATE_ONLY',
  api_approve: 'NO_ACTIVE_FEATURE', export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

function entry(over) {
  const submodule = over.backend_submodule ?? '';
  return {
    code: `${over.backend_module}.${submodule === '' ? '__module__' : submodule}`,
    backend_submodule: submodule,
    business_group: 'Inventory',
    description: '',
    status: 'ACTIVE',
    risk_level: 'MEDIUM',
    control_type: 'ACTION_MATRIX',
    supported_actions: ['view'],
    has_baseline_rows: true,
    canonical_code: null,
    empty_submodule_meaning: submodule === '' ? 'MODULE_ACCESS' : null,
    enforcement: ENFORCED,
    notes: [],
    ...over,
  };
}

const CATALOG = {
  version: '1.0.0',
  groups: [{ name: 'Inventory' }, { name: 'Manufacturing' }, { name: 'Administration' }],
  totals: { total: 6, by_status: { ACTIVE: 4 } },
  enforcement_summary: { active_permission_count: 4, api_unguarded_active: ['inventory.seed_stock'] },
  permissions: [
    entry({
      backend_module: 'inventory', backend_submodule: 'stock_transfer',
      label: 'Stock Transfer', description: 'Move lots between departments.',
      risk_level: 'HIGH', supported_actions: ['view', 'create', 'approve'],
    }),
    entry({
      backend_module: 'inventory', backend_submodule: 'seed_stock',
      label: 'Seed Stock', has_baseline_rows: false,
      supported_actions: ['view', 'export'], enforcement: UNGUARDED,
    }),
    entry({
      backend_module: 'manufacturing', backend_submodule: 'control_tower',
      business_group: 'Manufacturing', label: 'Control Tower',
      supported_actions: ['view', 'sidebar'],
    }),
    entry({
      backend_module: 'manufacturing', backend_submodule: 'machines',
      business_group: 'Manufacturing', label: 'Machines (manufacturing duplicate)',
      status: 'DUPLICATE_LEGACY', canonical_code: 'master_data.machines',
      supported_actions: ['view', 'create'],
    }),
    entry({
      backend_module: 'hr', backend_submodule: 'employees',
      business_group: 'Administration', label: 'Employees',
      status: 'PLANNED_INACTIVE', supported_actions: ['view'],
    }),
    entry({
      backend_module: 'admin', backend_submodule: 'users',
      business_group: 'Administration', label: 'Users',
      supported_actions: ['view', 'manage'],
    }),
  ],
};

/** view granted on stock_transfer and control_tower; everything else withheld. */
const ROLE_TREE = [
  {
    module: 'inventory',
    label: 'Inventory',
    submodules: [
      { key: 'stock_transfer', label: 'Stock Transfer', permissions: 1 },
      { key: 'seed_stock', label: 'Seed Stock', permissions: 0 },
    ],
  },
  {
    module: 'manufacturing',
    label: 'Manufacturing',
    submodules: [
      { key: 'control_tower', label: 'Control Tower', permissions: 1 },
      { key: 'machines', label: 'Machines', permissions: 0 },
    ],
  },
  { module: 'admin', label: 'Admin', submodules: [{ key: 'users', label: 'Users', permissions: 0 }] },
];

/**
 * A hidden duplicate-legacy row the grouped editor never displays. Every save
 * assertion checks it survives, because PUT /permission-overrides replaces the
 * whole row set for the user.
 */
const HIDDEN_ROW = { module: 'manufacturing', submodule: 'machines', allow_mask: 1, deny_mask: 2 };

function makeApi({ catalog = CATALOG, catalogFails = false, failures = {} } = {}) {
  const fail = url => Object.keys(failures).find(k => url.includes(k));
  const write = vi.fn((url) => {
    const key = fail(url);
    return key ? Promise.reject(new Error(failures[key])) : Promise.resolve({ success: true });
  });

  return {
    get: vi.fn((url) => {
      if (url.includes('/permission-catalog')) {
        return catalogFails ? Promise.reject(new Error('boom')) : Promise.resolve(catalog);
      }
      if (url.includes('/preferences')) return Promise.resolve([]);
      if (url.includes('/api/departments')) return Promise.resolve([{ id: 3, name: 'Surat HO' }]);
      if (url.includes('/permission-overrides')) return Promise.resolve({ data: [HIDDEN_ROW] });
      if (url.includes('/permissions')) return Promise.resolve({ data: ROLE_TREE });
      if (url === '/api/roles') {
        return Promise.resolve({ data: [{ id: 2, slug: 'operator', name: 'Operator' }] });
      }
      if (url.includes('/inventory-scope')) {
        return Promise.resolve({ scope_mode: 'ALL', departments: [] });
      }
      return Promise.resolve(null);
    }),
    put: write,
    post: write,
    del: vi.fn(() => Promise.resolve({ success: true })),
  };
}

const tab = name => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const status = category => screen.getByTestId(`uc-status-${category}`).textContent;
const groupBtn = name => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const filterBtn = name => screen.getByRole('button', { name });

/** Renders, waits for the initial load, then opens Access Control. */
async function openAccessControl(props = {}) {
  const utils = render(<UserDrawer user={USER} onClose={vi.fn()} {...props} />);
  await screen.findByLabelText('Username *');
  fireEvent.click(tab('Access Control'));
  await screen.findByText('Permission Overrides');
  return utils;
}

/** The tri-state control for one capability/action pair. */
const overrideControl = (capabilityLabel, actionLabel) =>
  screen.getByRole('radiogroup', { name: `${capabilityLabel} — ${actionLabel} user override` });

const stateButton = (control, state) => within(control).getByRole('radio', { name: state });

beforeEach(() => {
  api = makeApi();
  currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => { document.body.style.overflow = ''; });

/* ══════════════════════════════════════════════════════════════
   Rendering — component tests 1, 2, 24
   ══════════════════════════════════════════════════════════════ */

describe('grouped rendering', () => {
  it('renders business groups in the catalog order (test 1)', async () => {
    await openAccessControl();
    const names = screen.getAllByRole('button')
      .map(b => b.textContent)
      .filter(t => /capabilities/.test(t));
    expect(names[0]).toContain('Inventory');
    expect(names[1]).toContain('Manufacturing');
    expect(names[2]).toContain('Administration');
  });

  it('starts with every group collapsed and shows per-group counts', async () => {
    await openAccessControl();
    expect(groupBtn('Inventory').getAttribute('aria-expanded')).toBe('false');
    expect(groupBtn('Inventory').textContent).toContain('2 capabilities');
    // seed_stock is unguarded on every surface.
    expect(groupBtn('Inventory').textContent).toContain('1 unenforced');
  });

  it('shows only the actions the catalog declares for a capability (test 2)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const card = screen.getByLabelText('Stock Transfer');
    expect(within(card).getAllByRole('radiogroup').map(g => g.getAttribute('aria-label'))).toEqual([
      'Stock Transfer — VIEW user override',
      'Stock Transfer — CREATE user override',
      'Stock Transfer — APPROVE user override',
    ]);
    expect(within(card).queryByRole('radiogroup', { name: /DELETE/ })).toBeNull();
  });

  it('never renders a duplicate legacy entry as an editable capability', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Manufacturing'));
    expect(screen.getByLabelText('Control Tower')).toBeTruthy();
    expect(screen.queryByLabelText('Machines (manufacturing duplicate)')).toBeNull();
  });

  it('states the missing baseline honestly rather than inventing a denial (test 24)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const card = screen.getByLabelText('Seed Stock');
    expect(within(card).getByText(/No role baseline row exists for this capability/)).toBeTruthy();
    expect(within(card).getAllByText('No baseline').length).toBe(2);
    expect(within(card).getAllByText('Default deny — no baseline configured').length).toBe(2);
    // The control stays usable: user overrides do not require a role row.
    expect(stateButton(overrideControl('Seed Stock', 'VIEW'), 'Allow').disabled).toBe(false);
  });

  it('shows the role baseline, effective result and source for every action', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    const card = screen.getByLabelText('Stock Transfer');

    expect(within(card).getByText('Role baseline — Operator')).toBeTruthy();
    expect(within(card).getAllByText('Role baseline — not granted')).toHaveLength(2);
  });

  it('never renders a blank submodule for a module-access row', async () => {
    const catalog = {
      ...CATALOG,
      permissions: [...CATALOG.permissions, entry({
        backend_module: 'inventory', backend_submodule: '',
        label: 'Inventory (module access)', control_type: 'MODULE_ACCESS',
      })],
    };
    api = makeApi({ catalog });
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const card = screen.getByLabelText('Inventory (module access)');
    expect(within(card).getByText(/module-level access/)).toBeTruthy();
    // The role API's tree carries no submodule = '' key, so the baseline is
    // reported as not-reported rather than fabricated as "no baseline".
    expect(within(card).getByText('Not reported')).toBeTruthy();
    expect(within(card).getByText(/carries no entry for this key/)).toBeTruthy();
  });

  it('reports enforcement honestly instead of one "secure" badge', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    expect(within(screen.getByLabelText('Stock Transfer')).getByText('Enforced')).toBeTruthy();
    expect(within(screen.getByLabelText('Seed Stock')).getByText('Not enforced')).toBeTruthy();
    expect(screen.getByText(/Backend enforcement closure is scheduled for RBAC Brick 8/)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Search and filters — component tests 3 to 10
   ══════════════════════════════════════════════════════════════ */

describe('search and filters', () => {
  const searchBox = () => screen.getByLabelText(/^Search permissions/);

  it('finds a capability by its business label and reveals its group (tests 3, 5)', async () => {
    await openAccessControl();
    fireEvent.change(searchBox(), { target: { value: 'control tower' } });

    await waitFor(() => expect(screen.getByLabelText('Control Tower')).toBeTruthy());
    expect(groupBtn('Manufacturing').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Inventory/ })).toBeNull();
  });

  it('finds a capability by its backend key (test 4)', async () => {
    await openAccessControl();
    fireEvent.change(searchBox(), { target: { value: 'seed_stock' } });

    await waitFor(() => expect(screen.getByLabelText('Seed Stock')).toBeTruthy());
    expect(screen.queryByLabelText('Stock Transfer')).toBeNull();
  });

  it('shows a useful empty state and restores on clear (test 6)', async () => {
    await openAccessControl();
    fireEvent.change(searchBox(), { target: { value: 'zzzz-no-such-thing' } });

    await screen.findByText('No capability matches the current search and filters.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));

    await waitFor(() => expect(groupBtn('Inventory')).toBeTruthy());
    expect(searchBox().value).toBe('');
  });

  it('filters to actions carrying an override (test 7)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Allow'));
    fireEvent.click(filterBtn('Show Overrides Only'));

    expect(filterBtn('Show Overrides Only').getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByLabelText('Stock Transfer')).getAllByRole('radiogroup'))
      .toHaveLength(1);
    expect(screen.queryByLabelText('Seed Stock')).toBeNull();
  });

  it('filters to effectively denied actions (test 8)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(filterBtn('Show Denied Only'));

    const card = screen.getByLabelText('Stock Transfer');
    // view is allowed by the role, so only create and approve survive.
    expect(within(card).getAllByRole('radiogroup').map(g => g.getAttribute('aria-label'))).toEqual([
      'Stock Transfer — CREATE user override',
      'Stock Transfer — APPROVE user override',
    ]);
  });

  it('filters to capabilities without full enforcement (test 9)', async () => {
    await openAccessControl();
    fireEvent.click(filterBtn('Show Unenforced'));
    fireEvent.click(groupBtn('Inventory'));

    expect(screen.getByLabelText('Seed Stock')).toBeTruthy();
    expect(screen.queryByLabelText('Stock Transfer')).toBeNull();
  });

  it('combines filters and reports the active count (test 10)', async () => {
    await openAccessControl();
    fireEvent.click(filterBtn('Show Denied Only'));
    fireEvent.click(filterBtn('Show Unenforced'));

    expect(screen.getByRole('button', { name: /Clear Filters \(2 active\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clear Filters/ }));
    expect(filterBtn('Show Denied Only').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows inactive entries read-only, with no override control', async () => {
    await openAccessControl();
    fireEvent.click(filterBtn('Show Inactive Diagnostics'));
    fireEvent.click(groupBtn('Manufacturing'));

    expect(screen.getByText('Machines (manufacturing duplicate)')).toBeTruthy();
    expect(screen.getByText(/Stored override preserved: VIEW — Allow, CREATE — Deny/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: /Machines/ })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Expansion — component tests 11 to 13
   ══════════════════════════════════════════════════════════════ */

describe('group expansion', () => {
  it('expands and collapses every group (tests 11, 12)', async () => {
    await openAccessControl();

    fireEvent.click(screen.getByRole('button', { name: /Expand All/ }));
    expect(groupBtn('Inventory').getAttribute('aria-expanded')).toBe('true');
    expect(groupBtn('Administration').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Collapse All/ }));
    expect(groupBtn('Inventory').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Stock Transfer')).toBeNull();
  });

  it('never makes the card dirty by expanding, collapsing, searching or filtering (test 13)', async () => {
    await openAccessControl();

    fireEvent.click(screen.getByRole('button', { name: /Expand All/ }));
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(filterBtn('Show Denied Only'));
    fireEvent.change(screen.getByLabelText(/^Search permissions/), { target: { value: 'stock' } });
    await waitFor(() => expect(screen.getByLabelText('Stock Transfer')).toBeTruthy());

    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
    expect(status('access')).toContain('Not Changed');
  });
});

/* ══════════════════════════════════════════════════════════════
   Editing, dirty state and save — component tests 14 to 18, 27
   ══════════════════════════════════════════════════════════════ */

describe('editing and saving', () => {
  it('marks Access Control dirty on an override change (test 14)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const control = overrideControl('Stock Transfer', 'APPROVE');
    expect(stateButton(control, 'Inherit').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(stateButton(control, 'Allow'));

    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Allow')
      .getAttribute('aria-checked')).toBe('true');
    expect(tab('Access Control').textContent).toContain('has unsaved changes');
    // The effective result follows immediately.
    expect(within(screen.getByLabelText('Stock Transfer')).getByText('Explicit user allow'))
      .toBeTruthy();
  });

  it('clears the dirty flag when the override is put back (test 15)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));
    expect(tab('Access Control').textContent).toContain('has unsaved changes');

    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Inherit'));
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });

  it('saves through the existing endpoint and preserves the hidden legacy row (tests 16, 26)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    const call = api.put.mock.calls.find(c => c[0].endsWith('/permission-overrides'));
    expect(call[0]).toBe('/api/admin/users/1/permission-overrides');
    expect(call[1].overrides).toEqual(expect.arrayContaining([
      { module: 'manufacturing', submodule: 'machines', allow_mask: 1, deny_mask: 2 },
      { module: 'inventory', submodule: 'stock_transfer', allow_mask: 0, deny_mask: 16 },
    ]));
    expect(call[1].overrides).toHaveLength(2);
  });

  it('never writes to the role permission endpoint (test 27)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));
    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('access')).toContain('Saved'));
    expect(api.put.mock.calls.some(c => /\/api\/roles\/\d+\/permissions/.test(c[0]))).toBe(false);
  });

  it('keeps a failed save dirty and retryable (test 17)', async () => {
    api = makeApi({ failures: { '/permission-overrides': 'override endpoint exploded' } });
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Failed'));

    expect(tab('Access Control').textContent).toContain('has unsaved changes');
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny')
      .getAttribute('aria-checked')).toBe('true');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('advances the snapshot after a successful save (test 18)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
    expect(screen.getByRole('button', { name: /Save All Changes/ }).disabled).toBe(true);
    // The edit is kept, not reloaded away.
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny')
      .getAttribute('aria-checked')).toBe('true');
  });
});

/* ══════════════════════════════════════════════════════════════
   Reset — component tests 25, 26
   ══════════════════════════════════════════════════════════════ */

describe('reset', () => {
  it('requires confirmation and states what changes (test 25)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));

    fireEvent.click(screen.getByRole('button', { name: /Reset Stock Transfer/ }));

    const dialog = screen.getAllByRole('dialog').find(d => d.className.includes('uc-dialog'));
    expect(within(dialog).getByText('Reset Stock Transfer?')).toBeTruthy();
    expect(within(dialog).getByText(/Test Admin \(testadmin\)/)).toBeTruthy();
    expect(within(dialog).getByText(/The role baseline is not changed/)).toBeTruthy();
    expect(within(dialog).getByText(/legacy or inactive keys/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Inherit' }));
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Inherit')
      .getAttribute('aria-checked')).toBe('true');
  });

  it('resets every visible override while preserving hidden rows (test 26)', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));
    fireEvent.click(stateButton(overrideControl('Seed Stock', 'VIEW'), 'Allow'));

    fireEvent.click(screen.getByRole('button', { name: /Reset Visible Overrides/ }));
    const dialog = screen.getAllByRole('dialog').find(d => d.className.includes('uc-dialog'));
    expect(within(dialog).getByText(/Returns/).textContent).toContain('2');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Inherit' }));

    // Both visible overrides are back to the loaded state, so nothing is dirty…
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Inherit')
      .getAttribute('aria-checked')).toBe('true');
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
    // …and the hidden legacy row is still counted and still stored.
    expect(screen.getByText(/1 stored override record belong/)).toBeTruthy();

    // A fresh edit then saves that hidden row alongside it, untouched.
    fireEvent.click(groupBtn('Manufacturing'));
    fireEvent.click(stateButton(overrideControl('Control Tower', 'VIEW'), 'Deny'));
    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Saved'));

    const call = api.put.mock.calls.find(c => c[0].endsWith('/permission-overrides'));
    expect(call[1].overrides).toEqual(expect.arrayContaining([
      { module: 'manufacturing', submodule: 'machines', allow_mask: 1, deny_mask: 2 },
      { module: 'manufacturing', submodule: 'control_tower', allow_mask: 0, deny_mask: 1 },
    ]));
    expect(call[1].overrides).toHaveLength(2);
  });

  it('routes "Reset All Stored Overrides" to the dedicated endpoint', async () => {
    await openAccessControl();
    fireEvent.click(screen.getByRole('button', { name: 'Reset All Stored Overrides' }));

    expect(screen.getByText('Reset permission overrides?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Overrides' }));

    await waitFor(() => {
      expect(api.del).toHaveBeenCalledWith('/api/admin/users/1/permission-overrides');
    });
  });
});

/* ══════════════════════════════════════════════════════════════
   Fallback — component tests 19 to 21
   ══════════════════════════════════════════════════════════════ */

describe('catalog failure fallback', () => {
  const FALLBACK_MESSAGE = /Grouped permission catalog unavailable/;

  it('renders the legacy matrix when the catalog endpoint fails (test 19)', async () => {
    api = makeApi({ catalogFails: true });
    await openAccessControl();

    expect(await screen.findByText(FALLBACK_MESSAGE)).toBeTruthy();
    expect(screen.getByText(/the catalog endpoint failed/)).toBeTruthy();
    expect(screen.getByLabelText(/^Dashboard Dashboard VIEW/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Expand All/ })).toBeNull();
  });

  it('renders the legacy matrix when the catalog is structurally invalid (test 20)', async () => {
    api = makeApi({ catalog: { version: '1.0.0', groups: [], permissions: [] } });
    await openAccessControl();

    expect(await screen.findByText(FALLBACK_MESSAGE)).toBeTruthy();
    expect(screen.getByText(/contains no permission entries/)).toBeTruthy();
  });

  it('renders the legacy matrix when an active entry declares an unknown action', async () => {
    const catalog = {
      ...CATALOG,
      permissions: [entry({
        backend_module: 'inventory', backend_submodule: 'ghost',
        label: 'Ghost', supported_actions: ['teleport'],
      })],
    };
    api = makeApi({ catalog });
    await openAccessControl();

    expect(await screen.findByText(FALLBACK_MESSAGE)).toBeTruthy();
    expect(screen.getByText(/unknown action "teleport"/)).toBeTruthy();
  });

  it('keeps the legacy matrix fully functional in fallback mode (test 21)', async () => {
    api = makeApi({ catalogFails: true });
    await openAccessControl();

    fireEvent.click(await screen.findByLabelText(/^Dashboard Dashboard VIEW: INHERIT/));
    expect(await screen.findByLabelText(/^Dashboard Dashboard VIEW: ALLOW/)).toBeTruthy();
    expect(tab('Access Control').textContent).toContain('has unsaved changes');
  });

  it('never shows both editors at once', async () => {
    await openAccessControl();
    expect(screen.queryByLabelText(/^Dashboard Dashboard VIEW/)).toBeNull();
    expect(screen.getByRole('button', { name: /Expand All/ })).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Super Admin — component tests 22, 23
   ══════════════════════════════════════════════════════════════ */

describe('Super Admin', () => {
  async function openSuperAdmin() {
    render(<UserDrawer user={{ ...USER, role: 'super_admin' }} onClose={vi.fn()} />);
    await screen.findByLabelText('Username *');
    fireEvent.click(tab('Access Control'));
    await screen.findByText('Permission Overrides');
  }

  it('states the bypass (test 22)', async () => {
    await openSuperAdmin();
    expect(screen.getByText(
      /Super Admin effective access bypasses role and user override masks\./,
    )).toBeTruthy();
  });

  it('resolves every action as Allowed by bypass and locks the controls (test 23)', async () => {
    await openSuperAdmin();
    fireEvent.click(groupBtn('Inventory'));

    const card = screen.getByLabelText('Stock Transfer');
    // Three effective verdicts, all from the bypass. The baseline column stays
    // honest — no role tree was read for this account, so it is reported as
    // not-reported rather than dressed up as a role grant.
    expect(within(card).getAllByText('Allowed')).toHaveLength(3);
    expect(within(card).getAllByText('Super Admin bypass')).toHaveLength(3);
    expect(within(card).getAllByText('Not reported')).toHaveLength(3);
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Reset Visible Overrides/ })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Brick 2 behaviour still in force — component tests 28 to 35
   ══════════════════════════════════════════════════════════════ */

describe('Brick 2 behaviour is unchanged', () => {
  it('keeps the inventory department editor functional (test 28)', async () => {
    await openAccessControl();

    // Brick 4 moved the mode radios into the focused dialog. The semantics and
    // the dirty behaviour they feed are unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Inventory Departments' }));
    expect(screen.getByRole('radio', { name: 'All Departments' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Selected Departments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(tab('Access Control').textContent).toContain('has unsaved changes');
  });

  it('keeps unsaved-close protection (test 29)', async () => {
    const onClose = vi.fn();
    await openAccessControl({ onClose });
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));

    fireEvent.click(screen.getByRole('button', { name: 'Close user card' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('reports a partial save honestly (test 30)', async () => {
    api = makeApi({ failures: { '/permission-overrides': 'nope' } });
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));
    fireEvent.click(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Deny'));
    fireEvent.click(tab('General'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(status('access')).toContain('Failed'));

    expect(status('general')).toContain('Saved');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('failed: Access Control'), expect.anything(),
    );
  });

  it('keeps Copy Setup, Audit History and the read-only vis.* block (tests 31, 33, 34)', async () => {
    const onCopySetup = vi.fn();
    const onViewAudit = vi.fn();
    await openAccessControl({ onCopySetup, onViewAudit });

    fireEvent.click(screen.getByRole('button', { name: /Copy Setup/ }));
    expect(onCopySetup).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /View Audit/ }));
    expect(onViewAudit).toHaveBeenCalled();

    expect(screen.getAllByText('Stored setting — backend enforcement not implemented'))
      .toHaveLength(7);
  });

  it('keeps the password reset wired to the reset endpoint (test 35)', async () => {
    await openAccessControl();
    fireEvent.click(tab('Security'));

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/api/admin/users/1/reset-password', { password: 'newpass123' },
      );
    });
  });
});

/* ══════════════════════════════════════════════════════════════
   Accessibility
   ══════════════════════════════════════════════════════════════ */

describe('accessibility', () => {
  it('exposes accordions as buttons with aria-expanded and a wired panel', async () => {
    await openAccessControl();
    const button = groupBtn('Inventory');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(groupBtn('Inventory').getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(groupBtn('Inventory').getAttribute('aria-controls')))
      .toBeTruthy();
  });

  it('exposes the tri-state control as a radiogroup naming capability and action', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const control = overrideControl('Stock Transfer', 'APPROVE');
    expect(within(control).getAllByRole('radio').map(r => r.textContent.replace(/[●○]/g, '')))
      .toEqual(['Inherit', 'Allow', 'Deny']);
    expect(stateButton(control, 'Inherit').tabIndex).toBe(0);
    expect(stateButton(control, 'Allow').tabIndex).toBe(-1);
  });

  it('moves between override states with the arrow keys', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    fireEvent.keyDown(overrideControl('Stock Transfer', 'APPROVE'), { key: 'ArrowRight' });
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Allow')
      .getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(overrideControl('Stock Transfer', 'APPROVE'), { key: 'ArrowLeft' });
    expect(stateButton(overrideControl('Stock Transfer', 'APPROVE'), 'Inherit')
      .getAttribute('aria-checked')).toBe('true');
  });

  it('exposes filter pressed state and an accessible search label', async () => {
    await openAccessControl();
    expect(filterBtn('Show Denied Only').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(filterBtn('Show Denied Only'));
    expect(filterBtn('Show Denied Only').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText(/^Search permissions/)).toBeTruthy();
  });

  it('states every verdict as text, never colour alone', async () => {
    await openAccessControl();
    fireEvent.click(groupBtn('Inventory'));

    const card = screen.getByLabelText('Stock Transfer');
    expect(within(card).getAllByText(/^(Allowed|Denied)$/).length).toBeGreaterThan(0);
    expect(within(card).getAllByText('Not granted')).toHaveLength(2);
  });
});
