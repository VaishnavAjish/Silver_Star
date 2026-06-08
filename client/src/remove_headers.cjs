const fs = require('fs');
const glob = require('glob'); // Not available? We can just use standard fs recursive

function findMatchingClosingTagIndex(str, startIndex) {
    let depth = 0;
    let i = startIndex;
    while (i < str.length) {
        if (str.substr(i, 4) === '<div') {
            depth++;
            i += 4;
        } else if (str.substr(i, 5) === '</div') {
            depth--;
            if (depth === 0) {
                return i + 5; // end of </div>
            }
            i += 5;
        } else {
            i++;
        }
    }
    return -1;
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    let index;

    while ((index = content.indexOf('<div className="page-header"')) !== -1) {
        // Find matching closing div
        let endTagStart = findMatchingClosingTagIndex(content, index);
        if (endTagStart !== -1) {
            let closingBracket = content.indexOf('>', endTagStart);
            if (closingBracket !== -1) {
                content = content.substring(0, index) + content.substring(closingBracket + 1);
                changed = true;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    if (changed) {
        // also remove any empty lines left over
        content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = dir + '/' + file;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.jsx')) {
            processFile(fullPath);
        }
    }
}

walkDir('z:/silverstar-grow/client/src/modules');
console.log('Done');
