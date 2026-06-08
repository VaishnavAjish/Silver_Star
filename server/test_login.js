const http = require('http');
const req = http.request('http://192.168.1.53:5000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(res.statusCode, data);
  });
});
req.on('error', console.error);
req.write(JSON.stringify({ username: 'admin', password: 'password' }));
req.end();
