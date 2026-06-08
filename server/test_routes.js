require('dotenv').config();
const jwt = require('jsonwebtoken');
const securityConfig = require('./config/security');

const token = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', fullName: 'Admin' },
  securityConfig.jwt.accessSecret,
  { expiresIn: '1h' }
);

require('http').get({
  hostname: '127.0.0.1',
  port: 5001,
  path: '/api/lot-process-issues',
  headers: { 'Authorization': 'Bearer ' + token }
}, (res) => {
  console.log('Status lot-process-issues:', res.statusCode);
  res.on('data', d => console.log('Response:', d.toString().slice(0, 100)));
});

require('http').get({
  hostname: '127.0.0.1',
  port: 5001,
  path: '/api/inventory/filters/active',
  headers: { 'Authorization': 'Bearer ' + token }
}, (res) => {
  console.log('Status inventory/filters/active:', res.statusCode);
});
