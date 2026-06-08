const jwt = require('jsonwebtoken');
require('dotenv').config();
console.log("Secret is", process.env.JWT_SECRET);
const token = jwt.sign({id: 1, role: 'admin', organizationId: 1, sessionId: 'foo'}, process.env.JWT_SECRET, {expiresIn: '1h'});
require('fs').writeFileSync('temp_token.txt', token);
console.log("WROTE TOKEN");
