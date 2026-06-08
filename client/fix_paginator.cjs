const fs = require('fs');

const filesToFix = [
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\InventoryPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotIssueListPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotMovementsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\PurchaseNotesPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\VendorsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\sales\\pages\\CustomersPage.jsx'
];

for (const file of filesToFix) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    
    // First: Revert all clientPage to page
    content = content.replace(
      /<Paginator\s+page=\{clientPage\}\s+totalPages=\{clientTotalPages\}\s+onPage=\{setClientPage\}\s*\/>/g,
      '<Paginator page={page} totalPages={totalPages} onPage={setPage} />'
    );
    
    // Second: Put it back for ONLY the injected footers. The injected footer has "records</span>" preceding it.
    content = content.replace(
      /records<\/span>(\s*)<Paginator\s+page=\{page\}\s+totalPages=\{totalPages\}\s+onPage=\{setPage\}\s*\/>/g,
      'records</span>$1<Paginator page={clientPage} totalPages={clientTotalPages} onPage={setClientPage} />'
    );
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed:', file);
  } catch(e) {}
}
