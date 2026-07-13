const ExcelJS = require('exceljs');
const fs = require('fs');

async function main() {
  try {
    const filePath = "C:\\Users\\AXEL\\Desktop\\Machines_and_Vendors.xlsx";
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      process.exit(1);
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const out = {};
    wb.worksheets.forEach(ws => {
      const data = [];
      const headers = ws.getRow(1).values;
      ws.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const rowData = {};
          headers.forEach((h, i) => { if (h) rowData[h.toLowerCase()] = row.values[i]; });
          data.push(rowData);
        }
      });
      out[ws.name] = { totalRows: data.length, sample: data.slice(0, 3) };
    });
    console.log(JSON.stringify(out, null, 2));
  } catch(e) {
    console.error("Error reading file:", e.message);
  }
}
main();
