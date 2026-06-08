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
  if (file.includes('DataGrid.jsx') || file.includes('AssetTemplateMasterPage.jsx')) continue;
  
  let content = fs.readFileSync(file, 'utf8');
  
  // Only target files that have a <tbody> and map over something to render rows
  if (!content.includes('<tbody') || !content.includes('.map(')) continue;
  if (content.includes('usePagination(')) continue; // Already processed
  
  // Try to find what variable is mapped in tbody
  // Usually it looks like: {filtered.map(  or  {!loading && users.map(
  const tbodyMatch = content.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) continue;
  
  const mapMatch = tbodyMatch[1].match(/\{(?:\!loading\s*&&\s*)?([a-zA-Z0-9_]+)\.map\(/);
  if (!mapMatch) continue;
  
  const varName = mapMatch[1]; // e.g., 'filtered', 'users', 'vendors'
  
  // Find where this variable is defined, typically:
  // const filtered = ...
  // Or it's from state: const [users, setUsers] = useState...
  // We just need to insert the usePagination hook right before the `return (` statement of the component.
  
  // Find the last return statement that looks like `return (` which is usually the component's return
  const returnIndex = content.lastIndexOf('\n  return (');
  if (returnIndex === -1) continue;
  
  // Build the hook string
  // We'll reset pagination when `search` changes if `search` exists in the file, otherwise empty array.
  const hasSearch = content.includes('search') ? '[search]' : '[]';
  const hookStr = `\n  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(${varName}, ${hasSearch});\n`;
  
  // Insert hook before return
  content = content.slice(0, returnIndex) + hookStr + content.slice(returnIndex);
  
  // Replace the map target inside tbody
  const mapRegex = new RegExp(`(\\{|&&\\s*)${varName}\\.map\\(`, 'g');
  // Only replace inside the return block to be safe
  const afterReturn = content.slice(returnIndex);
  const updatedAfterReturn = afterReturn.replace(mapRegex, `$1paginatedItems.map(`);
  content = content.slice(0, returnIndex) + updatedAfterReturn;
  
  // Add imports
  if (!content.includes('usePagination')) {
    const importPagination = `import { usePagination } from '${path.relative(path.dirname(file), path.join(dir, 'shared', 'hooks', 'usePagination')).replace(/\\\\/g, '/')}';\n`;
    const importPaginator = `import Paginator from '${path.relative(path.dirname(file), path.join(dir, 'shared', 'components', 'Paginator')).replace(/\\\\/g, '/')}';\n`;
    
    // Insert after first import
    const firstImportEnd = content.indexOf('\n', content.indexOf('import '));
    content = content.slice(0, firstImportEnd + 1) + importPagination + importPaginator + content.slice(firstImportEnd + 1);
  }
  
  // Inject the paginator UI at the end of the table wrapper or near the footer
  // It's tricky to find the exact footer. Let's just find `</table>` and insert it after.
  const tableEndMatch = content.match(/<\/table>(\s*<\/\w+>)?/);
  if (tableEndMatch) {
    const paginatorUI = `
            {${varName}.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {${varName}.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, ${varName}.length)} of {${varName}.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
`;
    content = content.replace(tableEndMatch[0], tableEndMatch[0] + paginatorUI);
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('Paginated:', file);
  modifiedCount++;
}

console.log('Total files modified:', modifiedCount);
