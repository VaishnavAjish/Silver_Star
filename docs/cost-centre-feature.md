# Cost Centre Foundation & Correction Utilities

Enterprise cost-centre tracking with full accounting integrity. **Journal balances are never
changed** — `cost_center_id` is analytical metadata only. No hard deletes. Every change is audited.

---

## What was built

### Phase 1 — Foundation
| Area | Files |
|------|-------|
| DB migration (audit table, seeds, columns) | `server/migrations/phase41-cost-center-foundation.sql` |
| Master API (CRUD, status, usage, audit) | `server/routes/costCenters.js` |
| Master page (search, filter, usage, activate/deactivate) | `client/src/modules/management/pages/CostCenterMasterPage.jsx` |
| Fixed Asset integration (selector + persist + acquisition JE + depreciation inheritance) | `server/routes/fixedAssets.js`, `server/routes/depreciationRuns.js`, `client/.../fixed-assets/pages/ManualFixedAssetEntryPage.jsx` |
| Purchase Note integration (selector + JE propagation) | `server/routes/purchaseNotes.js`, `client/.../purchase/pages/PurchaseNotesPage.jsx` |
| Audit trail table | `cost_center_audit` |

### Phase 2 — Correction Utilities
| Area | Files |
|------|-------|
| Bulk Assign + Bulk Replace (per-line audit, dry-run) | `server/routes/costCenterBulk.js` |
| Corrections UI | `client/src/modules/management/pages/CostCenterCorrectionsPage.jsx` |

### Phase 3 — Reporting
| Area | Files |
|------|-------|
| Trial Balance / Dashboard / Startup report endpoints | `server/routes/costCenterReports.js` |
| Reports UI | `client/src/modules/management/pages/CostCenterReportsPage.jsx` |

### Routes added
`/cost-centers`, `/cost-center-corrections`, `/cost-center-reports`
(Management menu). API: `/api/cost-centers`, `/api/cost-center-bulk`, `/api/cost-center-reports`.

---

## Deploy

```bash
cd server
node migrate.js          # applies phase41-cost-center-foundation.sql
# restart backend; rebuild client (npm run build) for production
```

---

## Validation checklist

### Integrity (must all hold)
- [ ] After running the migration, `SELECT * FROM cost_centers` shows CC001/CC002/CC003.
- [ ] `cost_center_audit` table exists with columns: `user_id, changed_at, entity_type, entity_id, old_cost_center_id, new_cost_center_id, reason`.
- [ ] **No journal balance changes**: capture `SELECT id, balance FROM accounts ORDER BY id` before/after any cost-centre operation — values must be identical.
- [ ] **Debit/Credit untouched**: `SELECT SUM(debit), SUM(credit) FROM je_lines` unchanged before/after bulk assign/replace.
- [ ] No DELETE endpoint exists on `/api/cost-centers` (deactivation only).

### Phase 1.A — Master
- [ ] Create a cost centre → appears in list, `cost_center_audit` has a `created` row.
- [ ] Edit name/description → persists; audit `updated` row written.
- [ ] Deactivate → status `inactive`, drops out of default (active-only) dropdowns; audit `deactivated` row.
- [ ] Reactivate → returns to active.
- [ ] Usage column shows non-zero once referenced.
- [ ] Existing dropdowns (no query params) still return only active centres (backward compatible).

### Phase 1.B — Fixed Asset
- [ ] Manual Asset Entry shows a Cost Centre dropdown.
- [ ] Create asset with a cost centre → `fixed_assets.cost_center_id` set.
- [ ] Acquisition JE lines carry that `cost_center_id` (both Dr asset and Cr payable).
- [ ] Run depreciation → depreciation JE lines inherit the asset's cost centre; **JE remains balanced** (Dr expense = Cr accum per cost centre).
- [ ] Cancel a depreciation run → reversal JE mirrors the same cost centres; nets to zero.
- [ ] PATCH asset cost centre works even when depreciation is posted (metadata is not cost-locked).

### Phase 1.C — Purchase Note
- [ ] Purchase Note form shows a Cost Centre dropdown.
- [ ] Create PN with a cost centre → all generated JE lines (inventory/expense Dr, GST Dr, payable Cr) carry the `cost_center_id`.
- [ ] PN created without a cost centre → JE lines have `cost_center_id = NULL` (no regression).

### Phase 2 — Corrections
- [ ] Bulk Assign with **no filter** → rejected (`400`, "At least one filter is required").
- [ ] Preview (dry-run) returns the affected count without changing anything.
- [ ] Apply assign → only `je_lines.cost_center_id` changes; one `cost_center_audit` row per changed line with correct old→new.
- [ ] Bulk Replace existing→new on a date/voucher range → only matching lines move; audit rows written.
- [ ] Replace with existing == new → rejected.
- [ ] Bulk operations only touch live `je_lines` (verify `je_lines_old` is untouched).

### Phase 3 — Reporting
- [ ] Dashboard lists every cost centre with debit/credit/net totals (incl. zero-activity centres).
- [ ] Trial Balance groups by cost centre × account; **Total Debit == Total Credit**.
- [ ] Startup report shows spend for CC001–CC003 only.
- [ ] Date range filter narrows all three reports.

---

## End-to-end test scenarios

### Scenario 1 — Master lifecycle
1. Create CC004 "MARKETING".
2. Edit description.
3. Deactivate → confirm it disappears from a Purchase Note's cost-centre dropdown.
4. Reactivate.
5. Verify `cost_center_audit` has created / updated / deactivated / activated rows for CC004.

### Scenario 2 — Asset acquisition + depreciation inheritance
1. Create a fixed asset with cost centre CC003 (FACTORY SETUP).
2. Confirm acquisition JE: Dr Asset / Cr Payable, both lines `cost_center_id = CC003`.
3. Run a depreciation run covering that asset.
4. Confirm depreciation JE lines carry CC003 and the entry balances.
5. Snapshot `accounts.balance`; cancel the run; confirm reversal nets CC003 to zero and balances return to the snapshot.

### Scenario 3 — Purchase note propagation
1. Create a Purchase Note (seed) with cost centre CC002 (ERP DEVELOPMENT).
2. Confirm every generated JE line carries CC002.
3. Create a second PN with no cost centre → JE lines `NULL` (no regression).

### Scenario 4 — Bulk correction with audit
1. Identify historical JE lines with `cost_center_id IS NULL` for a date range.
2. Bulk Assign CC001 with that date range → Preview shows count → Apply.
3. Confirm `je_lines` updated and `cost_center_audit` has one row per line (old `NULL` → new CC001).
4. **Confirm `SUM(debit)`, `SUM(credit)` and all `accounts.balance` are unchanged.**

### Scenario 5 — Bulk replace
1. Bulk Replace CC001 → CC002 for a voucher range.
2. Confirm only matching lines moved, audit rows written, balances unchanged.

### Scenario 6 — Reporting reconciliation
1. Open Cost Centre Reports → Trial Balance for the full period.
2. Confirm Total Debit == Total Credit.
3. Cross-check the Dashboard net for CC001 equals the sum of its Trial Balance nets.
4. Startup report shows CC001–CC003 only.

---

## Guarantees recap
- `cost_center_id` is **nullable analytical metadata**; it is never part of any balance computation.
- Bulk utilities update **only** `cost_center_id` on the **live** `je_lines` table.
- Every master change and every bulk line change writes to `cost_center_audit`.
- Cost centres are **deactivated, never deleted**.
- Migration and routes are **backward compatible** — existing flows that ignore cost centres are unaffected.
