const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'routes');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace: catch (err) { res.status(500).json({ error: err.message }); }
  // with: catch (err) { require('fs').writeFileSync('global_500_err.txt', '['+file+'] ' + err.message + '\\n' + err.stack); res.status(500).json({ error: err.message }); }
  if (content.includes('catch (err) { res.status(500).json({ error: err.message }); }')) {
    content = content.replace(/catch \(err\) \{ res\.status\(500\)\.json\(\{ error: err\.message \}\); \}/g, 
      `catch (err) { require('fs').writeFileSync('global_500_err.txt', '[${file}] ' + req.path + '\\n' + err.message + '\\n' + err.stack); res.status(500).json({ error: err.message }); }`
    );
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
console.log("Patched all routes");
