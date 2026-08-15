const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

process.env.NODE_ENV = 'test';

const dir = path.join(__dirname, 'tests');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js') && !f.includes('.live.'))
  .sort();

console.log(`[CI Test Suite] Running ${files.length} non-live server test suites...`);

let passed = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const fileNum = `[${i + 1}/${files.length}]`;
  const filePath = path.join(dir, f);
  try {
    execFileSync(process.execPath, ['--test', '--test-force-exit', filePath], { stdio: 'pipe', env: process.env });
    console.log(`${fileNum} ${f} ... PASS`);
    passed++;
  } catch (err) {
    console.error(`${fileNum} ${f} ... FAIL!`);
    const output = err.stdout ? err.stdout.toString() : err.stderr ? err.stderr.toString() : err.message;
    console.error(output);
    process.exit(1);
  }
}

console.log(`[CI Test Suite] Success! All ${passed}/${files.length} test suites PASSED.`);
