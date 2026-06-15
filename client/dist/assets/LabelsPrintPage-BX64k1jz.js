import{j as t,a0 as x,a as _,e as j,r as l}from"./index-cEBOwSKe.js";import{B as y}from"./Barcode-Dq4oCGpR.js";function v({lot:e}){const s=e.purchase_date?new Date(e.purchase_date).toLocaleDateString("en-IN"):new Date().toLocaleDateString("en-IN"),o=e.weight!=null?`${parseFloat(e.weight).toFixed(4)} ct`:"",a=[e.serial_no,e.location].filter(Boolean).join(" · ");return t.jsxs("div",{className:"lot-label",children:[t.jsx("div",{className:"lot-label__company",children:"Silverstar Grow"}),t.jsx("div",{className:"lot-label__barcode",children:t.jsx(y,{value:e.lot_number,width:1.2,height:32,displayValue:!1})}),t.jsx("div",{className:"lot-label__id",children:e.lot_number}),e.lot_name&&t.jsx("div",{className:"lot-label__name",children:e.lot_name}),t.jsxs("div",{className:"lot-label__meta",children:[a&&t.jsx("span",{children:a}),o&&t.jsx("span",{children:o}),t.jsx("span",{children:s})]})]})}function w(e){return{id:e.id,lot_number:e.asset_code,lot_name:e.asset_name,weight:null,purchase_date:e.purchase_date,serial_no:e.serial_no,location:e.location_name}}function S(){const[e]=x(),{token:s}=_(),o=j(),[a,b]=l.useState([]),[r,c]=l.useState(!0),[p,d]=l.useState("");return l.useEffect(()=>{const n=(e.get("ids")||"").split(",").map(f=>f.trim()).filter(Boolean),m=e.get("type")||"inventory",u=m==="fixed_asset"?"/api/fixed-assets":"/api/inventory";if(!n.length){c(!1),d("No IDs provided");return}(async()=>{try{const h=(await Promise.all(n.map(i=>fetch(`${u}/${i}`,{headers:{Authorization:`Bearer ${s}`}}).then(g=>g.ok?g.json():null)))).filter(Boolean).map(i=>m==="fixed_asset"?w(i):i);h.length?b(h):d("No items found for the given IDs")}catch{d("Failed to load data")}finally{c(!1)}})()},[e,s]),l.useEffect(()=>{if(!r&&a.length>0){const n=setTimeout(()=>window.print(),1e3);return()=>clearTimeout(n)}},[r,a.length]),r?t.jsx("div",{style:{padding:40,textAlign:"center"},children:"Loading labels…"}):p?t.jsx("div",{style:{padding:40,color:"#c00"},children:p}):t.jsxs(t.Fragment,{children:[t.jsxs("div",{className:"lp-toolbar no-print",children:[t.jsx("button",{onClick:()=>o(-1),children:"← Back"}),t.jsx("button",{onClick:()=>window.print(),children:"🖨 Print"}),t.jsxs("span",{className:"lp-info",children:[a.length," label",a.length!==1?"s":""]})]}),t.jsx("div",{className:"lp-labels",children:a.map(n=>t.jsx(v,{lot:n},n.id))}),t.jsx("style",{children:`
        @page { margin: 5mm; }

        /* LotLabel styles — rendered once here, not inside each label instance */
        .lot-label {
          width: 50mm; height: 30mm; padding: 2mm 3mm; box-sizing: border-box;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border: 0.3mm solid #ccc;
          font-family: 'DM Sans', Arial, sans-serif;
          overflow: hidden; page-break-inside: avoid;
        }
        .lot-label__company {
          font-size: 6pt; font-weight: 700; letter-spacing: 0.05em;
          color: #095C47; margin-bottom: 1mm;
        }
        .lot-label__barcode svg { display: block; }
        .lot-label__id { font-size: 7pt; font-weight: 700; margin-top: 1mm; }
        .lot-label__name {
          font-size: 6pt; color: #555;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 44mm;
        }
        .lot-label__meta {
          display: flex; gap: 3mm; font-size: 5.5pt; color: #666; margin-top: 1mm;
        }

        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .lp-labels { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 0; gap: 0; }
          .lot-label { border: none; }
        }
        .lp-toolbar {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 20px; background: #f5f5f5;
          border-bottom: 1px solid #ddd; position: sticky; top: 0;
        }
        .lp-toolbar button {
          padding: 6px 16px; border-radius: 6px;
          border: 1px solid #bbb; background: #fff; cursor: pointer; font-size: 13px;
        }
        .lp-toolbar button:hover { background: #eee; }
        .lp-info { font-size: 12px; color: #888; }
        .lp-labels { display: flex; flex-wrap: wrap; gap: 4mm; padding: 6mm; }
      `})]})}export{S as default};
