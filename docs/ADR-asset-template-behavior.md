# ADR — Asset Templates Are Creation Defaults Only

**Status:** Approved (with amendment) · Enterprise ERP accounting standard
**Scope:** Asset Templates ↔ Fixed Assets relationship

## Decision

> **Asset Templates are creation defaults only. Once an asset is capitalized, it
> becomes an independent accounting object. Template edits never modify historical
> assets.**

Current behaviour is **correct and must remain unchanged**.

## Non-negotiable rules
1. **No automatic cascade** from an Asset Template to existing Fixed Assets.
2. Editing an Asset Template affects **only future assets** created after the change.
3. Existing Fixed Assets remain unchanged — they are historical accounting
   transactions already reflected in the **General Ledger, Trial Balance,
   Balance Sheet, Fixed Asset Register, and Depreciation Schedule**.

## Hard constraints (do NOT do)
- Do not modify `fixed_assets.category_id` automatically.
- Do not run bulk SQL updates against fixed assets.
- Do not change historical journal entries.
- Do not modify depreciation history.
- Do not introduce hidden synchronization between Asset Templates and Fixed Assets.

## Production goal
Preserve the **General Ledger as the single source of truth** and keep full
reconciliation between: Fixed Asset Register · Trial Balance · Balance Sheet ·
Depreciation · General Ledger.

## Future enhancement (DO NOT build now) — Asset Reclassification Utility
The **only** approved mechanism for changing an existing asset's category.
Planned workflow:
1. Select Asset
2. Show Current Category
3. Choose New Category
4. Reason (mandatory)
5. Preview Accounting Impact
6. Generate Reclassification Journal (if required)
7. Apply
8. Write Audit Trail

This utility must reclassify via a **new journal entry**, never by editing history.

## Code comment to add (when next touching asset-template code)
In the Asset Template create/update handler (`server/routes/assetTemplates.js`)
and the UI (`client/.../fixed-assets/pages/AssetTemplateMasterPage.jsx`), add:
```
// Asset Templates are CREATION DEFAULTS ONLY. Editing a template affects only
// assets created afterwards. Capitalized assets are independent accounting
// objects — never cascade template changes to existing fixed_assets (see
// docs/ADR-asset-template-behavior.md).
```
