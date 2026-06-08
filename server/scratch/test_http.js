const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const securityConfig = require('../config/security');

// Generate valid admin token
const token = jwt.sign(
  { id: 1, role: 'admin', username: 'admin' }, 
  securityConfig.jwt.accessSecret, 
  { expiresIn: '1h' }
);

const http = require('http');

const req = http.request('http://localhost:5000/api/vendors?page=1&pageSize=500', {
  headers: { 'Authorization': 'Bearer ' + token }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("STATUS:", res.statusCode);
    console.log("BODY:", data);
  });
});

req.on('error', err => console.error("ERR:", err.message));
req.end();
