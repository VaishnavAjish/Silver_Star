require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');

const token = jwt.sign(
  { id: 1, email: 'admin@silverstargrow.com', role_id: 1, department_id: null },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
);
fs.writeFileSync('token.txt', token);
console.log('Token generated');
