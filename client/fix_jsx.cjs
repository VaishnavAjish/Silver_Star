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

  // Find the exact block we injected. It starts right after </table>
  // We want to replace </table> \n { with <tfoot><tr><td colSpan="100" style={{padding: 0}}> \n {
  // And then replace the closing )} with )} \n </td></tr></tfoot> \n </table>
  
  // The block always contains `<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)'`
  if (content.includes('borderTop: \'1px solid var(--g200)\'')) {
    
    // First, let's locate the </table> that immediately precedes the block
    // Since we appended it directly after </table>, we can search for </table> followed by optional whitespace then {
    
    const blockRegex = /<\/table>\s*\{([a-zA-Z0-9_]+)\.length > 0 && \([\s\S]*?<Paginator[\s\S]*?<\/div>\s*\)\}/g;
    
    content = content.replace(blockRegex, (match, varName) => {
      // match contains `</table> \n {VAR.length > 0 && ( ... </div> )}`
      // We strip the `</table>` from the beginning, and wrap the rest in tfoot
      const strippedMatch = match.replace(/<\/table>\s*/, '');
      return `<tfoot><tr><td colSpan="100" style={{ padding: 0 }}>\n${strippedMatch}\n</td></tr></tfoot>\n</table>`;
    });
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed JSX syntax in:', file);
    modifiedCount++;
  }
}

console.log('Total fixed:', modifiedCount);
