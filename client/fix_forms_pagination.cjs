const fs = require('fs');

const filesToFix = [
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\LotReturnPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\ExpensesPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\purchase\\pages\\PurchaseNotesPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\rough-diamonds\\pages\\GrowthOutputPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\rough-diamonds\\pages\\RoughGrowthPages.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\MixLotsPage.jsx',
  '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src\\modules\\inventory\\pages\\SplitLotPage.jsx'
];

for (const file of filesToFix) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    
    // Arrays used in the paginatedItems substitution
    let arrayName = 'lines';
    if (file.includes('MixLotsPage')) arrayName = 'filtered';
    if (file.includes('SplitLotPage')) arrayName = 'children';

    // 1. Remove usePagination hook injection
    content = content.replace(
      new RegExp(`\\s*const \\{.*\\} = usePagination\\(${arrayName}, \\[\\]\\);`),
      ''
    );

    // 2. Revert map substitution
    content = content.replace(/paginatedItems\.map/g, `${arrayName}.map`);

    // 3. Remove injected footer (Paginator inside tfoot)
    // The injected footer always starts with <tfoot><tr><td colSpan="100"> and ends with </td></tr></tfoot>
    content = content.replace(
      /<tfoot><tr><td colSpan="100">[\s\S]*?<\/td><\/tr><\/tfoot>/g,
      ''
    );

    // 4. Fix select values in PurchaseNotesPage
    if (file.includes('PurchaseNotesPage')) {
      content = content.replace(/<select value=\{line\.item_id\}/g, '<select value={line.item_id || \'\'}');
      content = content.replace(/<select value=\{line\.unit\}/g, '<select value={line.unit || \'\'}');
    }

    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed forms pagination in:', file);
  } catch (e) {
    console.error('Error in', file, e);
  }
}
