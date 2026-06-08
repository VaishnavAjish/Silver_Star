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
let offsetMatches = 0;
let pageSizeMatches = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  const pgRegex = /const offset = \((.*?) - 1\) \* (.*?);/g;
  let match;
  while ((match = pgRegex.exec(content)) !== null) {
    console.log(`Matched offset in ${path.basename(file)}: var=${match[1]}, size=${match[2]}`);
    offsetMatches++;
  }

  const psRegex = /(const (?:PAGE_SIZE|LIMIT)\s*=\s*)\d+(;)/g;
  if (psRegex.test(content)) {
    pageSizeMatches++;
  }
});

console.log(`\nFound ${offsetMatches} offset calculations and ${pageSizeMatches} PAGE_SIZE/LIMIT constants.`);
