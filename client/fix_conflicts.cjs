const fs = require('fs');
const path = require('path');

const dir = '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src';

const filesToFix = [
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\InventoryPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotIssueListPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotMovementsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\PurchaseNotesPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\VendorsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\sales\\pages\\CustomersPage.jsx'
];

for (const file of filesToFix) {
  let content = fs.readFileSync(file, 'utf8');

  // Replace hook destructuring
  content = content.replace(
    /const \{ page, setPage, paginatedItems, totalPages, pageSize \} = usePagination/g,
    'const { page: clientPage, setPage: setClientPage, paginatedItems, totalPages: clientTotalPages, pageSize: clientPageSize } = usePagination'
  );

  // Replace footer usage specifically inside our injected block
  // Our block starts with `            {` and has `Showing {`
  content = content.replace(
    /\(page - 1\) \* pageSize \+ 1/g,
    '(clientPage - 1) * clientPageSize + 1'
  );
  content = content.replace(
    /Math\.min\(page \* pageSize/g,
    'Math.min(clientPage * clientPageSize'
  );
  content = content.replace(
    /<Paginator page=\{page\} totalPages=\{totalPages\} onPage=\{setPage\} \/>/g,
    '<Paginator page={clientPage} totalPages={clientTotalPages} onPage={setClientPage} />'
  );

  fs.writeFileSync(file, content, 'utf8');
  console.log('Fixed conflict in:', file);
}
