import{c as p}from"./index-cEBOwSKe.js";/**
 * @license lucide-react v0.344.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=p("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);function h(c,e,l){const r="\uFEFF",n=t=>{const o=t==null?"":String(t);return o.includes(",")||o.includes('"')||o.includes(`
`)?`"${o.replace(/"/g,'""')}"`:o},a=[e,...l].map(t=>t.map(n).join(",")).join(`
`),d=new Blob([r+a],{type:"text/csv;charset=utf-8;"}),s=URL.createObjectURL(d),i=Object.assign(document.createElement("a"),{href:s,download:c});document.body.appendChild(i),i.click(),document.body.removeChild(i),URL.revokeObjectURL(s)}function f(c,e,l,r){const n=r.map(t=>`<tr>${t.map(o=>`<td style="border:1px solid #ccc;padding:5px 8px;font-size:11pt">${o??""}</td>`).join("")}</tr>`).join(""),a=`
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
        <thead><tr>${l.map(t=>`<th>${t}</th>`).join("")}</tr></thead>
        <tbody>${n}</tbody>
      </table>
    </body></html>`,d=new Blob(["\uFEFF",a],{type:"application/msword"}),s=URL.createObjectURL(d),i=Object.assign(document.createElement("a"),{href:s,download:`${c}.doc`});document.body.appendChild(i),i.click(),document.body.removeChild(i),URL.revokeObjectURL(s)}function u(c,e,l,r){const n=window.open("","_blank","width=900,height=700");n&&(n.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${c}</title>
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
  <h2>${c}</h2>
  ${e?`<p class="sub">${e}</p>`:""}
  <table>
    <thead><tr>${l.map(a=>`<th>${a}</th>`).join("")}</tr></thead>
    <tbody>${r.map(a=>`<tr>${a.map(d=>`<td>${d??""}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  </body></html>`),n.document.close())}export{m as D,f as a,h as e,u as p};
