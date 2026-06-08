const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign({ id: 1, role: 'super_admin', organizationId: 1, sessionId: 'foo' }, process.env.JWT_SECRET, { expiresIn: '1h' });

const data = JSON.stringify({ name: 'Test Vendor API', category: 'general' });

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/vendors',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    require('fs').writeFileSync('out_api.txt', `STATUS: ${res.statusCode}\nBODY: ${body}`);
    process.exit(0);
  });
});

req.on('error', e => {
  require('fs').writeFileSync('out_api.txt', `ERROR: ${e.message}`);
  process.exit(1);
});

req.write(data);
req.end();
