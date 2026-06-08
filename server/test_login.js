require('http').request({
  hostname: '127.0.0.1',
  port: 5001,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  console.log('Status login:', res.statusCode);
  res.on('data', d => console.log('Response:', d.toString()));
}).end(JSON.stringify({ username: 'admin', password: 'password' }));
