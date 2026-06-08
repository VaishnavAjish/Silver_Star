const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    if (fs.statSync(file).isDirectory()) results = results.concat(walk(file));
    else if (file.endsWith('.jsx')) results.push(file);
  });
  return results;
}

const files = walk(path.join(__dirname, 'client', 'src'));
let matchCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // Change constants to 1000
  content = content.replace(/(const (?:[A-Z_]*PAGE_SIZE|LIMIT|PER_PAGE)\s*=\s*)\d+(;)/g, "$11000$2");

  // Fix hardcoded limit: 200 -> limit: 1000
  content = content.replace(/limit:\s*200,\s*offset:\s*\(\(pg\s*\|\|\s*1\)\s*-\s*1\)\s*\*\s*200/g, "page: pg || 1, pageSize: 1000");

  // Fix URL replacements for custom names
  content = content.replace(/\{\s*limit:\s*(?:EXP_PAGE_SIZE|PN_PAGE_SIZE|PER_PAGE),\s*offset:\s*\(\((.*?)\s*\|\|\s*1\)\s*-\s*1\)\s*\*\s*(?:EXP_PAGE_SIZE|PN_PAGE_SIZE|PER_PAGE)\s*\}/g, "{ page: $1 || 1, pageSize: $2 || 1000 }"); // wait, $2 is wrong
  content = content.replace(/\{\s*limit:\s*([A-Z_]+),\s*offset:\s*\((.*?)\s*-\s*1\)\s*\*\s*\1\s*\}/g, "{ page: $2, pageSize: $1 }");
  content = content.replace(/\{\s*limit:\s*([A-Z_]+),\s*offset:\s*(.*?)\s*\*\s*\1\s*\}/g, "{ page: ($2) + 1, pageSize: $1 }");

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${path.basename(file)}`);
    matchCount++;
  }
});
console.log(`Total files updated: ${matchCount}`);
