# Cost-Centre Corrections — Preview Table Feature (implementation plan)

> For a **fresh, runnable session**. Goal: clicking **Preview** lists the matching
> JE lines in a selectable table (checkbox per row), with **Account** and
> **Transaction Type** columns, for both Bulk Assign and Bulk Replace.
> Constraint: do not change accounting logic, balances, or break the page.

## Current behaviour (why no table shows)
- The screenshot page is the **`?v=new`** Corrections component (a *different* file
  than the document-grouped `CostCenterCorrectionsPage.jsx`). **Read that component first.**
- Preview currently calls the **dryRun**, which returns only a **count**
  (`{ dryRun, affected }` → "33 matching line(s)"). The backend never sends the
  actual lines, so the frontend has nothing to render in a table.

## Backend changes — `server/routes/costCenterBulk.js`
1. Add a **preview-lines** response (reuse the existing `buildWhere(filters)` so the
   matching logic stays byte-identical). Return per matching line:
   `je_line_id, je_id, document_number, vendor, account_code, account_name,
    source_type AS transaction_type, debit, credit, current_cost_center_id, current_cost_center_name`.
   - Join `je_lines jl` → `journal_entries je` → `accounts a` (account code/name) →
     `cost_centers cc` (current cc name). Keep `IS DISTINCT FROM target` ONLY for the
     count badge, NOT for the listing (so already-assigned lines are still visible).
2. Add a **selective apply** path keyed by chosen `je_line_id`s (so checkboxes work)
   instead of re-running the filter.
   - **Reuse `/cost-centers/bulk-reassign`** if it already applies by `je_line_ids`
     (it does in `CostCenterCorrectionsPage.jsx` handlePreview/handleApply) — avoids
     writing new mutation logic. Confirm it writes `cost_center_audit` rows.

## Frontend changes — the `?v=new` Corrections component
1. On **Preview**, call the new preview-lines endpoint with the current filters
   (Bulk Assign: cost-centre-to-assign + optional account/dates/type;
    Bulk Replace: existing cost-centre + optional account/dates/type).
2. Render a **table** of returned lines with columns:
   `[ ] | Document | Account | Transaction Type | Debit | Credit | Current Cost Centre`
   - Checkbox per row + a header select-all.
3. **Apply** sends only the **checked** `je_line_id`s to the selective-apply path.
4. Keep the existing forms/labels; only add the results table + checkboxes below Preview.

## Non-negotiables (unchanged from the engine's guarantees)
- Update **only** `je_lines.cost_center_id`. Never touch debit/credit/account_id/balances.
- Write one `cost_center_audit` row per changed line (old → new + reason).
- Require at least one filter (existing guard) so Apply can never hit the whole ledger.

## Test after building (runnable session)
- Preview with only a cost centre selected → table lists all matching lines.
- Preview with account = Seed (send `account.id`, not code) → only Seed lines.
- Check 2 of 33 rows → Apply → exactly those 2 lines change; audit has 2 rows;
  `SUM(debit)`/`SUM(credit)` and all `accounts.balance` unchanged.

## Related
- Why the old search returned 0: see the audit (search used `je.entity_type` /
  `purchase_invoices`; this system uses `je.source_type` / `purchase_notes`).
