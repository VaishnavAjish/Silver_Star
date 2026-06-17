const WebSocket = require('ws');

const ws = new WebSocket('wss://ss.itemlinkshare.com/ws?token=test');

ws.on('open', function open() {
  console.log('WS CONNECTED SUCCESSFULLY!');
  process.exit(0);
});

ws.on('error', function error(err) {
  console.error('WS ERROR:', err.message);
  process.exit(1);
});

ws.on('close', function close(code, reason) {
  console.log('WS DISCONNECTED:', code, reason.toString());
  process.exit(1);
});

ws.on('unexpected-response', (req, res) => {
  console.error('WS UNEXPECTED RESPONSE:', res.statusCode);
  process.exit(1);
});
