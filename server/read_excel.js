const xlsx = require('xlsx');
const fs = require('fs');

try {
  const filePath = "C:\\Users\\AXEL\\Desktop\\Machines_and_Vendors.xlsx";
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }
  const wb = xlsx.readFile(filePath);
  const out = {};
  wb.SheetNames.forEach(name => {
    const data = xlsx.utils.sheet_to_json(wb.Sheets[name]);
    out[name] = { totalRows: data.length, sample: data.slice(0, 3) };
  });
  console.log(JSON.stringify(out, null, 2));
} catch(e) {
  console.error("Error reading file:", e.message);
}
