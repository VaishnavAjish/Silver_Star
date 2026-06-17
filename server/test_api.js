const http = require('http');
const jwt = require('jsonwebtoken');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Starting API tests...');
  try {
    const token = jwt.sign(
      { id: 1, username: 'Superadmin', role: 'admin', fullName: 'Superadmin' },
      'change-this-to-a-random-64-char-secret-string',
      { expiresIn: '24h', issuer: 'silverstar-grow-auth' }
    );
    console.log('Generated token');

    const urls = [
      '/api/departments?limit=100',
      '/api/customers/summary',
      '/api/manufacturing/kpi',
      '/api/inventory?status=all'
    ];

    for (const url of urls) {
      console.log(`Fetching ${url}...`);
      const res = await request({
        hostname: 'localhost', port: 5173, path: url, method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log(`[${url}] Status: ${res.status}`);
      console.log(`Response: ${res.body.slice(0, 500)}`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}`, err.stack);
  }
}
run();
