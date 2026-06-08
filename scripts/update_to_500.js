const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    if (fs.statSync(file).isDirectory()) results = results.concat(walk(file));
    else if (file.endsWith('.jsx') || file.endsWith('.js')) results.push(file);
  });
  return results;
}

const files = walk(path.join(__dirname, 'client', 'src')).concat([path.join(__dirname, 'server', 'app.js')]);
let matchCount = 0;

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // Change constants in frontend
  content = content.replace(/(const (?:[A-Z_]*PAGE_SIZE|LIMIT|PER_PAGE)\s*=\s*)1000(;)/g, "$1500$2");
  
  // Hardcoded 1000 in VirtualDataGrid
  content = content.replace(/pageSize\s*=\s*1000,/g, "pageSize = 500,");
  content = content.replace(/pageSize: 1000/g, "pageSize: 500");
  
  // Math for limits in InventoryPage and Lot Issue
  content = content.replace(/pageSize:\s*1000/g, "pageSize: 500");
  content = content.replace(/\b1000\b/g, (match, offset, full) => {
    // Only replace 1000 if it seems related to pagination (e.g. math.min(page * 1000))
    // Let's be careful.
    return match; // We'll handle this manually for inventory page since it has hardcoded math
  });
  
  // Specifically for InventoryPage.jsx and LotIssueListPage.jsx / LotMovementsPage.jsx math
  content = content.replace(/\(page - 1\) \* 1000 \+ 1/g, "(page - 1) * 500 + 1");
  content = content.replace(/page \* 1000/g, "page * 500");
  content = content.replace(/total \/ 1000/g, "total / 500");
  content = content.replace(/const ps = 1000;/g, "const ps = 500;");

  // server/app.js middleware
  if (file.endsWith('app.js')) {
    content = content.replace(/const limit = ps > 0 \? ps : 1000;/g, "const limit = ps > 0 ? ps : 500;");
  }

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${path.basename(file)}`);
    matchCount++;
  }
});
console.log(`Total files updated: ${matchCount}`);
