const https = require('https');

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTAsInVzZXJuYW1lIjoiUm9oaXQiLCJyb2xlIjoiYWRtaW4iLCJmdWxsTmFtZSI6IlJvaGl0IEFnaGVyYSIsImlhdCI6MTc4MzY2MzIwMywiZXhwIjoxNzgzNjkyMDAzLCJpc3MiOiJzaWx2ZXJzdGFyLWdyb3ctYXV0aCJ9.LQiYUaUlnLYPsrPW3-b0rKUBY3I4s3gNhywhNfZSfwQ";

const payload = JSON.stringify({
  date: '2026-07-10',
  description: 'Test manual JE',
  sourceType: 'manual',
  sourceId: null,
  lines: [
    { accountId: 1, debit: 100, credit: 0, narration: null, costCenterId: null, entityType: null, entityId: null, referenceNo: null },
    { accountId: 2, debit: 0, credit: 100, narration: null, costCenterId: null, entityType: null, entityId: null, referenceNo: null }
  ],
  autoPost: true
});

const options = {
  hostname: 'sflgd.in',
  port: 443,
  path: '/api/journal-entries',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
};

const req = https.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
  res.on('end', () => {
    console.log('No more data in response.');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(payload);
req.end();
