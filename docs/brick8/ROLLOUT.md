# RBAC Brick 8 — Backend Enforcement Rollout

Status on delivery: **every group LEGACY. Nothing is enforced. Nothing is deployed.**

This document is the operating manual for turning it on.

---

## 1. What Brick 8 changed, in one paragraph

Before this brick, no production route consulted the effective-permission
resolver through middleware — `grep -rn checkPermission server/routes/` returns
zero. Authorization was `authorize('admin', 'operator')` role strings on 197
method/path pairs, plus a handful of in-handler `hasPermission` calls, plus 181
pairs with nothing but the global `authenticate` gate. The permission
configuration administrators edit in the Admin Panel was therefore **not
enforced on any route**.

Brick 8 adds the enforcement path, classifies all 422 registered method/path
pairs, and leaves the path switched off.

---

## 2. The switches

One variable per rollout group. Absent means `legacy`.

```
RBAC_ENFORCE_GENERAL=legacy|shadow|strict
RBAC_ENFORCE_INVENTORY=…
RBAC_ENFORCE_INVENTORY_MANAGEMENT=…
RBAC_ENFORCE_STOCK_TRANSFER=…
RBAC_ENFORCE_REPORTS=…
RBAC_ENFORCE_MANUFACTURING=…
RBAC_ENFORCE_ROUGH=…
RBAC_ENFORCE_MASTER_DATA=…
RBAC_ENFORCE_PURCHASE=…
RBAC_ENFORCE_SALES=…
RBAC_ENFORCE_ASSETS=…
RBAC_ENFORCE_ACCOUNTING=…
RBAC_ENFORCE_ADMIN=…

RBAC_ENFORCE_DEFAULT=legacy       # applies to any group not named above
```

`false`/`off`/`0` are accepted for `legacy` and `true`/`on`/`1` for `strict`.
`shadow` must always be asked for by name.

**An unreadable value refuses to boot.** `RBAC_ENFORCE_ACCOUNTING=strct` throws
at startup rather than quietly meaning legacy, because during a rollout a silent
fallback reads as "enforcement is on and nothing broke".

Two further switches, both defaulting to today's behaviour:

```
RBAC_INVENTORY_SCOPE_POLICY=compatibility|canonical
RBAC_LEGACY_USER_PERMISSIONS_FALLBACK=true|false
```

### What the modes mean

| Mode | Who decides | Database cost | Can it deny? |
|---|---|---|---|
| `legacy` | the existing role guard | **zero** — the guard returns before any query | no |
| `shadow` | the existing role guard | one resolver call | **no**, ever |
| `strict` | the effective-permission resolver | one resolver call, cached per request | yes |

Under `strict` the coarse role-string guard for that same capability is stepped
over, so a user holding an explicit per-user ALLOW is not vetoed by
`authorize('admin')`. Department scope (`requireInventoryView`, `loadDeptScope`)
is **never** stepped over — no capability bit replaces it.

---

## 3. Recommended activation order

Derived from blast radius, not from module size. Each step is
`legacy → shadow → read the mismatch report → strict`.

| # | Group | Why here |
|---|---|---|
| 1 | `general` | Dashboard and clipboard. A mistake costs a widget. |
| 2 | `reports` | Read-only. 19 report endpoints have **no** permission check today. |
| 3 | `inventory` | Highest-traffic read surface; scope already applies. |
| 4 | `inventory_management` | Opening/closing/seed/gas. Blocked on baselines — see §5. |
| 5 | `stock_transfer` | CRITICAL. Approve/reject are unguarded today. |
| 6 | `rough` | Small, self-contained. |
| 7 | `manufacturing` | Control Tower is entirely unguarded today. |
| 8 | `master_data` | Blocked on baselines — see §5. |
| 9 | `purchase` | |
| 10 | `sales` | |
| 11 | `assets` | |
| 12 | `accounting` | Money. A denial stops a payment run. |
| 13 | `admin` | **Last.** A wrong Administration mask removes the surface that fixes it. |

---

## 4. Per-module rollback

Set the group's variable back to `legacy` and restart the process. No redeploy,
no git revert, no session invalidation — `authenticate` re-reads `auth_version`
on every request, so changing an enforcement mode does not need tokens reminted
and **must not** sign anybody out.

Rollback is proved by a test: the same guard instance answers `strict` then
`legacy` on consecutive requests
(`brick8Installer.test.js` → "rolling STRICT back to LEGACY restores the role
guard on the next request").

---

## 5. Known mismatches that MUST be resolved before Strict

### 5.1 Eighteen capabilities have no seeded role baseline

These deny **everyone except Super Admin** the moment their group reaches
`strict`. This is the largest single risk in the rollout.

| Capability | Routes | Group |
|---|---|---|
| `management.cost_centres` | 11 | accounting |
| `management.items_master`, `.departments`, `.locations`, `.machines`, `.uom`, `.expense_categories` | 6 each | master_data |
| `management.asset_categories` | 5 | master_data |
| `management.process_master` | 5 | manufacturing |
| `accounting.bank_reconciliation` | 6 | accounting |
| `accounting.transfers` | 3 | accounting |
| `assets.depreciation_runs` | 4 | assets |
| `assets.depreciation_schedule`, `assets.fixed_asset_register` | 3 each | assets, reports |
| `inventory.seed_stock`, `inventory.gas_stock` | 3 each | inventory_management |
| `inventory.inventory_correction` | 3 | inventory |
| `inventory.history_reversal` | 1 | inventory |

Get the live list at any time:

```js
require('./server/security/rbac/routeEnforcementManifest').getMissingBaselineCapabilities()
```

**Action:** grant these to the appropriate roles through the Admin Panel *before*
moving their group past `shadow`. Brick 8 deliberately does not seed them —
creating role grants is a permission decision, not an enforcement one.

### 5.2 Thirty-five routes are SECURITY_BLOCKED

No safe capability mapping exists. They keep their current guard and are never
strict-enforced. Full list:
`require('./server/security/rbac/routeEnforcementManifest').getPreStrictBlockers().security_blocked`

The ones that need a decision:

- **`GET /api/auth/fix-qty-2`** — a one-off repair route under `/api/auth`, which
  app.js exempts from the global authenticate gate, with no route-level guard.
  **It is reachable with no session at all.** Delete it.
- **`/api/process` and `/api/process-transactions`** (14 paths, including
  `send`/`return` material movements) — live routes whose `process.*` catalog
  keys are all `LEGACY_ORPHAN`. Decide whether to re-key onto
  `inventory.process_issues` or retire the namespace.
- **`/api/master` (6 paths)** — a generic router over a table literally named
  `master`, with no column allow-list. Identify it or remove the mount.
- **Deletes with no delete action**: `DELETE /api/expense-bills/:id`,
  `DELETE /api/bank-deposits/:id`, `DELETE /api/transfers/:id`,
  `POST /api/depreciation-runs/:id/cancel`. Add the action to the catalog, then
  reclassify.
- **`/api/asset-templates` (5 paths)** — templates set depreciation defaults for
  every asset created from them; no capability describes them.
- **`POST /api/cache/flush`** — any authenticated user can evict the whole cache.
- **`POST /api/clipboard/bulk-action`** — one branch writes
  `invoices.payment_status` behind an inline `role !== 'admin'` check.
- **`POST /api/lot-movements/split`** — Split has no capability; Mix is not Split.
- **`POST /api/nidhi-connect/batches/:id/reopen`** — a lifecycle reversal.

### 5.3 Approval authority is not modelled

`POST /api/stock-transfer/pending/:id/approve` and `.../reject` are marked
`AUTHORITY_MODEL_MISSING`. `approve` answers *may this user approve at all*, not
*for which destination department*. Strict narrows the population that can
approve; it does not partition it. The self-approval guard and the Pending-status
precondition are untouched and still run.

Today, **reject has no check whatsoever** — no permission, no ownership, no
department. Any authenticated user can reject any pending transfer. Moving
`stock_transfer` to `shadow` early will show exactly who has been reaching it.

### 5.4 Two role strings may already be dead

`accountant` (purchase-note TDS) and `finance` (journal edit/delete, payment
reversal) appear in `authorize(...)` calls but in no `ROLE_DEFAULTS` entry.
Confirm against `roles` before strict, or those users lose access at the switch
for a reason unrelated to Brick 8.

---

## 6. The two compatibility switches

### 6.1 `RBAC_INVENTORY_SCOPE_POLICY` (default `compatibility`)

`services/inventoryAuth.js` carried two role lists answering the same question
differently — a nine-role list at `requireInventoryView` and a three-role list at
`loadDeptScope`. The observable consequence: an `admin` sees **every** department
on the Inventory page and only their **configured** departments on Stock
Transfer, Lot Movements and global search. The Admin Panel shows one stored scope
while the system enforces two different things.

Both now come from `security/rbac/inventoryScopePolicy.js`.

- `compatibility` — reproduces that split exactly. Frozen by test against the
  literal pre-Brick-8 arrays.
- `canonical` — Super Admin alone bypasses, everywhere.

Switching to `canonical` **narrows** visibility for `admin`, `administrator`,
`management`, `manager`, `owner`, `developer`. It never widens anything (also
test-enforced). It is an owner's decision.

### 6.2 `RBAC_LEGACY_USER_PERMISSIONS_FALLBACK` (default `true`)

`resolveEffectivePermission` falls back to the legacy `user_permissions` table
when a user has no role rows and no overrides — which is why Brick 5 could not
certify Default Deny. The table is believed empty, but the development database
is unreachable from the build environment, so the evidence for deletion does not
exist.

The branch is now switchable and stays **on**. Both readers (the per-capability
resolver and the `/api/auth/me` payload builder) consult the same switch, so they
cannot disagree.

**To retire it:** run `SELECT count(*) FROM user_permissions;` against
production. If zero, set the variable to `false` and redeploy. **Do not drop the
table.**

### 6.3 `operator_restricted` default scope

The backend defaults `operator_restricted` to `NONE` while the Admin scope API
reports `ALL` for any unconfigured user. One function,
`inventoryScopePolicy.defaultScopeModeForRole`, now answers for both, so the
panel can stop showing "All departments" for a user who is seeing nothing.
Neither default was changed.

---

## 7. Dependency on Brick 7

Brick 8 code coexists with the Brick 7 migration and does not require it.
Recommended order:

1. Validate `phase87-session-security-hardening.sql` on a scratch database
2. Migrate production
3. Deploy the Brick 7 backend
4. Deploy the Brick 5–7 frontend
5. Deploy Brick 8 — **all groups LEGACY**
6. Verify: the startup log line `[rbac] route enforcement installed` must read
   `unclassified: 0` and `allLegacy: true`
7. Move the first group to `shadow`
8. Read the mismatch report; fix configuration, not code
9. Move that group to `strict`

Changing an enforcement mode does not bump `auth_version` and must not log
anyone out.

---

## 8. Reading the shadow report

```js
require('./server/security/rbac/authorizationTelemetry').getSnapshot()
```

```
shadow.legacy_allow_strict_deny   users about to LOSE access at strict
shadow.legacy_deny_strict_allow   role strings that are over-restrictive today
shadow.by_reason                  MISSING_BIT | UNKNOWN_ACTION |
                                  UNKNOWN_CAPABILITY | RESOLVER_UNAVAILABLE
shadow.evaluation_failures        the resolver could not answer
```

**Do not auto-fix mismatches.** If shadow shows an operator allowed by a legacy
role string but denied by the capability model, that is a business decision:
either the permission data is wrong, or the legacy behaviour was over-permissive.
Brick 8 reports it; the owner decides.

---

## 9. Failure policy

| Situation | Legacy | Shadow | Strict |
|---|---|---|---|
| user lacks the bit | unchanged | unchanged, recorded | 403 `PERMISSION_DENIED` |
| resolver/database unavailable | unchanged | unchanged, recorded | **503 `SECURITY_CHECK_UNAVAILABLE`** |
| capability not in catalog | unchanged | recorded | 403 |
| action not in `PERM_BITS` | unchanged | recorded | 403 |
| no session | unchanged | unchanged | 401 |

A database outage never becomes an implicit allow, and never becomes a 403
either — the user's permissions did not change, we simply could not read them.

---

## 10. Verifying a deployment

```bash
node --test --test-force-exit server/tests/brick8RouteCoverage.test.js
node --test --test-force-exit server/tests/brick8EnforcementModes.test.js
node --test --test-force-exit server/tests/brick8Installer.test.js
node --test --test-force-exit server/tests/brick8CompatibilityPolicies.test.js
```

`--test-force-exit` is required: requiring `app.js` opens the database pools and
the schema-init timers, which keep the event loop alive after the last assertion.

`brick8RouteCoverage.test.js` fails the build if a new route is added without a
manifest entry. That is the mechanism that keeps this document true.

---

## 11. Still open after Brick 8

- **ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN.** Brick 8 enforces *who* may
  call accounting operations. It did not touch *what* they do.
- **WebSocket** — the `'dev_secret'` fallback is removed. Two issues remain, both
  read-side on a channel with no state-changing handlers: the handshake does not
  check the Brick 7 `av` claim, and `subscribe` accepts any room name including
  `user:<other-id>`. Separate hardening task.
- **`vis.*` settings** remain `STORED_NOT_ENFORCED`. Brick 8 activated none of
  them. Converting a stored preference into a security control requires a
  verified backend meaning first.
- **Operational Authority** — not modelled, not invented.
- **`POST /api/reports/export`** checks per-report VIEW but never EXPORT, and
  falls back to the legacy `user_permissions` table and the hard-coded
  `ROLE_DEFAULTS` map — a second and third permission algebra beside the
  canonical resolver.
- **`PUT /api/inventory/edit/:id`** receives no department scope at all
  (`requireInventoryView` is absent). Strict closes the capability half; the
  scope half is still open.
- **`seed_remove_override`** (`lotProcessIssues.js:1650`) is not a `PERM_BITS`
  key, so that check can never succeed. Not fixed — adding the bit is a
  permission change.
