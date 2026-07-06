import os
import re

files = [
  'client/src/modules/purchase/pages/VendorBillsPage.jsx',
  'client/src/modules/sales/pages/InvoicesPage.jsx',
  'client/src/modules/purchase/pages/PurchaseNotesPage.jsx',
  'client/src/modules/purchase/pages/ExpensesPage.jsx',
  'client/src/modules/accounting/pages/BankDepositPage.jsx',
  'client/src/modules/accounting/pages/ReceiptEntryPage.jsx',
  'client/src/modules/accounting/pages/PaymentEntryPage.jsx',
  'client/src/modules/fixed-assets/pages/ManualFixedAssetEntryPage.jsx'
]

for f in files:
    if not os.path.exists(f):
        print(f"File not found: {f}")
        continue
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # We want to replace the text inside the primary button
    # The primary button usually looks like:
    # <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={saving}>
    #   <Save size={13} /> {saving ? 'Posting…' : 'Save & Post JE'}
    # </button>
    
    # We will use regex to find {saving ? '...' : 'something else'} inside the btn-primary and replace 'something else' with 'Save & Close'
    
    # Actually, simpler: Just replace all instances of:
    # 'Save & Post JE' -> 'Save & Close'
    # 'Save & Post Revenue + COGS' -> 'Save & Close'
    # 'Save & Post' -> 'Save & Close'
    # 'Update Asset' -> 'Update & Close'
    
    replacements = {
        "'Save & Post JE'": "'Save & Close'",
        "'Save & Post Revenue + COGS'": "'Save & Close'",
        "'Save & Post'": "'Save & Close'",
        "'Save Changes'": "'Save & Close'",
        "'Post Receipt'": "'Save & Close'",
        "'Update Receipt'": "'Update & Close'",
        "'Update Deposit'": "'Update & Close'",
    }
    
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
        
    print(f"Processed {f}")
