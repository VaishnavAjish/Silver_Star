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
    
    // Remove injected footer (Paginator inside tfoot)
    // The injected footer starts with <tfoot><tr><td colSpan="100" style={{ padding: 0 }}> and ends with </td></tr></tfoot>
    content = content.replace(
      /<tfoot><tr><td colSpan="100"[^>]*>[\s\S]*?<\/td><\/tr><\/tfoot>/g,
      ''
    );

    fs.writeFileSync(file, content, 'utf8');
    console.log('Removed paginator footer from:', file);
  } catch (e) {
    console.error('Error in', file, e);
  }
}
