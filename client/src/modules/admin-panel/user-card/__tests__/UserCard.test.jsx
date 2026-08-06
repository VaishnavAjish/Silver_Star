import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/* ── Boundary mocks: no network, no auth context, no toasts ──── */
let api;
const refreshUser = vi.fn();
let currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };

vi.mock('../../../../shared/hooks/useApi', () => ({
  useApi: () => api,
  default: () => api,
}));

vi.mock('../../../../core/context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, refreshUser }),
  ROLE_DEFAULTS: {},
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('react-hot-toast', () => ({ default: toast, toast }));

// Imported after the mocks so the component picks them up.
const { default: UserDrawer } = await import('../../pages/UserDrawer');

/* ── Synthetic fixtures ─────────────────────────────────────── */
const USER = {
  id: 1,
  username: 'rohit',
  full_name: 'Rohit Sharma',
  email: 'rohit@example.com',
  role: 'operator',
  is_active: true,
  department_id: 3,
  department_name: 'Surat HO',
  created_at: '2026-01-15T00:00:00.000Z',
};

const OTHER_USER = { ...USER, id: 2, username: 'laser', full_name: 'Laser Operator' };

const CATALOG = {
  totals: { total: 96, by_status: { ACTIVE: 60, LEGACY_ORPHAN: 9 } },
  groups: [{ name: 'Inventory' }, { name: 'Manufacturing' }],
  enforcement_summary: { active_permission_count: 60, api_unguarded_active: ['inventory.seed_stock'] },
};

const ROLE_TREE = [
  {
    module: 'inventory',
    label: 'Inventory',
    submodules: [{ key: 'all_inventory', label: 'All Inventory', permissions: 1 }],
  },
];

/**
 * Fake api. `failures` maps a URL fragment to the error thrown for writes to it,
 * letting a single category fail while the others succeed.
 */
function makeApi({ catalogFails = false, failures = {}, deferWrites = false } = {}) {
  const pending = [];
  const fail = (url) => Object.keys(failures).find(k => url.includes(k));

  const write = vi.fn((url) => {
    const key = fail(url);
    if (key) return Promise.reject(new Error(failures[key]));
    if (deferWrites) {
      return new Promise(resolve => pending.push(() => resolve({ success: true })));
    }
    return Promise.resolve({ success: true });
  });

  return {
    get: vi.fn((url) => {
      if (url.includes('/preferences')) return Promise.resolve([{ pref_key: 'theme', pref_value: 'light' }]);
      if (url.includes('/api/departments')) return Promise.resolve([{ id: 3, name: 'Surat HO' }, { id: 4, name: 'Mumbai' }]);
      if (url.includes('/permissions')) return Promise.resolve({ data: ROLE_TREE });
      if (url === '/api/roles') return Promise.resolve({ data: [{ id: 2, slug: 'operator', name: 'Operator' }] });
      if (url.includes('/inventory-scope')) return Promise.resolve({ scope_mode: 'SELECTED', departments: [{ department_id: 3 }] });
      if (url.includes('/permission-overrides')) {
        return Promise.resolve({ data: [{ module: 'inventory', submodule: 'all_inventory', allow_mask: 1, deny_mask: 0 }] });
      }
      if (url.includes('/permission-catalog')) {
        return catalogFails ? Promise.reject(new Error('boom')) : Promise.resolve(CATALOG);
      }
      return Promise.resolve(null);
    }),
    put: write,
    post: write,
    del: vi.fn(() => Promise.resolve({ success: true })),
    flushPending: () => { pending.splice(0).forEach(fn => fn()); },
  };
}

/** Renders the card and waits for the initial load to settle. */
async function renderCard(props = {}) {
  const onClose = props.onClose || vi.fn();
  const utils = render(<UserDrawer user={USER} onClose={onClose} {...props} />);
  await screen.findByLabelText('Username *');
  return { ...utils, onClose };
}

const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const status = (category) => screen.getByTestId(`uc-status-${category}`).textContent;

beforeEach(() => {
  api = makeApi();
  currentUser = { id: 99, role: 'super_admin', full_name: 'Admin' };
  toast.success.mockClear();
  toast.error.mockClear();
  refreshUser.mockClear();
});

afterEach(() => {
  document.body.style.overflow = '';
});

/* ══════════════════════════════════════════════════════════════
   Structure — tests 1 to 6
   ══════════════════════════════════════════════════════════════ */
describe('User Card shell', () => {
  it('renders exactly the four tabs (test 1)', async () => {
    await renderCard();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent.trim())).toEqual([
      'General', 'Access Control', 'Preferences', 'Security',
    ]);
  });

  it('shows the identity header and summary cards', async () => {
    await renderCard();
    expect(screen.getByText('Rohit Sharma')).toBeTruthy();
    expect(screen.getByText('@rohit')).toBeTruthy();
    expect(screen.getByText('rohit@example.com')).toBeTruthy();
    expect(screen.getByText('Inventory Departments')).toBeTruthy();
    expect(screen.getByText('Last Updated')).toBeTruthy();
  });

  it('keeps the General fields editable (test 2)', async () => {
    await renderCard();
    const fullName = screen.getByLabelText('Full Name *');
    fireEvent.change(fullName, { target: { value: 'Rohit K Sharma' } });
    expect(fullName.value).toBe('Rohit K Sharma');
    expect(tab('General').textContent).toContain('has unsaved changes');
  });

  it('keeps the existing permission editor functional (test 3)', async () => {
    await renderCard();
    fireEvent.click(tab('Access Control'));

    const cell = screen.getByLabelText(/^Dashboard Dashboard VIEW: INHERIT/);
    expect(cell.textContent).toBe('—');

    fireEvent.click(cell);
    const allowed = await screen.findByLabelText(/^Dashboard Dashboard VIEW: ALLOW/);
    expect(allowed.textContent).toBe('✓ ALLOW');

    // Second click cycles to DENY — unchanged three-state semantics.
    fireEvent.click(allowed);
    expect((await screen.findByLabelText(/^Dashboard Dashboard VIEW: DENY/)).textContent).toBe('✕ DENY');
  });

  it('keeps the inventory scope editor functional (test 4)', async () => {
    await renderCard();
    fireEvent.click(tab('Access Control'));

    expect(screen.getByRole('radio', { name: 'Selected Departments' }).checked).toBe(true);
    expect(screen.getByLabelText('Surat HO').checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'All Departments' }));
    expect(screen.getByRole('radio', { name: 'All Departments' }).checked).toBe(true);
    expect(tab('Access Control').textContent).toContain('has unsaved changes');
  });

  it('keeps preferences functional (test 5)', async () => {
    await renderCard();
    fireEvent.click(tab('Preferences'));

    const compact = screen.getByRole('switch', { name: 'Compact Mode' });
    expect(compact.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(compact);
    expect(screen.getByRole('switch', { name: 'Compact Mode' }).getAttribute('aria-checked')).toBe('true');
    expect(tab('Preferences').textContent).toContain('has unsaved changes');
  });

  it('keeps the security password action functional (test 6)', async () => {
    await renderCard();
    fireEvent.click(tab('Security'));

    expect(screen.getByRole('button', { name: 'Update Password' }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'newpass123' } });
    expect(screen.getByRole('button', { name: 'Update Password' }).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Update Password/ }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/admin/users/1/reset-password', { password: 'newpass123' });
    });
  });

  it('shows the unenforced vis.* settings read-only, never as editable controls', async () => {
    await renderCard();
    fireEvent.click(tab('Access Control'));

    expect(screen.getAllByText('Stored setting — backend enforcement not implemented')).toHaveLength(7);
    expect(screen.queryByRole('switch', { name: 'Margin %' })).toBeNull();
  });

  it('falls back to the preserved matrix and says why', async () => {
    await renderCard();
    fireEvent.click(tab('Access Control'));
    expect(screen.getByText('Permission Overrides')).toBeTruthy();
    // This suite's CATALOG stub carries no `permissions` array, so Brick 3's
    // grouped editor cannot map it and the Brick 2 matrix is shown instead —
    // which is the fallback path the rest of these tests exercise.
    expect(screen.getByText(/Grouped permission catalog unavailable/)).toBeTruthy();
    expect(screen.getByText(/contains no permission entries/)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Dirty tracking and close protection — tests 7 to 13
   ══════════════════════════════════════════════════════════════ */
describe('unsaved-change protection', () => {
  it('marks the dirty category only, not every tab (test 7)', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });

    expect(tab('General').textContent).toContain('has unsaved changes');
    expect(tab('Preferences').textContent).not.toContain('has unsaved changes');
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });

  it('clears the dirty indicator when the field is reverted (test 8)', async () => {
    await renderCard();
    const email = screen.getByLabelText('Email');

    fireEvent.change(email, { target: { value: 'new@example.com' } });
    expect(tab('General').textContent).toContain('has unsaved changes');

    fireEvent.change(email, { target: { value: 'rohit@example.com' } });
    expect(tab('General').textContent).not.toContain('has unsaved changes');
  });

  it('closes immediately while clean (test 9)', async () => {
    const { onClose } = await renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Close user card' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('warns instead of closing while dirty (test 10)', async () => {
    const { onClose } = await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close user card' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue Editing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
  });

  it('warns when the overlay is clicked while dirty', async () => {
    const { onClose, container } = await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(container.querySelector('.uc-overlay'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('warns on Escape while dirty, and closes on Escape while clean (test 11)', async () => {
    const { onClose } = await renderCard();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('warns when another user is selected while dirty, and keeps the current user (test 12)', async () => {
    const onRequestedUserReverted = vi.fn();
    const { rerender } = await renderCard({ onRequestedUserReverted });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    rerender(<UserDrawer user={OTHER_USER} onClose={vi.fn()} onRequestedUserReverted={onRequestedUserReverted} />);

    expect(screen.getByText(/unsaved changes for Rohit Sharma/)).toBeTruthy();
    expect(screen.getByLabelText('Username *').value).toBe('rohit');

    fireEvent.click(screen.getByRole('button', { name: 'Continue Editing' }));
    expect(onRequestedUserReverted).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.getByLabelText('Username *').value).toBe('rohit');
  });

  it('switches user after Discard Changes', async () => {
    const { rerender } = await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    rerender(<UserDrawer user={OTHER_USER} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(screen.getByLabelText('Username *').value).toBe('laser'));
  });

  it('registers beforeunload only while dirty (test 13)', async () => {
    await renderCard();

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    const dirtyEvt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvt);
    expect(dirtyEvt.defaultPrevented).toBe(true);

    // Reverting removes the handler again.
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'rohit@example.com' } });
    const revertedEvt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(revertedEvt);
    expect(revertedEvt.defaultPrevented).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════
   Category save reporting — tests 14 to 18
   ══════════════════════════════════════════════════════════════ */
describe('per-category save reporting', () => {
  it('starts with every category reported as Not Changed', async () => {
    await renderCard();
    expect(status('general')).toContain('Not Changed');
    expect(status('access')).toContain('Not Changed');
    expect(status('preferences')).toContain('Not Changed');
    expect(status('security')).toContain('Not Changed');
  });

  it('disables both save buttons while nothing is dirty', async () => {
    await renderCard();
    expect(screen.getByRole('button', { name: /Save All Changes/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save Current Tab' }).disabled).toBe(true);
  });

  it('reports category-specific status after Save All (test 14)', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(tab('Preferences'));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact Mode' }));

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('general')).toContain('Saved'));
    expect(status('preferences')).toContain('Saved');
    // Untouched categories are never claimed as saved.
    expect(status('access')).toContain('Not Changed');
    expect(status('security')).toContain('Not Changed');

    expect(api.put).toHaveBeenCalledWith('/api/admin/users/1', expect.objectContaining({ email: 'new@example.com' }));
    expect(api.put).toHaveBeenCalledWith('/api/admin/users/1/preferences', expect.anything());
    // Clean categories are not written at all.
    expect(api.put).not.toHaveBeenCalledWith('/api/admin/users/1/inventory-scope', expect.anything());
  });

  it('saves only the active tab with Save Current Tab', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(tab('Preferences'));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact Mode' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save Current Tab' }));

    await waitFor(() => expect(status('preferences')).toContain('Saved'));
    expect(status('general')).toContain('Not Changed');
    expect(tab('General').textContent).toContain('has unsaved changes');
  });

  it('does not display global success when one category fails (test 15)', async () => {
    api = makeApi({ failures: { '/preferences': 'Preferences endpoint exploded' } });
    await renderCard();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(tab('Preferences'));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact Mode' }));

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('preferences')).toContain('Failed'));
    expect(status('general')).toContain('Saved');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('failed: Preferences'),
      expect.anything(),
    );
  });

  it('retains the form state of a failed category and allows retry (test 16)', async () => {
    api = makeApi({ failures: { '/preferences': 'nope' } });
    await renderCard();

    fireEvent.click(tab('Preferences'));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact Mode' }));
    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('preferences')).toContain('Failed'));

    // The edit survives and the category is still dirty, so it can be retried.
    expect(screen.getByRole('switch', { name: 'Compact Mode' }).getAttribute('aria-checked')).toBe('true');
    expect(tab('Preferences').textContent).toContain('has unsaved changes');
    expect(screen.getByRole('button', { name: /Save All Changes/ }).disabled).toBe(false);
  });

  it('advances the baseline of a saved category so it becomes clean (test 17)', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    expect(tab('General').textContent).toContain('has unsaved changes');

    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(status('general')).toContain('Saved'));
    expect(tab('General').textContent).not.toContain('has unsaved changes');
    expect(screen.getByRole('button', { name: /Save All Changes/ }).disabled).toBe(true);
    // The saved value is retained, not reloaded away.
    expect(screen.getByLabelText('Email').value).toBe('new@example.com');
  });

  it('ignores a duplicate save click while a save is in flight (test 18)', async () => {
    api = makeApi({ deferWrites: true });
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });

    const saveAll = screen.getByRole('button', { name: /Save All Changes/ });
    fireEvent.click(saveAll);
    fireEvent.click(saveAll);
    fireEvent.click(saveAll);

    expect(api.put).toHaveBeenCalledTimes(1);

    // Two independent mechanisms hold: every save control is disabled while a
    // save is in flight, and the in-flight guard refuses a re-entrant call even
    // if a control were somehow activated.
    expect(screen.getByRole('button', { name: /Saving/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save Current Tab' }).disabled).toBe(true);

    await act(async () => { api.flushPending(); });
    await waitFor(() => expect(status('general')).toContain('Saved'));
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('reloads the parent list after a successful save', async () => {
    const onSaved = vi.fn();
    await renderCard({ onSaved });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Save All Changes/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

/* ══════════════════════════════════════════════════════════════
   Reset overrides, Super Admin, catalog — tests 19 and 20
   ══════════════════════════════════════════════════════════════ */
describe('reset overrides', () => {
  it('offers the action only when overrides exist, and confirms with the record count', async () => {
    await renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Reset Overrides \(1\)/ }));

    expect(screen.getByText('Reset permission overrides?')).toBeTruthy();
    expect(screen.getByText(/role baseline is not changed/)).toBeTruthy();
  });

  it('resets through the existing endpoint rather than clearing only the view', async () => {
    await renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Reset Overrides \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Overrides' }));

    await waitFor(() => {
      expect(api.del).toHaveBeenCalledWith('/api/admin/users/1/permission-overrides');
    });
    // The action disappears once no override records remain, and nothing is left dirty.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Reset Overrides \(/ })).toBeNull());
    expect(tab('Access Control').textContent).not.toContain('has unsaved changes');
  });

  it('hides the action for a user with no overrides', async () => {
    api = makeApi();
    api.get = vi.fn((url) => {
      if (url.includes('/permission-overrides')) return Promise.resolve({ data: [] });
      if (url.includes('/preferences')) return Promise.resolve([]);
      if (url.includes('/api/departments')) return Promise.resolve([]);
      if (url.includes('/permissions')) return Promise.resolve({ data: ROLE_TREE });
      if (url === '/api/roles') return Promise.resolve({ data: [{ id: 2, slug: 'operator' }] });
      if (url.includes('/inventory-scope')) return Promise.resolve({ scope_mode: 'ALL', departments: [] });
      if (url.includes('/permission-catalog')) return Promise.resolve(CATALOG);
      return Promise.resolve(null);
    });

    await renderCard();
    expect(screen.queryByRole('button', { name: /Reset Overrides/ })).toBeNull();
  });
});

describe('Super Admin handling', () => {
  it('states the bypass and does not let the matrix imply otherwise (test 19)', async () => {
    render(<UserDrawer user={{ ...USER, role: 'super_admin' }} onClose={vi.fn()} />);
    await screen.findByLabelText('Username *');

    expect(
      screen.getByText('Super Admin — effective access bypasses role and user override masks.'),
    ).toBeTruthy();

    fireEvent.click(tab('Access Control'));
    expect(screen.getByLabelText(/^Dashboard Dashboard VIEW/).disabled).toBe(true);
    expect(screen.getByText(/Full inventory access — system enforced for Super Admin/)).toBeTruthy();
  });

  it('does not show the bypass message for a non-super-admin', async () => {
    await renderCard();
    expect(
      screen.queryByText('Super Admin — effective access bypasses role and user override masks.'),
    ).toBeNull();
  });

  it('locks the role selector when editing your own account', async () => {
    currentUser = { id: 1, role: 'super_admin', full_name: 'Rohit Sharma' };
    await renderCard();
    expect(screen.getByText('Cannot change your own role')).toBeTruthy();
  });
});

describe('Brick 1 catalog integration', () => {
  it('surfaces the enforcement warning reported by the catalog', async () => {
    await renderCard();
    fireEvent.click(tab('Access Control'));
    expect(
      screen.getByText(/Some configured permissions are not yet enforced by backend APIs/),
    ).toBeTruthy();
    expect(screen.getByText(/60 active/)).toBeTruthy();
  });

  it('still opens and stays editable when the catalog endpoint fails (test 20)', async () => {
    api = makeApi({ catalogFails: true });
    await renderCard();

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    fireEvent.click(tab('Access Control'));

    expect(await screen.findByText('Permission catalog diagnostics unavailable.')).toBeTruthy();

    // The editor still works.
    fireEvent.click(screen.getByLabelText(/^Dashboard Dashboard VIEW: INHERIT/));
    expect(await screen.findByLabelText(/^Dashboard Dashboard VIEW: ALLOW/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Selected Departments' })).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════
   Accessibility
   ══════════════════════════════════════════════════════════════ */
describe('accessibility', () => {
  it('exposes tabs with correct roles, selection state and panel wiring', async () => {
    await renderCard();
    const general = tab('General');
    expect(general.getAttribute('aria-selected')).toBe('true');
    expect(general.getAttribute('aria-controls')).toBe('uc-panel-general');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('uc-tab-general');
    expect(tab('Security').getAttribute('aria-selected')).toBe('false');
  });

  it('moves between tabs with the arrow keys', async () => {
    await renderCard();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(tab('Access Control').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(tab('Security').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(tab('General').getAttribute('aria-selected')).toBe('true');
  });

  it('states each save status as text, not colour alone', async () => {
    await renderCard();
    expect(status('general')).toContain('General: Not Changed');
  });

  it('locks background scrolling while the card is open', async () => {
    await renderCard();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('marks the confirmation dialog as a modal dialog', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close user card' }));

    const confirm = screen.getAllByRole('dialog').find(d => d.className.includes('uc-dialog'));
    expect(confirm.getAttribute('aria-modal')).toBe('true');
    expect(confirm.getAttribute('aria-labelledby')).toBe('uc-unsaved-title');
  });
});
