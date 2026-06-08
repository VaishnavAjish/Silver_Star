/* eslint-disable no-console */
// One-shot cleanup of diagnostic artifacts written during sidebar RCA.
const fs = require('fs');

const D = '\\\\192.168.1.53\\D_Drive\\';
const edits = [
  // Rohitxx/v1.31 — revert trial fix back to original
  [D + 'Rohitxx\\silverstar-grow - v1.31\\silverstar-grow\\client\\src\\core\\context\\AuthContext.jsx',
    [
      [`// Role comparison is case-insensitive — server may emit 'SUPER_ADMIN' or 'super_admin'.\n  const hasRole = (...roles) => {\n    if (!user?.role) return false;\n    const r = String(user.role).toLowerCase();\n    return roles.some(role => String(role).toLowerCase() === r);\n  };\n  const canEdit = () => hasRole('super_admin', 'admin', 'operator');`,
       `const hasRole = (...roles) => user && roles.includes(user.role);\n  const canEdit = () => hasRole('admin', 'operator');`],
      [`const role = String(user.role || '').toLowerCase();\n    if (role === 'admin' || role === 'super_admin') return true;`,
       `if (user.role === 'admin') return true;`],
    ]],
  [D + 'Rohitxx\\silverstar-grow - v1.31\\silverstar-grow\\client\\src\\core\\layout\\Layout.jsx',
    [
      [`.filter(item => {\n              if (!item.adminOnly) return true;\n              const r = String(user?.role || '').toLowerCase();\n              return r === 'admin' || r === 'super_admin';\n            })`,
       `.filter(item => !item.adminOnly || user?.role === 'admin')`],
    ]],
  // Sentinels
  [D + 'Rohitxx\\silverstar-grow - v1.22\\silverstar-grow\\client\\src\\core\\context\\AuthContext.jsx',
    [[` // SENTINEL_RX22`, ``]]],
  [D + 'silverstar-grow - v1.27\\silverstar-grow\\client\\src\\core\\context\\AuthContext.jsx',
    [[` // SENTINEL_V127`, ``]]],
  [D + 'silverstar-grow - v1.26\\silverstar-grow\\client\\src\\core\\context\\AuthContext.jsx',
    [[` // SENTINEL_V126`, ``]]],
  [D + 'silverstar-grow - v1.21\\silverstar-grow - v1.22\\silverstar-grow - v1.22\\silverstar-grow\\client\\src\\core\\context\\AuthContext.jsx',
    [[` // SENTINEL_NEST`, ``]]],
];

const configs = [
  D + 'Rohitxx\\silverstar-grow - v1.31\\silverstar-grow\\client\\vite.config.js',
  D + 'Rohitxx\\silverstar-grow - v1.22\\silverstar-grow\\client\\vite.config.js',
  D + 'silverstar-grow - v1.27\\silverstar-grow\\client\\vite.config.js',
  D + 'silverstar-grow - v1.26\\silverstar-grow\\client\\vite.config.js',
  D + 'silverstar-grow - v1.21\\silverstar-grow - v1.22\\silverstar-grow - v1.22\\silverstar-grow\\client\\vite.config.js',
];

for (const [file, reps] of edits) {
  let s = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of reps) {
    if (s.includes(from)) { s = s.split(from).join(to); changed = true; }
  }
  fs.writeFileSync(file, s);
  console.log(`${changed ? 'reverted' : 'no-match'} : ${file}`);
}

for (const file of configs) {
  let s = fs.readFileSync(file, 'utf8');
  const cleaned = s.replace(/\n\/\/ touch \d+\n/g, '');
  fs.writeFileSync(file, cleaned);
  console.log(`${cleaned !== s ? 'config-clean' : 'config-ok '} : ${file}`);
}
