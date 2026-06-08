const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const routes = JSON.parse(fs.readFileSync('routes.json'));
  
  // Find all /api/... strings in client/src
  const out = execSync('git grep -hoE "/api/[a-zA-Z0-9_/-]+" ../client/src', { encoding: 'utf8' }).split('\\n');
  const paths = new Set();
  
  out.forEach(l => {
    const trimmed = l.trim();
    if (trimmed) paths.add(trimmed);
  });

  const broken = [];
  for (const p of paths) {
    if (p.includes('${') || p === '/api/') continue;
    
    // Check if path exists in dumped routes. 
    // Express routes might have params like /api/inventory/:id
    // We just do a prefix match to be safe, e.g., if p is /api/inventory, we check if any route starts with /api/inventory
    const exists = routes.some(r => r.path === p || r.path.startsWith(p + '/') || r.path.startsWith(p + '/:'));
    if (!exists) {
      broken.push(p);
    }
  }

  console.log('Broken frontend API links (not found on backend):');
  console.log(broken);
} catch (e) {
  console.error(e);
}
