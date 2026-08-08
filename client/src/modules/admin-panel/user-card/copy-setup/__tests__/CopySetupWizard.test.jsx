import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CopySetupWizard from '../CopySetupWizard';
import { CATALOG, OPERATOR_ROLE_TREE, payload, user } from './copySetupFixtures';

/**
 * RBAC Brick 6 — Copy Setup wizard flow.
 *
 * THE CENTRAL ASSERTION IS AN ABSENCE. `api.post`, `api.put`, `api.patch` and
 * `api.del` are spies, and every read-only journey asserts all four were never
 * called. A preview that quietly wrote something would fail here rather than in
 * production.
 *
 * All identities are invented. No test touches a real user.
 */

const TARGET = user({
  id: 9, username: 'test.target', full_name: 'Test Target', department_name: 'Polish 2',
});

const USERS = [
  user(),
  TARGET,
  user({ id: 3, username: 'test.inactive', full_name: 'Test Inactive', is_active: false }),
];

function makeApi({ previewPayload = payload(), previewError = null, postImpl } = {}) {
  const state = { previewPayload, previewCalls: 0 };

  const get = vi.fn(async (url) => {
    if (url === '/api/admin/permission-catalog') return CATALOG;
    if (url === '/api/roles') return { data: [{ id: 1, slug: 'operator', name: 'Operator' }] };
    if (url === '/api/roles/1/permissions') return { data: OPERATOR_ROLE_TREE };
    if (url.includes('/copy-setup/preview')) {
      state.previewCalls += 1;
      if (previewError) throw new Error(previewError);
      return state.previewPayload;
    }
    throw new Error(`unexpected GET ${url}`);
  });

  const api = {
    get,
    post: vi.fn(postImpl || (async () => ({ success: true }))),
    put: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  };
  return { api, state };
}

const writeCount = api => api.post.mock.calls.length + api.put.mock.calls.length
  + api.patch.mock.calls.length + api.del.mock.calls.length;

function renderWizard(opts = {}) {
  const { api, state } = makeApi(opts);
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <CopySetupWizard
      targetUser={TARGET}
      users={USERS}
      api={api}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
  return { api, state, onClose, onSuccess, user: userEvent.setup() };
}

/** Source step → categories step, with the preview payload loaded. */
async function chooseSource(ctx) {
  await ctx.user.selectOptions(screen.getByLabelText('Copy setup from'), '2');
  await waitFor(() => expect(
    screen.getByRole('button', { name: /Choose categories/ }).disabled,
  ).toBe(false));
  await ctx.user.click(screen.getByRole('button', { name: /Choose categories/ }));
}

async function selectCategory(ctx, label) {
  await ctx.user.click(screen.getByLabelText(new RegExp(label)));
}

async function generatePreview(ctx) {
  await ctx.user.click(screen.getByRole('button', { name: /Generate preview/ }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('1-4. opening, identities and self-copy', () => {
  it('1. opens as a labelled modal dialog on the source step', () => {
    renderWizard();
    expect(screen.getByRole('dialog', { name: 'Copy User Setup' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Source and target' })).toBeTruthy();
  });

  it('2/3. shows both identities once a source is chosen', async () => {
    const ctx = renderWizard();
    await ctx.user.selectOptions(screen.getByLabelText('Copy setup from'), '2');

    await waitFor(() => expect(screen.getByText('Test Source')).toBeTruthy());
    expect(screen.getByText('Test Target')).toBeTruthy();
    expect(screen.getByText('@test.target')).toBeTruthy();
  });

  it('4. never offers the target as its own source, and says so', () => {
    renderWizard();
    const options = Array.from(screen.getByLabelText('Copy setup from').options).map(o => o.value);
    expect(options).not.toContain('9');
    expect(options).toContain('2');
    // Inactive users are not offered either.
    expect(options).not.toContain('3');
    expect(screen.getByText(/cannot be copied onto themselves/i)).toBeTruthy();
  });

  it('30. keeps the flow blocked when the preview read fails', async () => {
    const ctx = renderWizard({ previewError: 'Server error' });
    await ctx.user.selectOptions(screen.getByLabelText('Copy setup from'), '2');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Server error/));
    expect(screen.getByRole('button', { name: /Choose categories/ }).disabled).toBe(true);
    expect(writeCount(ctx.api)).toBe(0);
  });
});

describe('5-7. category selection', () => {
  it('5. selects nothing by default and requires an explicit choice', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);

    for (const label of ['Permission Overrides', 'Inventory Visibility', 'Preferences',
      'Dashboard', 'Templates']) {
      expect(screen.getByLabelText(new RegExp(label)).checked).toBe(false);
    }
    expect(screen.getByText(/0 of 5 selected/)).toBeTruthy();
  });

  it('7. disables the preview button until a category is selected', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);

    expect(screen.getByRole('button', { name: /Generate preview/ }).disabled).toBe(true);
    await selectCategory(ctx, 'Dashboard');
    expect(screen.getByRole('button', { name: /Generate preview/ }).disabled).toBe(false);
  });

  it('does not tie categories together', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Permission Overrides');

    expect(screen.getByLabelText(/Permission Overrides/).checked).toBe(true);
    expect(screen.getByLabelText(/Inventory Visibility/).checked).toBe(false);
    expect(screen.getByLabelText(/Preferences/).checked).toBe(false);
    expect(screen.getByLabelText(/Dashboard/).checked).toBe(false);
  });

  it('labels every category REPLACE rather than "copy"', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    expect(screen.getAllByText('Replace')).toHaveLength(5);
  });
});

describe('6, 8-16. the preview', () => {
  it('8/9. renders the permission diff with source, target and result', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Permission Overrides');
    await generatePreview(ctx);

    expect(screen.getByRole('heading', { name: 'Copy preview' })).toBeTruthy();
    expect(screen.getByText('Added (1)')).toBeTruthy();
    expect(screen.getByText('Changed (1)')).toBeTruthy();
    expect(screen.getByText('Removed (1)')).toBeTruthy();
    expect(screen.getByText(/Added inventory:stock_transfer/)).toBeTruthy();
  });

  it('6. does not preview a category that was not selected', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Dashboard');
    await generatePreview(ctx);

    expect(screen.getByText(/Preferences — not selected, not previewed, not copied/)).toBeTruthy();
    expect(screen.queryByText(/Removed compact_mode/)).toBeNull();
  });

  it('10. renders the inventory scope diff and denies it grants authority', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Inventory Visibility');
    await generatePreview(ctx);

    expect(screen.getByText('Growing')).toBeTruthy();
    expect(screen.getByText('Growing, Polish 2')).toBeTruthy();
    expect(screen.getByText(/does not grant transaction or approval authority/i)).toBeTruthy();
  });

  it('11. renders the preference diff and the vis.* exclusion and deletion', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Preferences');
    await generatePreview(ctx);

    expect(screen.getByText(/Changed theme — light becomes dark/)).toBeTruthy();
    expect(screen.getByText(/1 source vis\.\* key is excluded from the copy/)).toBeTruthy();
  });

  it('12. renders the dashboard diff without implying it grants access', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Dashboard');
    await generatePreview(ctx);

    expect(screen.getByText(/Added pending_transfers at position 1/)).toBeTruthy();
    expect(screen.getByText(/does not grant permission to the underlying feature/i)).toBeTruthy();
  });

  it('13. renders the template diff, dedupes and keeps ownership', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Templates');
    await generatePreview(ctx);

    expect(screen.getByText(/Added share of Source private view \(a template the source created\)/)).toBeTruthy();
    expect(screen.getByText(/Removed share of Target only view/)).toBeTruthy();
    expect(screen.getByText(/1 duplicate entry ignored/)).toBeTruthy();
  });

  it('14/15/16. states what is never copied', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Dashboard');
    await generatePreview(ctx);

    expect(screen.getByRole('heading', { name: /Never copied/ })).toBeTruthy();
    expect(screen.getByText('Role')).toBeTruthy();
    expect(screen.getByText('Primary department')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    expect(screen.getByText('MFA enrolment')).toBeTruthy();
    expect(screen.getByText('Sessions and refresh tokens')).toBeTruthy();
  });
});

describe('17, 18, 20, 21. warnings', () => {
  it('17. names each destructive consequence', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Preferences');
    await generatePreview(ctx);

    expect(screen.getByText(/removes or overwrites existing target settings/i)).toBeTruthy();
    expect(screen.getByText(/1 target preference will be removed/)).toBeTruthy();

    /* RBAC Brick 7: this asserted the vis.* deletion warning, which was correct
       for Brick 6's unfiltered DELETE. The DELETE is now filtered, so those rows
       survive — the warning would be a false statement, and the screen states the
       preservation instead. Inverted rather than removed, so a regression back to
       the destructive SQL fails here. */
    expect(screen.queryByText(/will be deleted and not replaced/)).toBeNull();
    expect(screen.getByText(/stored vis\.\* preference[\s\S]*will be kept[\s\S]*unchanged/)).toBeTruthy();
  });

  it('18. announces the high-risk grant with its capability named', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Permission Overrides');
    await generatePreview(ctx);

    const alerts = screen.getAllByRole('alert').map(el => el.textContent).join(' ');
    expect(alerts).toMatch(/High-risk access change/);
    expect(alerts).toMatch(/Stock Transfer/);
    expect(alerts).toMatch(/Denied → Allowed/);
  });

  it('shows the before/after effective totals', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    await selectCategory(ctx, 'Permission Overrides');
    await generatePreview(ctx);

    const impact = screen.getByRole('heading', { name: 'Effective access impact' }).parentElement;
    // The tile splits its value across text nodes, so read the section instead.
    // The fixture grants APPROVE and revokes a journal VIEW, so the totals hold
    // steady at 2/1 while two individual results move in opposite directions —
    // exactly the case a headline count alone would hide.
    expect(impact.textContent).toMatch(/Allowed actions2 → 20 after copy/);
    expect(impact.textContent).toMatch(/Denied actions1 → 10 after copy/);
    expect(impact.textContent).toMatch(/Results that change21 newly allowed · 1 newly denied/);
    expect(impact.textContent).toMatch(/Stock Transfer → APPROVE.*Denied → Allowed · Risk HIGH/);
    expect(impact.textContent).toMatch(/Journal Entries → VIEW.*Allowed → Denied · Risk LOW/);
  });

  it('20. warns that copied denies do not restrict a Super Admin target', async () => {
    const superTarget = payload();
    superTarget.target.role = 'super_admin';
    const { api } = makeApi({ previewPayload: superTarget });
    render(
      <CopySetupWizard
        targetUser={{ ...TARGET, role: 'super_admin' }}
        users={USERS}
        api={api}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Copy setup from'), '2');
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Choose categories/ }).disabled,
    ).toBe(false));
    await u.click(screen.getByRole('button', { name: /Choose categories/ }));

    expect(screen.getByText(/Permission overrides do not restrict the bypass/)).toBeTruthy();
  });

  it('21. states that a Super Admin source transfers no bypass', async () => {
    const superSource = payload();
    superSource.source.role = 'super_admin';
    const ctx = renderWizard({ previewPayload: superSource });
    await chooseSource(ctx);
    await selectCategory(ctx, 'Permission Overrides');
    await generatePreview(ctx);

    expect(screen.getByText(/not materialised into override rows/)).toBeTruthy();
    // Still only the three stored rows — no 4095-row explosion.
    expect(screen.getAllByText('3 override rows').length).toBeGreaterThan(0);
  });
});

describe('22-24. the preview writes nothing', () => {
  it('22/23/24. performs zero writes across the whole read-only journey', async () => {
    const ctx = renderWizard();

    await chooseSource(ctx);
    // Select every category, then deselect two.
    for (const label of ['Permission Overrides', 'Inventory Visibility', 'Preferences',
      'Dashboard', 'Templates']) {
      await selectCategory(ctx, label);
    }
    await selectCategory(ctx, 'Templates');
    await selectCategory(ctx, 'Dashboard');
    await generatePreview(ctx);

    expect(screen.getByRole('heading', { name: 'Copy preview' })).toBeTruthy();
    await ctx.user.click(screen.getByRole('button', { name: /Continue to confirm/ }));
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy();

    await ctx.user.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);

    expect(ctx.api.post).not.toHaveBeenCalled();
    expect(ctx.api.put).not.toHaveBeenCalled();
    expect(ctx.api.patch).not.toHaveBeenCalled();
    expect(ctx.api.del).not.toHaveBeenCalled();
    expect(writeCount(ctx.api)).toBe(0);
    expect(ctx.onClose).toHaveBeenCalled();
  });

  it('23. toggling a category issues no request at all', async () => {
    const ctx = renderWizard();
    await chooseSource(ctx);
    const before = ctx.api.get.mock.calls.length;

    await selectCategory(ctx, 'Preferences');
    await selectCategory(ctx, 'Templates');
    await selectCategory(ctx, 'Preferences');

    expect(ctx.api.get.mock.calls.length).toBe(before);
    expect(writeCount(ctx.api)).toBe(0);
  });
});

describe('19, 25-29, 31. confirmation and apply', () => {
  async function reachConfirm(ctx, labels = ['Permission Overrides']) {
    await chooseSource(ctx);
    for (const label of labels) await selectCategory(ctx, label);
    await generatePreview(ctx);
    await ctx.user.click(screen.getByRole('button', { name: /Continue to confirm/ }));
  }

  it('19. blocks Apply until both acknowledgements are given', async () => {
    const ctx = renderWizard();
    await reachConfirm(ctx);

    expect(screen.getByRole('button', { name: /Apply Copy Setup/ }).disabled).toBe(true);

    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));
    expect(screen.getByRole('button', { name: /Apply Copy Setup/ }).disabled).toBe(true);

    await ctx.user.click(screen.getByLabelText(/grants 1 high-risk capability/i));
    expect(screen.getByRole('button', { name: /Apply Copy Setup/ }).disabled).toBe(false);
  });

  it('25-27. sends one request to the existing endpoint with only the selected flags', async () => {
    const ctx = renderWizard();
    await reachConfirm(ctx, ['Permission Overrides', 'Inventory Visibility']);

    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));
    await ctx.user.click(screen.getByLabelText(/grants 1 high-risk capability/i));
    await ctx.user.click(screen.getByRole('button', { name: /Apply Copy Setup/ }));

    await waitFor(() => expect(ctx.api.post).toHaveBeenCalledTimes(1));
    const [url, body] = ctx.api.post.mock.calls[0];
    expect(url).toBe('/api/admin/users/9/copy-setup');
    expect(body).toEqual({
      source_user_id: 2,
      copy_permissions: true,
      copy_visibility: true,
      copy_preferences: false,
      copy_dashboard: false,
      copy_templates: false,
    });
    // One atomic request, never one per category.
    expect(writeCount(ctx.api)).toBe(1);
  });

  it('28. reports success to the caller and closes', async () => {
    const ctx = renderWizard();
    await reachConfirm(ctx);
    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));
    await ctx.user.click(screen.getByLabelText(/grants 1 high-risk capability/i));
    await ctx.user.click(screen.getByRole('button', { name: /Apply Copy Setup/ }));

    await waitFor(() => expect(ctx.onSuccess).toHaveBeenCalled());
    expect(ctx.onClose).toHaveBeenCalled();
  });

  it('29. does not claim success when the server rejects the copy', async () => {
    const ctx = renderWizard({ postImpl: async () => { throw new Error('Server error'); } });
    await reachConfirm(ctx);
    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));
    await ctx.user.click(screen.getByLabelText(/grants 1 high-risk capability/i));
    await ctx.user.click(screen.getByRole('button', { name: /Apply Copy Setup/ }));

    await waitFor(() => expect(
      screen.getByText(/The copy did not complete\. Server error/),
    ).toBeTruthy());
    expect(ctx.onSuccess).not.toHaveBeenCalled();
    expect(ctx.onClose).not.toHaveBeenCalled();
    // The selection survives so the admin can retry.
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy();
  });

  it('31. refuses to apply when the target moved under the preview', async () => {
    const ctx = renderWizard();
    await reachConfirm(ctx);
    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));
    await ctx.user.click(screen.getByLabelText(/grants 1 high-risk capability/i));

    // Someone else edits the target between preview and apply.
    const moved = payload();
    moved.categories.preferences.target.push({ pref_key: 'default_branch', pref_value: 'B' });
    ctx.state.previewPayload = moved;

    await ctx.user.click(screen.getByRole('button', { name: /Apply Copy Setup/ }));

    await waitFor(() => expect(
      screen.getByText(/Target user configuration changed after this preview/),
    ).toBeTruthy());
    expect(ctx.api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Apply Copy Setup/ }).disabled).toBe(true);
  });

  it('changing a category after previewing sends the admin back to re-review', async () => {
    const ctx = renderWizard();
    await reachConfirm(ctx);
    await ctx.user.click(screen.getByLabelText(/replaces existing settings/i));

    await ctx.user.click(screen.getByRole('button', { name: /Back/ }));
    await ctx.user.click(screen.getByRole('button', { name: /Back/ }));
    await selectCategory(ctx, 'Templates');
    await generatePreview(ctx);
    await ctx.user.click(screen.getByRole('button', { name: /Continue to confirm/ }));

    // The acknowledgement was cleared, so Apply is blocked again.
    expect(screen.getByLabelText(/replaces existing settings/i).checked).toBe(false);
    expect(screen.getByRole('button', { name: /Apply Copy Setup/ }).disabled).toBe(true);
  });
});
