const http = require('http');

function test(path) {
  return new Promise((resolve) => {
    http.get('http://localhost:5001' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', err => resolve({ error: err.message }));
  });
}

async function run() {
  const reqs = [
    '/api/departments?limit=100',
    '/api/inventory?category=rough&status=IN%20STOCK&limit=500',
    '/api/customers/summary',
    '/api/customers?limit=300',
    '/api/manufacturing/kpi',
    '/api/manufacturing/lookup/operators'
  ];
  
  for (const path of reqs) {
    const r = await test(path);
    console.log(`\n--- ${path} ---`);
    console.log(`Status: ${r.status}`);
    console.log(r.data ? r.data.substring(0, 500) : r.error);
  }
}
run();
