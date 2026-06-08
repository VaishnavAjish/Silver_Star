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
  
  if (content.includes('usePagination(') && !content.includes('import { usePagination }')) {
    const importPagination = `import { usePagination } from '${path.relative(path.dirname(file), path.join(dir, 'shared', 'hooks', 'usePagination')).replace(/\\\\/g, '/')}';\n`;
    const importPaginator = `import Paginator from '${path.relative(path.dirname(file), path.join(dir, 'shared', 'components', 'Paginator')).replace(/\\\\/g, '/')}';\n`;
    
    const firstImportEnd = content.indexOf('\n', content.indexOf('import '));
    if (firstImportEnd !== -1) {
      content = content.slice(0, firstImportEnd + 1) + importPagination + importPaginator + content.slice(firstImportEnd + 1);
      fs.writeFileSync(file, content, 'utf8');
      console.log('Fixed imports:', file);
      modifiedCount++;
    }
  }
}

console.log('Total fixed:', modifiedCount);
