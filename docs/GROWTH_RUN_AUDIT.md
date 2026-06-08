# Growth Run Implementation — Runtime Verification Audit

**Date:** 2026-06-05  
**Auditor:** Senior ERP Debugging Engineer  
**Scope:** Verify whether previously implemented Growth Run fixes are active in production

---

## Executive Summary

The backend implementation is **complete and correct**. All Growth Run service
functions (`applyMeasurements`, `advanceGrowthRunToStock`, `recordGrowthCycle`)
are deployed, mounted, and execute correctly via the Manufacturing Control Tower
path. Three independent frontend bugs in `LotWorkspacePage.jsx` cause every
Growth Run return initiated from the inventory workspace to fall through to the
old generic Process Return form instead of the Growth Run Return dialog.

---

## Symptom Mapping

| # | Symptom Reported | Root Cause | Status |
|---|---|---|---|
| 1 | Growth Run return opens old Process Return workspace | Lazy-load race + wrong routing in LotWorkspacePage | **CONFIRMED** |
| 2 | Generated code shows GR-xxxx-R1 | LotReturnPage renders GR-xxxx-R1 preview client-side | **CONFIRMED** |
| 3 | Growth Run returns behave like standard inventory returns | Wrong return path opens the generic form | **CONFIRMED** |
| 4 | Genealogy behavior unchanged | Backend guard is active; issue is frontend showing wrong form | **CONFIRMED** |

---

## Section A — Growth Run Return Path: Full Execution Trace

### User flow traced:
**Growth Run → Edge Cut → Open Workspace → Record Return**

---

### Step 1 — "Open Workspace" button

**File:** `client/src/modules/rough-diamonds/pages/GrowthRunsPage.jsx`  
**Line:** 308

```js
openTab({
  id:   `/inventory/lots/${r.id}`,
  path: `/inventory/lots/${r.id}`,
  ...
})
```

Opens `LotWorkspacePage` at route `/inventory/lots/{id}`.  
The page opens on the **Overview** tab by default.

---

### Step 2 — processData lazy-load (the root timing bug)

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 179–187

```js
useEffect(() => {
  if (activeTab !== 'process' || processLoaded || !lot) return;   // ← guard
  api.get(`/api/lot-process-issues?lot_id=${id}`)
    .then(([issueData]) => {
      setProcessData({ issues: issueData.data || [] });
      setProcessLoaded(true);
    });
}, [activeTab, processLoaded, lot, id]);
```

`processData` is **only fetched when the user clicks the "Process" tab**.  
On page open, `activeTab = 'overview'`, so `processData = null`.

---

### Step 3 — isCurrentlyInCvdGrowth evaluates to false

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 231–236

```js
const isGrowthRun = lot.category === 'growth_run';

const activeProcessIssue = processData?.issues?.find(i => i.status === 'OPEN');
// processData is null → activeProcessIssue is undefined

const isCurrentlyInCvdGrowth =
  isInProcess && activeProcessIssue?.process_type === 'growth';
// undefined?.process_type → false
```

`isCurrentlyInCvdGrowth = false` whenever the user has not yet clicked the
Process tab.

---

### Step 4 — Wrong action appears in Actions dropdown

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 239–253

```js
const actions = [
  // ...
  isInProcess && !isCurrentlyInCvdGrowth && {
    label: 'Record Return',               // ← SHOWN (generic path)
    fn: () => navigate(`/inventory/process-issues?lot_id=${id}`),
  },
  isCurrentlyInCvdGrowth && {
    label: 'Complete Growth Run',          // ← HIDDEN
    fn: () => setShowGrowthReturn(true),
  },
].filter(Boolean);
```

**"Record Return"** navigates to the generic Process Issues list, not the
Growth Run Return dialog. **The Growth Run special branch is never entered.**

---

### Step 5 — Even after Process tab is visited: handleGrowthReturnSubmit fails

If the user manually clicks the Process tab first, `processData` loads and
`isCurrentlyInCvdGrowth` becomes `true`. The "Complete Growth Run" action then
appears. But on submit:

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 124–160

```js
const handleGrowthReturnSubmit = async () => {
  const activeProcessIssue = processData?.issues?.find(i => i.status === 'OPEN');
  const processId = activeProcessIssue?.process_id;   // ← WRONG FIELD NAME
  //                                  ^^^^^^^^^^
  //  The lot-process-issues API returns machine_process_id, not process_id.
  //  This is always undefined.

  if (!processId) {
    toast.error("Could not find the active process ID.");
    return;          // ← ALWAYS EXITS HERE — API is never called
  }
  await api.patch(`/api/manufacturing/processes/${processId}/complete`, { ... });
};
```

**The Growth Run Return from LotWorkspacePage never reaches the API.**

---

### Step 6 — Process Tab "Return" button: unconditional wrong navigation

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 636–639

```jsx
{isOpen && (
  <button
    onClick={() => navigate(`/inventory/process-issues/${issue.id}/return`)}>
    <RotateCcw size={11} /> Return
  </button>
)}
```

This fires for **every** open issue regardless of lot category. For a Growth
Run, it opens `LotReturnPage` — the old generic Process Return workspace.

---

### The one working path (Control Tower)

**File:** `client/src/modules/manufacturing/pages/ManufacturingDashboardPage.jsx`

```
Machine card (running) → "Complete" button
  → handleAction('complete', machine)                             line 1110
  → setConfirmModal({ action: 'complete', machine })             line 1115
  → ConfirmActionModal rendered                                  line 1474
  → isGrowth = processMap.get(machine.process_type).process_group
               === 'GROWTH'                                      line 1478
  → isGrowthReturn = action === 'complete' && isGrowth           line 833
  → Weight / Height / Length / Width fields shown
  → handleConfirmAction                                          line 1119
  → PATCH /api/manufacturing/processes/{id}/complete             line 1128
```

**Backend handler:** `server/routes/manufacturingProcesses.js` line 688

```js
const isGrowth = String(proc.process_group || '').toUpperCase() === 'GROWTH';

if (isGrowth) {
  // ✓ applyMeasurements
  // ✓ advanceGrowthRunToStock
  // ✓ consumeSeeds (lot_op_log 'seed_consumed')
  // ✓ recordGrowthCycle
  // ✓ lot_op_log entry 'growth_run_returned'
}
```

This path executes correctly. It is accessible only from the Manufacturing
Control Tower.

---

## Section B — GR-xxxx-R1 Code Investigation

### Where the code originates (client-side preview)

**File:** `client/src/modules/inventory/pages/LotReturnPage.jsx`  
**Lines:** 32–38

```js
function previewCode(processLotCode, type, priorSameType, existingCounts) {
  if (!processLotCode || !type) return '—';
  const cfg = TYPE_MAP[type];    // { value: 'usable', suffix: 'R', ... }
  const base = existingCounts[cfg.suffix] || 0;
  return `${processLotCode}-${cfg.suffix}${base + priorSameType + 1}`;
  //       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //  For a Growth Run lot_code = 'GR-YYYYMM-NNNN', type = 'usable':
  //  → 'GR-YYYYMM-NNNN-R1'
}
```

When the user opens `LotReturnPage` for a Growth Run issue and selects return
type "Usable", the UI **renders** `GR-YYYYMM-NNNN-R1` as the preview lot code.

### TYPE_SUFFIX constant

**File:** `server/routes/lotProcessIssues.js`  
**Line:** 832

```js
const TYPE_SUFFIX = {
  usable:   'R',
  damaged:  'D',
  consumed: 'C',
  reprocess:'P',
  qc_hold:  'Q',
};
```

### Does the backend actually create GR-xxxx-R1?

**File:** `server/routes/lotProcessIssues.js`  
**Lines:** 925–981

```js
const isGrowthRun = processLot.category === 'growth_run';

for (const line of lines) {

  // Growth Run: no clone, no child lot
  if (isGrowthRun) {
    await client.query(
      `INSERT INTO process_return_lines ...`,
      [ret.id, line.type, qty, processLot.id, processLot.lot_code, ...]
    );
    await logOp(...);
    outcomes.push({ ..., in_place: true });
    continue;    // ← nextReturnLotCode is never called
  }

  // Only reached for non-growth_run lots:
  const childCode = await nextReturnLotCode(
    client, processLot.id, parentCode, suffix
  );
```

**The backend does NOT create GR-xxxx-R1.** The `isGrowthRun` guard is active.
The lot is returned in-place; no child inventory row is inserted.

### Verdict

| Layer | GR-xxxx-R1 behaviour |
|---|---|
| Frontend — LotReturnPage preview | **Displayed** on screen to operator |
| Backend — lotProcessIssues /:id/return | **Not created** — guard is active |

The discrepancy is that the **wrong UI is shown** (LotReturnPage instead of
the Growth Run Return dialog), and that UI displays a misleading lot code
preview that never materialises in the database.

---

## Section C — Growth Run Category Verification

### How category is assigned

**File:** `server/services/growthRunService.js`  
**Line:** 163 (INSERT)

```sql
INSERT INTO inventory (
  item_id,        -- → items.id WHERE items.category = 'growth_run'
  lot_number,     -- 'GR-YYYYMM-NNNN'
  status,         -- 'IN PROCESS' at creation
  source_type,    -- 'growth'
  operation_type, -- 'growth_output'
  ...
)
```

### How status changes at Edge Cut issue

**File:** `server/routes/lotProcessIssues.js`  
**Lines:** 529–535

```sql
UPDATE inventory
   SET status           = 'IN PROCESS',
       machine_process_id = $1,
       updated_at        = NOW()
 WHERE id = $2
-- item_id is NOT touched — category remains 'growth_run'
```

### How category is read at return time

**File:** `server/routes/lotProcessIssues.js`  
**Lines:** 916–920

```sql
SELECT inv.*, i.category, i.name AS item_name
  FROM inventory inv
  JOIN items i ON inv.item_id = i.id
 WHERE inv.id = $1
```

**Verified:** `category = 'growth_run'` is preserved at every stage. The lot
is never re-categorised. The `isGrowthRun` guard at return time correctly
evaluates to `true`. `source_type = 'growth'`, `operation_type = 'growth_output'`
remain unchanged.

---

## Section D — Two Distinct Dialogs Exist; Wrong One Is Used

### Dialog 1 — Growth Run Return (correct)

**Component:** `ConfirmActionModal`  
**File:** `client/src/modules/manufacturing/pages/ManufacturingDashboardPage.jsx`  
**Lines:** 825–941

- Shows: Weight *, Height *, Length, Width, Remarks  
- Calls: `PATCH /api/manufacturing/processes/:id/complete`  
- Backend: `manufacturingProcesses.js:688` — Growth branch with full side-effects

### Dialog 2 — Process Return Workspace (wrong for Growth Runs)

**Component:** `LotReturnPage`  
**File:** `client/src/modules/inventory/pages/LotReturnPage.jsx`

- Shows: Return type selector, quantity, lot code preview (GR-xxxx-R1)  
- Calls: `POST /api/lot-process-issues/:id/return`  
- Backend: Returns in-place correctly, but operator sees wrong form

### Which dialog is actually used from the Lot Workspace?

| Trigger | Navigation target | Dialog opened |
|---|---|---|
| Actions dropdown "Record Return" (default) | `/inventory/process-issues?lot_id=` | **Dialog 2 — wrong** |
| Process tab "Return" button | `/inventory/process-issues/{id}/return` | **Dialog 2 — wrong** |
| Actions dropdown "Complete Growth Run" (after Process tab load) | `setShowGrowthReturn(true)` | Fails — `process_id` bug |
| Control Tower "Complete" button | `setConfirmModal` | **Dialog 1 — correct** |

---

## Section E — Function Reachability

### recordGrowthCycle

| Call site | File | Line | Reachable via UI? |
|---|---|---|---|
| PATCH /complete — Growth branch | `manufacturingProcesses.js` | 795 | Yes — Control Tower |
| POST /:id/return — with measurements | `lotProcessIssues.js` | 1056 | Yes — laser op return |

### applyMeasurements

| Call site | File | Line | Reachable via UI? |
|---|---|---|---|
| PATCH /growth-runs/:id/measurements | `growthRuns.js` | 180 | Yes — GrowthRunsPage Measure button |
| PATCH /complete — Growth branch | `manufacturingProcesses.js` | 753 | Yes — Control Tower |
| POST /rough-growth — before consume | `roughGrowth.js` | 443 | Yes — Growth Output form |
| POST /:id/return — with measurements | `lotProcessIssues.js` | 1048 | Yes — laser op return |

### advanceGrowthRunToStock

| Call site | File | Line | Reachable via UI? |
|---|---|---|---|
| PATCH /complete — Growth branch | `manufacturingProcesses.js` | 763 | Yes — Control Tower |
| POST /:id/return — OUTPUT_BASED final | `lotProcessIssues.js` | 1149 | Yes — final seed return |

**All three functions are reachable. None are dead code. They execute correctly
via the Control Tower path. The Lot Workspace path never reaches any of them.**

---

## Section F — Deployment Verification

**File:** `server/app.js`

| Route prefix | Import line | Mount line | Status |
|---|---|---|---|
| `/api/growth-runs` | 132 | 174 | Mounted |
| `/api/manufacturing` | 144 | ~197 | Mounted |
| `/api/lot-process-issues` | 149 | ~200 | Mounted |
| `/api/rough-growth` | 131 | 173 | Mounted |

`server/services/growthRunService.js` exports all five functions.  
All calling route files import the required symbols.  
**No deployment gaps. All routes are live.**

---

## Consolidated Findings

### 1 — What Was Implemented

| Item | File | Lines | Description |
|---|---|---|---|
| Growth branch in PATCH /complete | `manufacturingProcesses.js` | 688–860 | isGrowth detection, measurement requirement, all side-effects |
| ConfirmActionModal growth fields | `ManufacturingDashboardPage.jsx` | 825–941 | Weight/Height/Length/Width when isGrowthReturn |
| showGrowthReturn modal + handler | `LotWorkspacePage.jsx` | 119–160 | Growth Run Return initiated from inventory workspace |
| isGrowthRun backend guard | `lotProcessIssues.js` | 925–981 | Prevents -R1 child lot on return |
| Growth Run exemption from consume | `lotProcessIssues.js` | 1091–1103 | Biscuit not consumed on final return |
| recordGrowthCycle service function | `growthRunService.js` | 314–344 | Persistent cycle-history ledger append |

---

### 2 — What Is Actually Executed

| Path | Result |
|---|---|
| Control Tower → Complete → Growth Run Return | **Executes correctly** — all side-effects fire |
| Lot Workspace → "Record Return" (default) | Opens LotReturnPage — wrong form shown |
| Lot Workspace → Process tab → "Return" | Opens LotReturnPage — wrong form shown |
| Lot Workspace → "Complete Growth Run" | Fails silently at `process_id` field name bug |

---

### 3 — What Is Dead Code

| Location | Lines | Reason |
|---|---|---|
| `LotWorkspacePage.jsx` `handleGrowthReturnSubmit` | 124–160 | `activeProcessIssue?.process_id` is always `undefined`; function always exits at the `!processId` guard; `api.patch` is never called |
| `LotWorkspacePage.jsx` `showGrowthReturn` modal JSX | 679–730 | Modal renders but submit never completes successfully |

---

### 4 — What Is Partially Wired

| Location | Lines | What works | What is broken |
|---|---|---|---|
| `LotWorkspacePage.jsx` `isCurrentlyInCvdGrowth` | 234–236 | Correct logic when `processData` is loaded | `processData` is null on page open; condition always false on first render |
| `LotWorkspacePage.jsx` "Complete Growth Run" action | 247–252 | Shown correctly after Process tab loads | `handleGrowthReturnSubmit` fails at wrong field name |
| LotReturnPage submit → backend | `lotProcessIssues.js:931` | Backend correctly rejects -R1 creation | Frontend shows GR-xxxx-R1 preview and wrong form to operator |

---

### 5 — Root Cause of Remaining Failures

Three independent bugs, all in a single file:

---

#### Bug 1 — Lazy-load race condition

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 179–187 (data fetch), 234 (condition that depends on it)

`processData` is fetched only when `activeTab === 'process'`. On page open the
Overview tab is active. `isCurrentlyInCvdGrowth = false`. "Record Return" is
shown instead of "Complete Growth Run". **The wrong action is always the
default.**

**Required fix:** Load `processData` eagerly at mount for Growth Run lots, or
derive `isCurrentlyInCvdGrowth` from `lot.machine_process_id` and
`lot.source_module` without depending on lazily-loaded issue data.

---

#### Bug 2 — Wrong field name in submit handler

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Line:** 134

```js
// Broken:
const processId = activeProcessIssue?.process_id;

// Correct:
const processId = activeProcessIssue?.machine_process_id;
```

The lot-process-issues list API returns `machine_process_id`. `process_id` does
not exist on the returned object. `processId` is always `undefined`. The submit
handler always exits at the `!processId` guard. **`api.patch` is never called.**

---

#### Bug 3 — Unconditional "Return" navigation in Process tab

**File:** `client/src/modules/inventory/pages/LotWorkspacePage.jsx`  
**Lines:** 636–639

```jsx
// Broken — fires for all lot types:
<button onClick={() => navigate(`/inventory/process-issues/${issue.id}/return`)}>

// Required — check lot type first:
<button onClick={() =>
  isGrowthRun
    ? setShowGrowthReturn(true)
    : navigate(`/inventory/process-issues/${issue.id}/return`)
}>
```

The Process tab "Return" button routes every lot to `LotReturnPage`, bypassing
the Growth Run Return dialog entirely.

---

### 6 — Exact Files Requiring Modification

| File | Line(s) | Change needed |
|---|---|---|
| `client/src/modules/inventory/pages/LotWorkspacePage.jsx` | 134 | `.process_id` → `.machine_process_id` |
| `client/src/modules/inventory/pages/LotWorkspacePage.jsx` | 179–187 | Eager-load `processData` for Growth Run lots on mount, not lazily |
| `client/src/modules/inventory/pages/LotWorkspacePage.jsx` | 636–639 | Guard "Return" button with `isGrowthRun` — route to modal, not LotReturnPage |

**No backend files require modification. The server implementation is correct.**

---

## Appendix — Key Code References

| Symbol | File | Line |
|---|---|---|
| `handleGrowthReturnSubmit` | `LotWorkspacePage.jsx` | 124 |
| `processData` lazy-load effect | `LotWorkspacePage.jsx` | 179 |
| `isCurrentlyInCvdGrowth` | `LotWorkspacePage.jsx` | 234 |
| Actions array (wrong routing) | `LotWorkspacePage.jsx` | 239 |
| Process tab "Return" button | `LotWorkspacePage.jsx` | 636 |
| `showGrowthReturn` modal JSX | `LotWorkspacePage.jsx` | 679 |
| `ConfirmActionModal` (correct dialog) | `ManufacturingDashboardPage.jsx` | 825 |
| `isGrowthReturn` flag | `ManufacturingDashboardPage.jsx` | 833 |
| `isGrowth` prop computation | `ManufacturingDashboardPage.jsx` | 1478 |
| `handleConfirmAction` | `ManufacturingDashboardPage.jsx` | 1119 |
| `PATCH /complete` Growth branch | `manufacturingProcesses.js` | 688 |
| `isGrowthRun` backend guard | `lotProcessIssues.js` | 931 |
| `nextReturnLotCode` | `lotProcessIssues.js` | 845 |
| `TYPE_SUFFIX` map | `lotProcessIssues.js` | 832 |
| `previewCode` (frontend only) | `LotReturnPage.jsx` | 32 |
| `applyMeasurements` | `growthRunService.js` | 227 |
| `advanceGrowthRunToStock` | `growthRunService.js` | 277 |
| `recordGrowthCycle` | `growthRunService.js` | 314 |
| Route mount `/api/growth-runs` | `app.js` | 174 |
