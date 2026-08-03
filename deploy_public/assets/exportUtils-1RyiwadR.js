function p(d,e,r){const l="\uFEFF",n=o=>{let t=o==null?"":String(o);return typeof o=="number"?t:(/^[=+\-@\t\r]/.test(t)&&(t=`'${t}`),t.includes(",")||t.includes('"')||t.includes(`
`)?`"${t.replace(/"/g,'""')}"`:t)},i=[e,...r].map(o=>o.map(n).join(",")).join(`
`),c=new Blob([l+i],{type:"text/csv;charset=utf-8;"}),s=URL.createObjectURL(c),a=Object.assign(document.createElement("a"),{href:s,download:d});document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(s)}function b(d,e,r,l){const n=l.map(o=>`<tr>${o.map(t=>`<td style="border:1px solid #ccc;padding:5px 8px;font-size:11pt">${t??""}</td>`).join("")}</tr>`).join(""),i=`
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${e}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11pt; }
      h2   { font-size: 14pt; margin-bottom: 4pt; }
      table{ border-collapse: collapse; width: 100%; }
      th   { background:#EDF6F2; border:1px solid #ccc; padding:5px 8px; font-size:11pt; text-align:left; }
    </style></head>
    <body>
      <h2>${e}</h2>
      <table>
        <thead><tr>${r.map(o=>`<th>${o}</th>`).join("")}</tr></thead>
        <tbody>${n}</tbody>
      </table>
    </body></html>`,c=new Blob(["\uFEFF",i],{type:"application/msword"}),s=URL.createObjectURL(c),a=Object.assign(document.createElement("a"),{href:s,download:`${d}.doc`});document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(s)}function m(d,e,r,l){const n=window.open("","_blank","width=900,height=700");n&&(n.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${d}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #212121; margin: 16px; }
      h2 { font-size: 15px; margin: 0 0 2px; }
      .sub { font-size: 11px; color: #757575; margin: 0 0 12px; }
      table { border-collapse: collapse; width: 100%; }
      th { background: #EDF6F2; border: 1px solid #ccc; padding: 5px 8px; font-weight: 600; text-align: left; font-size: 11px; }
      td { border: 1px solid #eee; padding: 4px 8px; vertical-align: top; }
      tr:nth-child(even) td { background: #F8FCFA; }
      .actions { margin-bottom: 10px; }
      button { padding: 6px 14px; background: #0D7C5F; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 8px; }
      @media print { .actions { display: none; } }
    </style>
  </head><body>
  <div class="actions">
    <button onclick="window.print()">Print / Save PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <h2>${d}</h2>
  ${e?`<p class="sub">${e}</p>`:""}
  <table>
    <thead><tr>${r.map(i=>`<th>${i}</th>`).join("")}</tr></thead>
    <tbody>${l.map(i=>`<tr>${i.map(c=>`<td>${c??""}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  </body></html>`),n.document.close())}export{b as a,p as e,m as p};
