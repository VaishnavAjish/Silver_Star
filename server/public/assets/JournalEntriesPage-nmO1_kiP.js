import{u as V,a as q,e as H,r as o,z as x,j as a,W,T as Z,h as Q,P as X}from"./index-BeVfNrjb.js";import{u as Y}from"./usePersistedFilters-DQvLKaDh.js";import{D as ee}from"./DataGrid-DtSTaZhV.js";import{C as te}from"./ColumnSettings-DSa6Y6VU.js";import{E as ae}from"./ExportMenu-C16aoWoL.js";import{F as re}from"./FilterBar-B1rbLEe6.js";import{P as oe}from"./pen-line-CvOsK1oW.js";import{P as se}from"./printer-ByFDd1fa.js";import{R as ne}from"./refresh-cw-e0nqcq8H.js";import"./index-BJdpEz4M.js";import"./DatePicker-mI4eFsaL.js";import"./Paginator-DuxxH9pV.js";import"./grip-vertical-BamInaj9.js";import"./exportUtils-1RyiwadR.js";import"./download-D9dF1MU7.js";import"./file-spreadsheet-B0JLz41I.js";const v=500,ie=[{value:"",label:"All Status"},{value:"draft",label:"Draft"},{value:"posted",label:"Posted"},{value:"reversed",label:"Reversed"}];function $e(){var F;const l=V(),{canEdit:g}=q(),b=H(),[_,T]=o.useState([]),[L,C]=o.useState(!0),[S,k]=o.useState(!1),[d,N]=Y("je_filters",{}),[s,A]=o.useState(null),E=o.useMemo(()=>[...new Set(_.map(t=>t.source_type).filter(Boolean))].sort(),[_]),J=o.useMemo(()=>[{key:"search",label:"Search",type:"text"},{key:"source",label:"Source",type:"select",options:[{value:"",label:"All Sources"},...E.map(t=>({value:t,label:t}))]},{key:"status",label:"Status",type:"select",options:ie},{key:"date_from",label:"From Date",type:"date"},{key:"date_to",label:"To Date",type:"date"}],[E]),p=o.useCallback(async(t,e)=>{C(!0);try{const r=new URLSearchParams({page:t,pageSize:v});e.search&&r.set("search",e.search),e.source&&r.set("source_type",e.source),e.status&&r.set("status",e.status),e.date_from&&r.set("from_date",e.date_from),e.date_to&&r.set("to_date",e.date_to);const c=await l.get(`/api/journal-entries?${r}`);T(c.data||[]),I(c.totalCount??c.total??0)}catch{x.error("Failed to load journal entries")}finally{C(!1)}},[l]),[m,I]=o.useState(0),[i,w]=o.useState(1),$=o.useRef(null);o.useEffect(()=>{clearTimeout($.current);const t=d.search?300:0;return $.current=setTimeout(()=>p(i,d),t),()=>clearTimeout($.current)},[i,d,p]);const O=o.useCallback(async()=>{k(!0);try{await p(i,d)}finally{k(!1)}},[p,i,d]),D=o.useCallback(async t=>{const e=window.prompt(`Reason to reverse ${t.je_number}?`);if(e)try{await l.post(`/api/journal-entries/${t.id}/reverse`,{reason:e}),x.success("Journal entry reversed"),p(i,d)}catch(r){x.error(r.message)}},[l,p,i,d]),R=o.useCallback(async t=>{if(window.confirm(`Are you sure you want to delete ${t.je_number}?`))try{await l.del(`/api/journal-entries/${t.id}`),x.success("Journal entry deleted"),p(i,d)}catch(e){x.error(e.message)}},[l,p,i,d]),z=o.useCallback(async t=>{try{const e=await l.get(`/api/journal-entries/${t.id}`),r=e.lines||[],c=r.reduce((n,j)=>n+parseFloat(j.debit||0),0),y=r.reduce((n,j)=>n+parseFloat(j.credit||0),0),u=n=>`₹${Number(n).toLocaleString("en-IN",{minimumFractionDigits:2})}`,h=e.date?new Date(e.date).toLocaleDateString("en-IN"):"",G=r.map((n,j)=>`
        <tr>
          <td style="text-align:center;padding:4px 8px;border:1px solid #ddd">${j+1}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${n.account_name||""} (${n.account_code||""})</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${n.narration||""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(n.debit)?u(n.debit):""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(n.credit)?u(n.credit):""}</td>
        </tr>
      `).join(""),f=window.open("","_blank");f.document.write(`
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
              <div style="font-size:11px;color:#666">${h}</div>
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
              ${G}
              <tr class="total-row">
                <td colspan="3" style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333">Total</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${u(c)}</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${u(y)}</td>
              </tr>
            </tbody>
          </table>
          ${e.reversal_je?`<div style="margin-top:12px;padding:8px 12px;background:#fef3cd;border:1px solid #ffc107;border-radius:4px;font-size:11px"><strong>Reversed by:</strong> ${e.reversal_je.je_number} on ${new Date(e.reversal_je.date).toLocaleDateString("en-IN")}</div>`:""}
          ${e.original_je?`<div style="margin-top:12px;padding:8px 12px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:11px"><strong>Original Entry:</strong> ${e.original_je.je_number} on ${new Date(e.original_je.date).toLocaleDateString("en-IN")}</div>`:""}
          <div class="footer">This is a computer-generated voucher. No signature required.</div>
        </body>
        </html>
      `),f.document.close(),f.onload=()=>{f.focus(),setTimeout(()=>f.print(),200)}}catch{x.error("Failed to load journal entry for printing")}},[l]),P=t=>`Rs. ${Number(t).toLocaleString("en-IN",{minimumFractionDigits:2})}`,K=o.useMemo(()=>[{key:"je_number",label:"JE Number",width:100,render:t=>a.jsx("span",{className:"cell-link",children:t})},{key:"date",label:"Date",width:100,render:t=>t?new Date(t).toLocaleDateString("en-IN"):""},{key:"description",label:"Description"},{key:"source_type",label:"Source",width:90,render:t=>t||"-"},{key:"total_debit",label:"Debit",width:110,numeric:!0,render:P},{key:"total_credit",label:"Credit",width:110,numeric:!0,render:P},{key:"status",label:"Status",width:80,render:t=>a.jsx("span",{className:`badge b-${t}`,children:t})},{key:"_actions",label:"Action",width:160,render:(t,e)=>a.jsxs("div",{style:{display:"flex",gap:4},onClick:r=>r.stopPropagation(),children:[a.jsx("button",{className:"icon-btn",title:"View",onClick:()=>b(`/journal-entries/${e.id}`),children:a.jsx(W,{size:13})}),g()&&a.jsx("button",{className:"icon-btn",title:"Edit",onClick:()=>b(`/journal-entries/${e.id}?mode=edit`),children:a.jsx(oe,{size:13})}),g()&&a.jsx("button",{className:"icon-btn",title:"Delete",onClick:()=>R(e),children:a.jsx(Z,{size:13})}),g()&&e.status==="posted"&&a.jsx("button",{className:"icon-btn",title:"Reverse",onClick:()=>D(e),children:a.jsx(Q,{size:13})}),a.jsx("button",{className:"icon-btn",title:"Print",onClick:()=>z(e),children:a.jsx(se,{size:13})})]})}],[g,b,D,R,z]),M=m===0?0:(i-1)*v+1,U=Math.min(i*v,m),B=Math.max(1,Math.ceil(m/v));return a.jsxs("div",{className:"grid-page",children:[a.jsxs(re,{filters:d,onChange:(t,e)=>{w(1),N(r=>({...r,[t]:e}))},onReset:()=>{w(1),N({})},fields:J,children:[a.jsx("span",{className:"grid-count",children:m===0?"No records":`${M}–${U} of ${m.toLocaleString()}`}),s&&a.jsx(te,{columns:s.columns,visibleColumns:s.visibleColumns,toggleColumn:s.toggleColumn,resetLayout:s.resetLayout,mandatoryKeys:["_actions"]}),a.jsx(ae,{title:"Journal Entries",buttonStyle:{height:32.73},headers:(((F=s==null?void 0:s.getExportCols)==null?void 0:F.call(s))||[]).map(t=>t.label),fetchRows:async()=>((await l.get("/api/journal-entries?limit=100000")).data||[]).map(e=>{var c;return(((c=s==null?void 0:s.getExportCols)==null?void 0:c.call(s))||[]).map(y=>{const u=e[y.key];if(y.render){const h=y.render(u,e);return typeof h=="string"||typeof h=="number"?h:u??""}return u??""})})}),g()&&a.jsxs("button",{className:"btn btn-sm btn-primary",onClick:()=>b("/journal-entries/new"),style:{height:32.73},children:[a.jsx(X,{size:13})," New Journal Entry"]}),a.jsx("button",{className:"icon-btn",onClick:O,disabled:S,style:S?{animation:"spin 0.7s linear infinite"}:void 0,children:a.jsx(ne,{size:14})})]}),a.jsx(ee,{embedded:!0,hideSearch:!0,hideExport:!0,hideRefresh:!0,hideRecordCount:!0,hideColumnSettings:!0,hideExportLabel:!0,exportTitle:"Journal Entries",storageKey:"journal_entries_cols",mandatoryKeys:["_actions"],onColumnManagerReady:A,columns:K,data:_,loading:L,page:i,pageSize:v,totalPages:B,totalRecords:m,onPageChange:w,onRefresh:()=>p(i,d),onRowClick:t=>b(`/journal-entries/${t.id}`)})]})}export{$e as default};
