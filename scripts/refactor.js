const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.jsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk(path.join(__dirname, 'client', 'src'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // 1. Replace PAGE_SIZE constants with 1000
  content = content.replace(/(const (?:[A-Z_]*PAGE_SIZE|LIMIT)\s*=\s*)\d+(;)/g, "$11000$2");

  // 2. Fix the manual limit: 10000, offset: 0 fetching to use page and pageSize
  // e.g. const params = new URLSearchParams({ limit: 10000, offset: 0 });
  // If it's a hardcoded limit like 10000, it means it's loading all records.
  // We need to change it to use PAGE_SIZE. But wait, if it loads all records, the load() function doesn't take 'page'.
  // This is too complex for a regex to safely refactor across arbitrary custom logic.
  
  // 3. Instead of parsing AST, let's just use regex to replace all `limit: \d+` or `limit: PAGE_SIZE`
  // with `page: page, pageSize: 1000`? No, because `page` might not be in scope in the load function.
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${path.basename(file)}`);
  }
});
