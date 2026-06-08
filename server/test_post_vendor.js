const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign({ id: 1, role: 'super_admin', organizationId: 1, sessionId: 'foo' }, process.env.JWT_SECRET, { expiresIn: '1h' });

async function run() {
  try {
    const res = await fetch('http://localhost:5001/api/vendors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Test Vendor API',
        category: 'general'
      })
    });
    
    const text = await res.text();
    console.log(`STATUS: ${res.status}`);
    console.log(`BODY: ${text}`);
  } catch(e) {
    console.error(e);
  }
}
run();
