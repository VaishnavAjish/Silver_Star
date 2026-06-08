const http = require('http');

const data = JSON.stringify({
  username: 'admin',
  password: 'password'
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 5001,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  },
  res => {
    let rawData = '';
    res.on('data', chunk => { rawData += chunk; });
    res.on('end', () => {
      console.log('Status Code:', res.statusCode);
      console.log('Response Body:', rawData);
    });
  }
);

req.on('error', e => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
