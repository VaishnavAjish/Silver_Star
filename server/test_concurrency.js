const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5173,
  path: '/api/departments?limit=100',
  method: 'GET',
  // Simulate an authenticated request if Vite Proxy doesn't require token for simple forward?
  // Wait, Vite proxy passes it, but the backend requires a token.
  // Actually, we don't have a token. We can just test the backend directly on port 5001.
};

async function fetchRoute() {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, port: 5001 }, (res) => {
      resolve(res.statusCode);
      res.resume();
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  const promises = [];
  for (let i = 0; i < 40; i++) {
    promises.push(fetchRoute().catch(e => e.message));
  }
  const results = await Promise.all(promises);
  console.log('Results:', results.reduce((acc, code) => {
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {}));
}

test();
