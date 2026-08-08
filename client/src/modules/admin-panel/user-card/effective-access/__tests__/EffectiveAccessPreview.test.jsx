import { describe, it, expect, vi, beforeEach } from 'vitest';
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
   Synthetic fixtures — no production identity appears here
   ══════════════════════════════════════════════════════════════ */

const USER = {
  id: 1,
  username: 'preview_user',
  full_name: 'Preview Fixture',
  email: 'preview@example.test',
  role: 'operator',
  is_active: true,
  department_id: 3,
  created_at: '2026-01-15T00:00:00.000Z',
};

const ENFORCED_ALL = {
  navigation: 'ENFORCED', frontend_route: 'ENFORCED', frontend_action: 'ENFORCED',
  api_list: 'ENFORCED', api_detail: 'ENFORCED', api_create: 'ENFORCED',
  api_edit: 'ENFORCED', api_delete: 'ENFORCED', api_approve: 'ENFORCED',
  export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

const AUTH_ONLY_ALL = {
  navigation: 'NOT_ENFORCED', frontend_route: 'NOT_ENFORCED', frontend_action: 'NOT_ENFORCED',
  api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY', api_create: 'AUTHENTICATE_ONLY',
  api_edit: 'AUTHENTICATE_ONLY', api_delete: 'AUTHENTICATE_ONLY',
  api_approve: 'AUTHENTICATE_ONLY', export: 'NO_ACTIVE_FEATURE', print: 'NO_ACTIVE_FEATURE',
};

function entry(overrides) {
  const module = overrides.backend_module || 'inventory';
  const submodule = overrides.backend_submodule ?? 'stock_transfer';
  return {
    code: `${module}.${submodule === '' ? '__module__' : submodule}`,
    backend_module: module,
    backend_submodule: submodule,
    business_group: 'Inventory',
    label: 'Fixture',
    description: '',
    status: 'ACTIVE',
    risk_level: 'MEDIUM',
    control_type: 'ACTION_MATRIX',
    supported_actions: ['view'],
    has_baseline_rows: true,
    canonical_code: null,
    empty_submodule_meaning: submodule === '' ? 'MODULE_ACCESS' : null,
    enforcement: ENFORCED_ALL,
    notes: [],
    ...overrides,
  };
}

const CATALOG = {
  groups: [{ name: 'Inventory' }, { name: 'Manufacturing' }],
  totals: { total: 6, by_status: { ACTIVE: 5, LEGACY_ORPHAN: 1 } },
  enforcement_summary: { active_permission_count: 5, api_unguarded_active: [] },
  permissions: [
    // Role baseline allows view; approve is denied by an explicit user override.
    entry({
      backend_submodule: 'stock_transfer',
      label: 'Stock Transfer',
      supported_actions: ['view', 'approve'],
      risk_level: 'HIGH',
    }),
    // Explicit user ALLOW with no role grant, on an unenforced capability.
    entry({
      backend_submodule: 'lot_movements',
      label: 'Lot Movements',
      supported_actions: ['view'],
      enforcement: AUTH_ONLY_ALL,
      risk_level: 'CRITICAL',
    }),
    // No seeded baseline row at all → default deny.
    entry({
      backend_submodule: 'seed_stock',
      label: 'Seed Stock',
      supported_actions: ['view'],
      has_baseline_rows: false,
    }),
    // Module-access row → NOT_REPORTED.
    entry({ backend_submodule: '', label: 'Inventory Module Access' }),
    // Financial fields, for the Data Visibility section.
    entry({ backend_submodule: 'inventory_financial', label: 'Financial Fields' }),
    // Excluded from the default view.
    entry({
      backend_submodule: 'orphan_key',
      label: 'Orphan Key',
      status: 'LEGACY_ORPHAN',
      business_group: 'Manufacturing',
    }),
  ],
  view_restrictions: [
    { code: 'scope.inventory_department', label: 'Inventory Departments', status: 'ENFORCED' },
    { code: 'inventory.inventory_financial', label: 'Financial Fields' },
    { code: 'vis.show_cogs', label: 'Cost of Goods Sold' },
  ],
};

/* view granted on stock_transfer only; the other rows exist but grant nothing. */
const ROLE_TREE = [{
  module: 'inventory',
  label: 'Inventory',
  submodules: [
    { key: 'stock_transfer', label: 'Stock Transfer', permissions: 1 },
    { key: 'lot_movements', label: 'Lot Movements', permissions: 0 },
    { key: 'seed_stock', label: 'Seed Stock', permissions: 0 },
    { key: 'inventory_financial', label: 'Financial Fields', permissions: 0 },
  ],
}];

const OVERRIDE_ROWS = [
  { module: 'inventory', submodule: 'stock_transfer', allow_mask: 0, deny_mask: 16 },
  { module: 'inventory', submodule: 'lot_movements', allow_mask: 1, deny_mask: 0 },
];

const SCOPE = { scope_mode: 'SELECTED', departments: [{ department_id: 3 }, { department_id: 7 }] };

function makeApi({
  catalogFails = false, rolesFail = false, overridesFail = false, scopeFails = false,
} = {}) {
  const write = vi.fn(() => Promise.resolve({ success: true }));

  return {
    get: vi.fn((url) => {
      if (url.includes('/preferences')) {
        return Promise.resolve([{ pref_key: 'vis.show_cogs', pref_value: 'true' }]);
      }
      if (url.includes('/api/departments')) {
        return Promise.resolve([
          { id: 3, name: 'Growing' }, { id: 7, name: 'Polish 2' }, { id: 9, name: 'Sorting' },
        ]);
      }
      if (url.includes('/permissions')) {
        return rolesFail
          ? Promise.reject(new Error('roles down'))
          : Promise.resolve({ data: ROLE_TREE });
      }
      if (url === '/api/roles') {
        return Promise.resolve({ data: [{ id: 2, slug: 'operator', name: 'Operator' }] });
      }
      if (url.includes('/inventory-scope')) {
        return scopeFails ? Promise.reject(new Error('scope down')) : Promise.resolve(SCOPE);
      }
      if (url.includes('/permission-overrides')) {
        return overridesFail
          ? Promise.reject(new Error('overrides down'))
          : Promise.resolve({ data: OVERRIDE_ROWS });
      }
      if (url.includes('/permission-catalog')) {
        return catalogFails ? Promise.reject(new Error('catalog down')) : Promise.resolve(CATALOG);
      }
      return Promise.resolve(null);
    }),
    put: write,
    post: write,
    patch: write,
    del: vi.fn(() => Promise.resolve({ success: true })),
  };
}

/** Renders the drawer, waits for load, and opens the Access Control tab. */
async function openPreview(props = {}) {
  const utils = render(<UserDrawer user={USER} onClose={vi.fn()} {...props} />);
  await screen.findByLabelText('Username *');
  fireEvent.click(screen.getByRole('tab', { name: /^Access Control/ }));
  await screen.findByRole('heading', { name: 'Effective Access Preview' });
  return utils;
}

/** Every write verb the fake api exposes, as one count. */
function writeCount() {
  return api.put.mock.calls.length
    + api.post.mock.calls.length
    + api.patch.mock.calls.length
    + api.del.mock.calls.length;
}

const preview = () => screen.getByRole('heading', { name: 'Effective Access Preview' })
  .closest('.uc-section');

/* Brick 5's group buttons are named "Effective access for <group>" so they stay
   distinguishable from the Brick 3 accordion for the same business group. */
const groupToggle = name => screen.getByRole('button', { name: `Effective access for ${name}` });

const visibleRows = () => preview().querySelectorAll('.ea-row');

/* The User Card shell is itself role="dialog", so a bare getByRole('dialog')
   is ambiguous. Brick 5's explanation panel is addressed by its own class. */
const detailsDialog = () => document.querySelector('.ea-dialog');
const awaitDetails = () => waitFor(() => expect(detailsDialog()).toBeTruthy());

/* The effect verdict and the baseline label can both read "Allowed", so the
   verdict is asserted through the badge that carries it. */
const verdictOf = row => row.querySelector('.ea-badge-allowed, .ea-badge-denied, .ea-badge-unknown')
  .textContent;

beforeEach(() => {
  api = makeApi();
  currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };
  toast.success.mockClear();
  toast.error.mockClear();
});

/* ══════════════════════════════════════════════════════════════
   Rendering — tests 1 to 9
   ══════════════════════════════════════════════════════════════ */

describe('effective access preview', () => {
  it('renders inside the Access Control tab (test 1)', async () => {
    await openPreview();
    expect(within(preview()).getByRole('heading', { name: 'Effective Access' })).toBeTruthy();
  });

  it('renders the read-only summary with both dimensions (test 2)', async () => {
    await openPreview();
    const tiles = [...preview().querySelectorAll('.ea-tile-label')].map(el => el.textContent);
    expect(tiles).toEqual(expect.arrayContaining(
      ['Allowed', 'Denied', 'Overrides', 'Default Deny', 'Data Scope'],
    ));
    expect(tiles).toEqual(expect.arrayContaining(
      ['Enforced', 'Partial', 'Unenforced', 'Authentication only', 'Role based'],
    ));

    const panel = within(preview());
    expect(panel.getByRole('heading', { name: 'Enforcement Coverage' })).toBeTruthy();
    expect(panel.getByText(/Effective permission and backend enforcement are separate/))
      .toBeTruthy();
  });

  it('follows the catalog group order (test 3)', async () => {
    await openPreview();
    const names = [...preview().querySelectorAll('.ea-group-name')].map(el => el.textContent);
    expect(names).toEqual(['Inventory']);
  });

  it('shows only the actions a capability declares (test 4)', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));

    const lotRow = within(preview()).getByText('Lot Movements').closest('.ea-row');
    expect(within(lotRow).getByText('VIEW')).toBeTruthy();
    expect(within(lotRow).queryByText('APPROVE')).toBeNull();
  });

  it('shows baseline, override, effective, source and enforcement (tests 5-9)', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));

    const approveRow = within(preview()).getByText('APPROVE').closest('.ea-row');
    const cells = within(approveRow);
    expect(cells.getByText('Baseline')).toBeTruthy();
    expect(cells.getByText('Override')).toBeTruthy();
    expect(cells.getByText('Deny')).toBeTruthy();
    expect(verdictOf(approveRow)).toBe('Denied');
    expect(cells.getByText('Explicit user deny')).toBeTruthy();
    expect(cells.getByText('Enforced')).toBeTruthy();
  });

  it('offers no override control anywhere in the preview', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));
    const panel = within(preview());
    expect(panel.queryByRole('radio')).toBeNull();
    expect(panel.queryByRole('checkbox')).toBeNull();
    expect(panel.queryByRole('button', { name: /Reset/ })).toBeNull();
  });

  it('states the explicit allow, the default deny and the not-reported baseline', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));
    const panel = within(preview());
    expect(panel.getByText('Explicit user allow')).toBeTruthy();
    expect(panel.getByText('Default deny — no baseline configured')).toBeTruthy();
    expect(panel.getByText('Role baseline exists but is not reported for this key')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Search and filters — tests 10 to 19
   ══════════════════════════════════════════════════════════════ */

describe('search and filters', () => {
  const chip = name => within(preview()).getByRole('button', { name });

  it('search narrows the visible rows (test 10)', async () => {
    await openPreview();
    fireEvent.change(screen.getByLabelText('Search effective access'), {
      target: { value: 'Seed Stock' },
    });
    await waitFor(() => expect(visibleRows().length).toBe(1));
    expect(within(preview()).getByText('Seed Stock')).toBeTruthy();
  });

  it('Allowed filter works (test 11)', async () => {
    await openPreview();
    fireEvent.click(chip('Allowed'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    for (const row of visibleRows()) expect(verdictOf(row)).toBe('Allowed');
  });

  it('Denied filter works (test 12)', async () => {
    await openPreview();
    fireEvent.click(chip('Denied'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    for (const row of visibleRows()) expect(verdictOf(row)).toBe('Denied');
  });

  it('Overrides filter works (test 13)', async () => {
    await openPreview();
    fireEvent.click(chip('Overrides'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBe(2));
  });

  it('Default deny filter works (test 14)', async () => {
    await openPreview();
    fireEvent.click(chip('Default deny'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBe(1));
    expect(within(preview()).getByText('Seed Stock')).toBeTruthy();
  });

  it('Unenforced filter works (test 15)', async () => {
    await openPreview();
    fireEvent.click(chip('Unenforced'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBe(1));
    expect(within(preview()).getByText('Lot Movements')).toBeTruthy();
  });

  it('risk filter works (test 16)', async () => {
    await openPreview();
    fireEvent.click(chip('Critical'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBe(1));
    expect(within(preview()).getByText('Lot Movements')).toBeTruthy();
  });

  it('combined filters intersect rather than union (test 17)', async () => {
    await openPreview();
    fireEvent.click(chip('Denied'));
    fireEvent.click(chip('Overrides'));
    fireEvent.click(groupToggle('Inventory'));
    await waitFor(() => expect(visibleRows().length).toBe(1));
    expect(within(visibleRows()[0]).getByText('APPROVE')).toBeTruthy();
  });

  it('Clear Filters restores everything (test 18)', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));
    const before = visibleRows().length;

    fireEvent.click(chip('Denied'));
    await waitFor(() => expect(visibleRows().length).toBeLessThan(before));

    fireEvent.click(within(preview()).getByRole('button', { name: /Clear Filters/ }));
    await waitFor(() => expect(visibleRows().length).toBe(before));
  });

  it('marks filter chips with aria-pressed', async () => {
    await openPreview();
    expect(chip('Denied').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip('Denied'));
    await waitFor(() => expect(chip('Denied').getAttribute('aria-pressed')).toBe('true'));
  });

  it('shows a recoverable empty state when nothing matches', async () => {
    await openPreview();
    fireEvent.change(screen.getByLabelText('Search effective access'), {
      target: { value: 'zzz-no-such-capability' },
    });
    await screen.findByText('No action result matches the current search and filters.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await waitFor(() => expect(preview().querySelector('.ea-noresults')).toBeNull());
  });

  it('hides legacy entries by default and reveals them read-only on request', async () => {
    await openPreview();
    expect(within(preview()).queryByText('Orphan Key')).toBeNull();

    fireEvent.click(chip('Show diagnostics'));
    await waitFor(() => expect(groupToggle('Manufacturing')).toBeTruthy());
    fireEvent.click(groupToggle('Manufacturing'));

    const diagnostic = await waitFor(
      () => within(preview()).getByText('Orphan Key').closest('.ea-diagnostic-row'),
    );
    expect(within(diagnostic).queryByRole('button')).toBeNull();
  });

  it('searching and filtering never makes the card dirty (test 19)', async () => {
    await openPreview();
    fireEvent.change(screen.getByLabelText('Search effective access'), {
      target: { value: 'stock' },
    });
    fireEvent.click(chip('Denied'));
    fireEvent.click(groupToggle('Inventory'));

    await waitFor(() => expect(screen.getByTestId('uc-status-access').textContent)
      .toContain('Not Changed'));
  });
});

/* ══════════════════════════════════════════════════════════════
   The no-write proof — tests 20, 21
   ══════════════════════════════════════════════════════════════ */

describe('read-only guarantee', () => {
  it('a full exercise of Brick 5 issues zero writes (tests 20, 21)', async () => {
    await openPreview();
    expect(writeCount()).toBe(0);

    const chip = name => within(preview()).getByRole('button', { name });

    // Search, then clear it.
    fireEvent.change(screen.getByLabelText('Search effective access'), {
      target: { value: 'stock' },
    });
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByLabelText('Clear search'));

    // Every filter on, then all off.
    const names = ['Allowed', 'Denied', 'Overrides', 'Default deny', 'Unenforced',
      'Missing baseline', 'Not reported', 'Show diagnostics',
      'Critical', 'High', 'Medium', 'Low'];
    for (const name of names) fireEvent.click(chip(name));
    fireEvent.click(within(preview()).getByRole('button', { name: /Clear Filters/ }));

    // Expand, collapse, expand.
    fireEvent.click(within(preview()).getByRole('button', { name: /Expand all/ }));
    fireEvent.click(within(preview()).getByRole('button', { name: /Collapse all/ }));
    fireEvent.click(within(preview()).getByRole('button', { name: /Expand all/ }));
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    // Open the details dialog, read it, close it.
    fireEvent.click(within(preview()).getAllByRole('button', { name: /^Explain / })[0]);
    await awaitDetails();
    expect(within(detailsDialog()).getByText('Diagnostic detail')).toBeTruthy();
    fireEvent.click(within(detailsDialog()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(detailsDialog()).toBeNull());

    // Deep-link into Brick 3 without editing anything there.
    fireEvent.click(within(preview()).getAllByRole('button', { name: /^Edit permission for / })[0]);
    await waitFor(() => expect(screen.getByTestId('uc-status-access').textContent)
      .toContain('Not Changed'));

    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.del).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
  });

  it('issues no extra request per group, row or action', async () => {
    await openPreview();
    const readsAfterLoad = api.get.mock.calls.length;

    fireEvent.click(groupToggle('Inventory'));
    fireEvent.click(within(preview()).getAllByRole('button', { name: /^Explain / })[0]);
    await awaitDetails();

    expect(api.get.mock.calls.length).toBe(readsAfterLoad);
  });

  it('the details dialog is read-only and returns focus on close', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));

    const explain = within(preview()).getAllByRole('button', { name: /^Explain / })[0];
    explain.focus();
    fireEvent.click(explain);

    await awaitDetails();
    const dialog = detailsDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('textbox')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(detailsDialog()).toBeNull());
    expect(document.activeElement).toBe(explain);
    expect(writeCount()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   Data visibility — tests 22 to 26
   ══════════════════════════════════════════════════════════════ */

describe('data visibility summary', () => {
  const section = () => preview().querySelector('.ea-visibility');

  it('names the selected departments (test 22)', async () => {
    await openPreview();
    expect(within(section()).getByText('Growing, Polish 2')).toBeTruthy();
  });

  it('derives Financial Fields from the real permission (test 23)', async () => {
    await openPreview();
    expect(within(section()).getByText('Financial Fields')).toBeTruthy();
    expect(within(section()).getByText('Hidden')).toBeTruthy();
  });

  it('labels stored vis.* settings as not enforced (test 24)', async () => {
    await openPreview();
    const panel = within(section());
    expect(panel.getByText(/Stored but Not Enforced/)).toBeTruthy();
    expect(panel.getByText(/no verified backend data restriction/)).toBeTruthy();
    expect(panel.getByText('vis.show_cogs')).toBeTruthy();
  });

  it('states Operational Authority as not modelled (test 25)', async () => {
    await openPreview();
    const panel = within(section());
    expect(panel.getByText('Operational Authority')).toBeTruthy();
    expect(panel.getByText(/No dedicated operational-authority storage or resolver/)).toBeTruthy();
  });

  it('states Approval Authority as not modelled (test 26)', async () => {
    await openPreview();
    const panel = within(section());
    expect(panel.getByText('Approval Authority')).toBeTruthy();
    expect(panel.getByText(/department-level approval-authority model has not been verified/))
      .toBeTruthy();
  });

  it('offers no edit control in the visibility section', async () => {
    await openPreview();
    expect(within(section()).queryByRole('button')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Super Admin — test 27
   ══════════════════════════════════════════════════════════════ */

describe('Super Admin', () => {
  it('states the bypass and never attributes access to a role (test 27)', async () => {
    await openPreview({ user: { ...USER, role: 'super_admin' } });

    expect(within(preview())
      .getByText(/Every result below is granted by the Super Admin bypass/)).toBeTruthy();

    fireEvent.click(groupToggle('Inventory'));
    const sources = preview().querySelectorAll('.ea-cell-source');
    expect(sources.length).toBeGreaterThan(0);
    for (const cell of sources) expect(cell.textContent).toContain('Super Admin bypass');
  });

  it('resolves every action Allowed for Super Admin even against a stored deny', async () => {
    await openPreview({ user: { ...USER, role: 'super_admin' } });
    fireEvent.click(groupToggle('Inventory'));
    const rows = visibleRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(verdictOf(row)).toBe('Allowed');
  });
});

/* ══════════════════════════════════════════════════════════════
   Failure states — tests 30 to 33
   ══════════════════════════════════════════════════════════════ */

describe('failure states', () => {
  async function openWith(options) {
    api = makeApi(options);
    render(<UserDrawer user={USER} onClose={vi.fn()} />);
    await screen.findByLabelText('Username *');
    fireEvent.click(screen.getByRole('tab', { name: /^Access Control/ }));
    await screen.findByRole('heading', { name: 'Effective Access Preview' });
  }

  it('a catalog failure produces a safe unavailable state (test 30)', async () => {
    await openWith({ catalogFails: true });

    expect(screen.getByText(/Effective access preview unavailable because permission catalog/))
      .toBeTruthy();

    // The rest of the tab keeps working.
    expect(screen.getByRole('heading', { name: 'Permission Overrides' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'View Restrictions' })).toBeTruthy();
    expect(writeCount()).toBe(0);
  });

  it('a role-data failure does not show a false Default Deny (test 31)', async () => {
    await openWith({ rolesFail: true });

    expect(within(preview()).getByText(/Role baseline unavailable/)).toBeTruthy();

    fireEvent.click(groupToggle('Inventory'));

    /* Stock Transfer's grant lives in the role API that just failed, so it must
       read Unverified rather than being reported as denied. */
    // Stock Transfer declares two actions, so it owns two rows; either will do.
    const transferRow = within(preview()).getAllByText('Stock Transfer')[0].closest('.ea-row');
    expect(verdictOf(transferRow)).toBe('Unknown');
    expect(within(transferRow).queryByText('Not granted')).toBeNull();

    /* Seed Stock is different, and deliberately so: Brick 1 statically verified
       that no role_permissions row exists for it, and no outage changes that. */
    const seedRow = within(preview()).getByText('Seed Stock').closest('.ea-row');
    expect(within(seedRow).getByText('Default deny — no baseline configured')).toBeTruthy();
  });

  it('an override-data failure does not show a false Inherit (test 32)', async () => {
    await openWith({ overridesFail: true });

    expect(within(preview()).getAllByText(/User overrides unavailable/).length)
      .toBeGreaterThan(0);

    fireEvent.click(groupToggle('Inventory'));
    const rows = visibleRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(within(row).getByText('Unavailable')).toBeTruthy();
      expect(within(row).queryByText('Inherit')).toBeNull();
    }
  });

  it('a scope failure never displays All Departments (test 33)', async () => {
    await openWith({ scopeFails: true });

    const section = preview().querySelector('.ea-visibility');
    expect(within(section).getByText('Unavailable')).toBeTruthy();
    expect(within(section).queryByText('All inventory departments')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   Deep link and coexistence — tests 34 to 43
   ══════════════════════════════════════════════════════════════ */

describe('coexistence with Bricks 2, 3 and 4', () => {
  const editor = () => screen.getByRole('heading', { name: 'Permission Overrides' })
    .closest('.uc-section');

  it('Edit Permission deep-links into the Brick 3 editor (test 34)', async () => {
    await openPreview();
    fireEvent.click(groupToggle('Inventory'));
    fireEvent.click(within(preview()).getAllByRole('button', { name: /^Edit permission for / })[0]);

    await waitFor(() => {
      const search = within(editor()).getByRole('searchbox');
      expect(search.value).toContain('inventory.');
    });
    expect(writeCount()).toBe(0);
  });

  it('the Brick 3 permission editor remains usable (test 35)', async () => {
    await openPreview();
    expect(within(editor()).getByRole('searchbox')).toBeTruthy();
    expect(within(editor()).getAllByRole('button', { name: /Reset/ }).length).toBeGreaterThan(0);
  });

  it('the Brick 4 View Restrictions panel remains usable (test 36)', async () => {
    await openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Inventory Departments' }));
    await screen.findByRole('button', { name: 'Apply' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull());
    expect(writeCount()).toBe(0);
  });

  it('Brick 2 dirty protection still fires for a real edit (test 37)', async () => {
    await openPreview();
    fireEvent.click(screen.getByRole('tab', { name: /^General/ }));
    fireEvent.change(screen.getByLabelText('Full Name *'), { target: { value: 'Changed Name' } });

    // The card is clean until an edit, and the footer says so: Close becomes Cancel.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('the General, Preferences and Security tabs are unchanged (tests 38-40)', async () => {
    await openPreview();

    fireEvent.click(screen.getByRole('tab', { name: /^General/ }));
    expect(screen.getByLabelText('Username *')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /^Preferences/ }));
    expect(screen.getByTestId('uc-status-preferences')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /^Security/ }));
    expect(screen.getByTestId('uc-status-security')).toBeTruthy();

    expect(writeCount()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   Role freeze — rendering explains, it never changes
   ══════════════════════════════════════════════════════════════ */

describe('role freeze', () => {
  const ROLES = ['super_admin', 'admin', 'operator', 'viewer', 'operator_restricted'];

  /** The exact payloads the fixtures hand out, deep-compared around a render. */
  const snapshot = () => JSON.stringify({
    catalog: CATALOG, roleTree: ROLE_TREE, overrides: OVERRIDE_ROWS, scope: SCOPE,
  });

  it.each(ROLES)('renders %s without altering any stored payload', async (role) => {
    api = makeApi();
    const before = snapshot();

    render(<UserDrawer user={{ ...USER, role }} onClose={vi.fn()} />);
    await screen.findByLabelText('Username *');
    fireEvent.click(screen.getByRole('tab', { name: /^Access Control/ }));
    await screen.findByRole('heading', { name: 'Effective Access Preview' });

    fireEvent.click(within(preview()).getByRole('button', { name: /Expand all/ }));
    await waitFor(() => expect(visibleRows().length).toBeGreaterThan(0));

    expect(snapshot()).toBe(before);

    // No role mask, assignment, override, scope or preference was written.
    expect(writeCount()).toBe(0);
    expect(screen.getByTestId('uc-status-access').textContent).toContain('Not Changed');
    expect(screen.getByTestId('uc-status-general').textContent).toContain('Not Changed');
    expect(screen.getByTestId('uc-status-preferences').textContent).toContain('Not Changed');
  });
});
