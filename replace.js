const fs = require('fs');
const files = [
  'client/src/modules/sales/pages/InvoicesPage.jsx',
  'client/src/modules/rough-diamonds/pages/RoughGrowthPages.jsx',
  'client/src/modules/purchase/pages/VendorBillsPage.jsx',
  'client/src/modules/purchase/pages/PurchaseNotesPage.jsx',
  'client/src/modules/purchase/pages/ExpensesPage.jsx',
  'client/src/modules/accounting/pages/BankDepositPage.jsx',
  'client/src/modules/accounting/pages/JournalEntryForm.jsx',
  'client/src/modules/accounting/pages/ReceiptEntryPage.jsx',
  'client/src/modules/accounting/pages/PaymentEntryPage.jsx',
  'client/src/modules/fixed-assets/pages/ManualFixedAssetEntryPage.jsx'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log('Skipping ' + file);
    continue;
  }
  let code = fs.readFileSync(file, 'utf8');

  // Change handleSave signature
  code = code.replace(/const handleSave = async \(\) => \{/g, "const handleSave = async (action = 'close') => {");
  
  // Replace navigate inside the handleSave block
  // We can just globally replace navigate(...) with if (action === 'new') ...
  // But to be safe, let's just find navigate(something) and replace it ONLY inside handleSave
  let match = code.match(/const handleSave = async \(action = 'close'\) => \{([\s\S]*?)\n  \};/);
  if (!match) {
    code = code.replace(/const handleSave = async \(e\) => \{/g, "const handleSave = async (e, action = 'close') => {");
    match = code.match(/const handleSave = async \(e, action = 'close'\) => \{([\s\S]*?)\n  \};/);
  }

  if (match) {
    let inner = match[1];
    // This regex matches navigate(...) and replaces it with logic to reload the page or navigate
    let newInner = inner.replace(/navigate\((.*?)\);/g, "if (action === 'new') { window.location.href = window.location.pathname.endsWith('/new') || window.location.pathname.endsWith('/manual') ? window.location.pathname : window.location.pathname.replace(/\\/[^\\/]+(\\/edit)?$/, '/new'); } else { navigate($1); }");
    code = code.replace(match[0], match[0].replace(inner, newInner));
  }

  // Replace right button in StickyActionFooter
  code = code.replace(/right=\{\s*<button[^>]*onClick=\{handleSave\}[^>]*>([\s\S]*?)<\/button>\s*\}/g, (fullMatch, buttonInner) => {
    let isSaving = buttonInner.includes('loading') || buttonInner.includes('saving');
    let condition = isSaving ? (buttonInner.includes('loading') ? 'loading' : 'saving') : 'false';
    let normalText = buttonInner.includes('Save & Post JE') ? 'Save & Post JE' : 'Save & Close';
    let loadingText = buttonInner.includes('Posting') ? 'Posting...' : 'Saving...';
    
    return `right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => handleSave('new')} disabled={${condition}} style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
                {${condition} ? '${loadingText}' : 'Save & New'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={${condition}}>
                <Save size={13} /> {${condition} ? '${loadingText}' : '${normalText}'}
              </button>
            </div>
          }`;
  });

  // ManualFixedAssetEntryPage specific replacement
  if (file.includes('ManualFixedAssetEntryPage')) {
    code = code.replace(/<button className="btn btn-primary" onClick=\{handleSave\} disabled=\{loading\} style=\{\{ flex: 1 \}\}>\s*<Save size=\{14\} \/> \{loading \? 'Saving...' : 'Save Fixed Asset'\}\s*<\/button>/,
    `<div style={{ display: 'flex', gap: 8, flex: 1 }}>
              <button className="btn" onClick={() => handleSave('new')} disabled={loading} style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', flex: 1 }}>
                {loading ? 'Saving...' : 'Save & New'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={loading} style={{ flex: 1 }}>
                <Save size={14} /> {loading ? 'Saving...' : 'Save & Close'}
              </button>
            </div>`);
  }

  fs.writeFileSync(file, code);
  console.log('Processed ' + file);
}
