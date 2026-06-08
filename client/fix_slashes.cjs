const fs = require('fs');
const path = require('path');

const dir = '\\\\vaishnav-02\\d\\silverstar-grow v1.4\\silverstar-grow\\client\\src';

function findFiles(dirPath, filesList = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findFiles(fullPath, filesList);
    } else if (fullPath.endsWith('.jsx')) {
      filesList.push(fullPath);
    }
  }
  return filesList;
}

const allFiles = findFiles(dir);
let modifiedCount = 0;

for (const file of allFiles) {
  let content = fs.readFileSync(file, 'utf8');
  // Look for any import with a backslash
  if (content.match(/import .* from '.*\\.*'/)) {
    // Only replace backslashes inside import paths
    content = content.replace(/from '([^']+)'/g, (match, p1) => {
      return `from '${p1.replace(/\\/g, '/')}'`;
    });
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed slashes in:', file);
    modifiedCount++;
  }
}

console.log('Total fixed:', modifiedCount);
