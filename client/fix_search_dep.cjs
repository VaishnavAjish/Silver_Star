const fs = require('fs');

const filesToFix = [
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\accounting\\pages\\JournalEntryForm.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\admin-panel\\pages\\UsersPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\fixed-assets\\pages\\FixedAssetsListPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\InventoryPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotIssueListPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotIssuePage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\MixLotsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\manufacturing\\pages\\ManufacturingDashboardPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\manufacturing\\pages\ProcessMasterPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\PurchaseNotesPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\VendorDetailsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\VendorsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\sales\\pages\\CustomersPage.jsx'
];

for (const file of filesToFix) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes(', [search]);')) {
      content = content.replace(/, \[search\]\);/g, ', []);');
      fs.writeFileSync(file, content, 'utf8');
      console.log('Fixed search dep in:', file);
    }
  } catch(e) {
    console.error('Error on', file, e.message);
  }
}
