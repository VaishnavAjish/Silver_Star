import{u as G,a as V,e as Z,r as s,z as v,j as a,Z as q,i as H,P as Q}from"./index-cEBOwSKe.js";import{u as W}from"./usePersistedFilters-DGMTAfKB.js";import{D as X}from"./DataGrid-BUenLnX0.js";import{C as Y,E as ee}from"./ColumnSettings-BmiklBgE.js";import{F as te}from"./FilterBar-CwPVD32w.js";import{P as ae}from"./pen-line-DQ6AipTM.js";import{P as oe}from"./printer-uDuj-PsY.js";import{R as re}from"./refresh-cw-DsvW5oLN.js";import"./index-DKym827E.js";import"./DatePicker-D3ekTMVP.js";import"./chevron-left-CWrWTL4M.js";import"./Paginator-B6aW_vym.js";import"./grip-vertical-wJLBKgIa.js";import"./exportUtils-exQcuC9q.js";import"./settings-DNa-E6o7.js";const f=500,se=[{value:"",label:"All Status"},{value:"draft",label:"Draft"},{value:"posted",label:"Posted"},{value:"reversed",label:"Reversed"}];function ve(){var P;const c=G(),{canEdit:j}=V(),x=Z(),[_,F]=s.useState([]),[L,S]=s.useState(!0),[C,k]=s.useState(!1),[d,N]=W("je_filters",{}),[r,T]=s.useState(null),E=s.useMemo(()=>[...new Set(_.map(t=>t.source_type).filter(Boolean))].sort(),[_]),A=s.useMemo(()=>[{key:"search",label:"Search",type:"text"},{key:"source",label:"Source",type:"select",options:[{value:"",label:"All Sources"},...E.map(t=>({value:t,label:t}))]},{key:"status",label:"Status",type:"select",options:se},{key:"date_from",label:"From Date",type:"date"},{key:"date_to",label:"To Date",type:"date"}],[E]),u=s.useCallback(async(t,e)=>{S(!0);try{const o=new URLSearchParams({page:t,pageSize:f});e.search&&o.set("search",e.search),e.source&&o.set("source_type",e.source),e.status&&o.set("status",e.status),e.date_from&&o.set("from_date",e.date_from),e.date_to&&o.set("to_date",e.date_to);const l=await c.get(`/api/journal-entries?${o}`);F(l.data||[]),I(l.totalCount??l.total??0)}catch{v.error("Failed to load journal entries")}finally{S(!1)}},[c]),[m,I]=s.useState(0),[i,w]=s.useState(1),$=s.useRef(null);s.useEffect(()=>{clearTimeout($.current);const t=d.search?300:0;return $.current=setTimeout(()=>u(i,d),t),()=>clearTimeout($.current)},[i,d,u]);const J=s.useCallback(async()=>{k(!0);try{await u(i,d)}finally{k(!1)}},[u,i,d]),R=s.useCallback(async t=>{const e=window.prompt(`Reason to reverse ${t.je_number}?`);if(e)try{await c.post(`/api/journal-entries/${t.id}/reverse`,{reason:e}),v.success("Journal entry reversed"),u(i,d)}catch(o){v.error(o.message)}},[c,u,i,d]),D=s.useCallback(async t=>{try{const e=await c.get(`/api/journal-entries/${t.id}`),o=e.lines||[],l=o.reduce((n,h)=>n+parseFloat(h.debit||0),0),g=o.reduce((n,h)=>n+parseFloat(h.credit||0),0),p=n=>`₹${Number(n).toLocaleString("en-IN",{minimumFractionDigits:2})}`,b=e.date?new Date(e.date).toLocaleDateString("en-IN"):"",B=o.map((n,h)=>`
        <tr>
          <td style="text-align:center;padding:4px 8px;border:1px solid #ddd">${h+1}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${n.account_name||""} (${n.account_code||""})</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${n.narration||""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(n.debit)?p(n.debit):""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(n.credit)?p(n.credit):""}</td>
        </tr>
      `).join(""),y=window.open("","_blank");y.document.write(`
        <html>
        <head>
          <title>Journal Entry - ${e.je_number}</title>
          <style>
            @page { margin: 10mm 15mm; }
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #222; margin: 0; padding: 20px; }
            h2 { margin: 0 0 4px; font-size: 18px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #333; }
            .meta { display: flex; gap: 24px; margin-bottom: 16px; font-size: 11px; color: #555; }
            .meta span { display: inline-flex; gap: 4px; }
            .meta strong { color: #222; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
            th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; text-align: left; }
            .total-row td { font-weight: 700; border-top: 2px solid #333; padding: 6px 8px; font-size: 12px; }
            .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
            .no-print { display: none; }
            @media print { body { padding: 0; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h2>Journal Voucher</h2>
              <div style="font-size:11px;color:#666">${e.je_number}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700">${e.source_type||"Manual Entry"}</div>
              <div style="font-size:11px;color:#666">${b}</div>
            </div>
          </div>
          <div class="meta">
            <span><strong>Reference:</strong> ${e.reference_no||"—"}</span>
            <span><strong>Status:</strong> ${e.status}</span>
            ${e.description?`<span><strong>Description:</strong> ${e.description}</span>`:""}
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:40px">#</th>
                <th>Account</th>
                <th>Narration</th>
                <th style="width:130px;text-align:right">Debit (₹)</th>
                <th style="width:130px;text-align:right">Credit (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${B}
              <tr class="total-row">
                <td colspan="3" style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333">Total</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${p(l)}</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${p(g)}</td>
              </tr>
            </tbody>
          </table>
          ${e.reversal_je?`<div style="margin-top:12px;padding:8px 12px;background:#fef3cd;border:1px solid #ffc107;border-radius:4px;font-size:11px"><strong>Reversed by:</strong> ${e.reversal_je.je_number} on ${new Date(e.reversal_je.date).toLocaleDateString("en-IN")}</div>`:""}
          ${e.original_je?`<div style="margin-top:12px;padding:8px 12px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:11px"><strong>Original Entry:</strong> ${e.original_je.je_number} on ${new Date(e.original_je.date).toLocaleDateString("en-IN")}</div>`:""}
          <div class="footer">This is a computer-generated voucher. No signature required.</div>
        </body>
        </html>
      `),y.document.close(),y.onload=()=>{y.focus(),setTimeout(()=>y.print(),200)}}catch{v.error("Failed to load journal entry for printing")}},[c]),z=t=>`Rs. ${Number(t).toLocaleString("en-IN",{minimumFractionDigits:2})}`,O=s.useMemo(()=>[{key:"je_number",label:"JE Number",width:100,render:t=>a.jsx("span",{className:"cell-link",children:t})},{key:"date",label:"Date",width:100,render:t=>t?new Date(t).toLocaleDateString("en-IN"):""},{key:"description",label:"Description"},{key:"source_type",label:"Source",width:90,render:t=>t||"-"},{key:"total_debit",label:"Debit",width:110,numeric:!0,render:z},{key:"total_credit",label:"Credit",width:110,numeric:!0,render:z},{key:"status",label:"Status",width:80,render:t=>a.jsx("span",{className:`badge b-${t}`,children:t})},{key:"_actions",label:"Action",width:160,render:(t,e)=>a.jsxs("div",{style:{display:"flex",gap:4},onClick:o=>o.stopPropagation(),children:[a.jsx("button",{className:"icon-btn",title:"View",onClick:()=>x(`/journal-entries/${e.id}`),children:a.jsx(q,{size:13})}),j()&&a.jsx("button",{className:"icon-btn",title:"Edit",onClick:()=>x(`/journal-entries/${e.id}?mode=edit`),children:a.jsx(ae,{size:13})}),j()&&e.status==="posted"&&a.jsx("button",{className:"icon-btn",title:"Reverse",onClick:()=>R(e),children:a.jsx(H,{size:13})}),a.jsx("button",{className:"icon-btn",title:"Print",onClick:()=>D(e),children:a.jsx(oe,{size:13})})]})}],[j,x,R,D]),K=m===0?0:(i-1)*f+1,M=Math.min(i*f,m),U=Math.max(1,Math.ceil(m/f));return a.jsxs("div",{className:"grid-page",children:[a.jsxs(te,{filters:d,onChange:(t,e)=>{w(1),N(o=>({...o,[t]:e}))},onReset:()=>{w(1),N({})},fields:A,children:[a.jsx("span",{className:"grid-count",children:m===0?"No records":`${K}–${M} of ${m.toLocaleString()}`}),r&&a.jsx(Y,{columns:r.columns,visibleColumns:r.visibleColumns,toggleColumn:r.toggleColumn,resetLayout:r.resetLayout,mandatoryKeys:["_actions"]}),a.jsx(ee,{title:"Journal Entries",buttonStyle:{height:32.73},headers:(((P=r==null?void 0:r.getExportCols)==null?void 0:P.call(r))||[]).map(t=>t.label),fetchRows:async()=>((await c.get("/api/journal-entries?limit=100000")).data||[]).map(e=>{var l;return(((l=r==null?void 0:r.getExportCols)==null?void 0:l.call(r))||[]).map(g=>{const p=e[g.key];if(g.render){const b=g.render(p,e);return typeof b=="string"||typeof b=="number"?b:p??""}return p??""})})}),j()&&a.jsxs("button",{className:"btn btn-sm btn-primary",onClick:()=>x("/journal-entries/new"),style:{height:32.73},children:[a.jsx(Q,{size:13})," New Journal Entry"]}),a.jsx("button",{className:"icon-btn",onClick:J,disabled:C,style:C?{animation:"spin 0.7s linear infinite"}:void 0,children:a.jsx(re,{size:14})})]}),a.jsx(X,{embedded:!0,hideSearch:!0,hideExport:!0,hideRefresh:!0,hideRecordCount:!0,hideColumnSettings:!0,hideExportLabel:!0,exportTitle:"Journal Entries",storageKey:"journal_entries_cols",mandatoryKeys:["_actions"],onColumnManagerReady:T,columns:O,data:_,loading:L,page:i,pageSize:f,totalPages:U,totalRecords:m,onPageChange:w,onRefresh:()=>u(i,d),onRowClick:t=>x(`/journal-entries/${t.id}`)})]})}export{ve as default};
