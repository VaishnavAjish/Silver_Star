require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ id: 1, role: 'super_admin', full_name: 'Super Admin' }, process.env.JWT_SECRET || require('./config/security').jwt.accessSecret);

const endpoints = [
  '/api/dashboard/stats',
  '/api/inventory?limit=50',
  '/api/inventory/summary',
  '/api/lot-movements?limit=50',
  '/api/lot-process-issues?limit=50',
  '/api/lot-process-issues/lookup/machines',
  '/api/manufacturing/machine-processes?limit=50',
  '/api/manufacturing/machine-status',
  '/api/accounting/dashboard',
  '/api/accounting/transactions?limit=50',
  '/api/accounting/accounts',
  '/api/reports/inventory-valuation',
  '/api/reports/yield-analysis',
  '/api/fixed-assets?limit=50',
  '/api/settings/users',
  '/api/purchases/notes',
  '/api/purchases/suppliers',
  '/api/sales/invoices',
  '/api/sales/customers'
];

async function checkEndpoint(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 5000,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ path, status: res.statusCode, data: data.substring(0, 200) });
      });
    });

    req.on('error', (e) => {
      resolve({ path, status: 0, error: e.message });
    });

    req.end();
  });
}

async function run() {
  console.log('Checking endpoints...');
  for (const ep of endpoints) {
    const result = await checkEndpoint(ep);
    if (result.status >= 400) {
      console.log(`❌ ${ep} -> ${result.status}`);
      console.log(`   ${result.data || result.error}`);
    } else {
      console.log(`✅ ${ep} -> ${result.status}`);
    }
  }
}
run();
