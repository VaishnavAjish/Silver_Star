import React from 'react';

function ChallanCopy({ transfer, copyLabel, generatedAt }) {
  const lots = transfer?.lots || [];
  const totalQty = lots.reduce((sum, l) => sum + parseFloat(l.transfer_qty || 0), 0);
  const totalWeight = lots.reduce((sum, l) => sum + (parseFloat(l.weight || 0) || 0), 0);
  const mainUnit = lots[0]?.unit || 'PCS';

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const formatDimensions = (l) => {
    if (l.dim_length && l.dim_depth && l.dim_height) {
      const len = parseFloat(l.dim_length).toFixed(2);
      const dep = parseFloat(l.dim_depth).toFixed(2);
      const hei = parseFloat(l.dim_height).toFixed(2);
      return `${len} × ${dep} × ${hei} mm`;
    }
    return '—';
  };

  return (
    <div className="challan-copy-block" style={{
      border: '1.5px solid #000',
      borderRadius: 4,
      padding: '12px 14px',
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#000',
      backgroundColor: '#fff',
      boxSizing: 'border-box',
    }}>
      {/* Header Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottom: '1.5px solid #000',
        paddingBottom: 8,
        marginBottom: 8
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
            SILVERSTAR GROW UTILITY
          </div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: 2, textTransform: 'uppercase' }}>
            INTERNAL MATERIAL TRANSFER CHALLAN
          </div>
        </div>
        <div style={{
          textAlign: 'right',
          border: '1px solid #000',
          padding: '4px 8px',
          fontWeight: 'bold',
          fontSize: '10px',
          background: '#f8f8f8'
        }}>
          {copyLabel}
        </div>
      </div>

      {/* Meta Grid */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        marginBottom: 10,
        fontSize: '10.5px'
      }}>
        <tbody>
          <tr>
            <td style={{ padding: '3px 0', width: '15%', fontWeight: 'bold' }}>Transfer ID:</td>
            <td style={{ padding: '3px 0', width: '35%', fontFamily: 'monospace', fontWeight: 'bold' }}>{transfer.transfer_id || '—'}</td>
            <td style={{ padding: '3px 0', width: '15%', fontWeight: 'bold' }}>Transfer Date:</td>
            <td style={{ padding: '3px 0', width: '35%' }}>{formatDate(transfer.created_at)}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>From Dept:</td>
            <td style={{ padding: '3px 0' }}>{transfer.source_location_name || '—'}</td>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>To Dept:</td>
            <td style={{ padding: '3px 0' }}>{transfer.destination_location_name || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>Status:</td>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>{transfer.status || 'APPROVED'}</td>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>Prepared By:</td>
            <td style={{ padding: '3px 0' }}>{transfer.created_by_name || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>Approved By:</td>
            <td style={{ padding: '3px 0' }}>{transfer.approved_by_name || '—'}</td>
            <td style={{ padding: '3px 0', fontWeight: 'bold' }}>Approval Date:</td>
            <td style={{ padding: '3px 0' }}>{formatDate(transfer.approved_at)}</td>
          </tr>
        </tbody>
      </table>

      {/* Material Table */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        marginBottom: 8,
        border: '1px solid #000'
      }}>
        <thead>
          <tr style={{ background: '#f0f0f0', borderBottom: '1px solid #000', fontSize: '10px' }}>
            <th style={{ borderRight: '1px solid #000', padding: '4px', width: '5%', textAlign: 'center' }}>Sr.</th>
            <th style={{ borderRight: '1px solid #000', padding: '4px', width: '22%', textAlign: 'left' }}>Material Code / Lot Name</th>
            <th style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'left' }}>Description of Goods</th>
            <th style={{ borderRight: '1px solid #000', padding: '4px', width: '10%', textAlign: 'right' }}>Qty</th>
            <th style={{ borderRight: '1px solid #000', padding: '4px', width: '8%', textAlign: 'center' }}>UOM</th>
            <th style={{ borderRight: '1px solid #000', padding: '4px', width: '12%', textAlign: 'right' }}>Weight (CT)</th>
            <th style={{ padding: '4px', width: '23%', textAlign: 'center' }}>Dimensions (mm)</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l, i) => (
            <tr key={i} style={{ borderBottom: i === lots.length - 1 ? 'none' : '1px solid #ddd', fontSize: '10px' }}>
              <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'center' }}>{i + 1}</td>
              <td style={{ borderRight: '1px solid #000', padding: '4px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                {l.lot_code || l.lot_number || '—'}
              </td>
              <td style={{ borderRight: '1px solid #000', padding: '4px' }}>
                {l.item_description || l.item_name || l.item_category || '—'}
              </td>
              <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>
                {parseFloat(l.transfer_qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
              </td>
              <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'center' }}>{l.unit || mainUnit}</td>
              <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'right' }}>
                {l.weight ? parseFloat(l.weight).toFixed(4) : (l.unit === 'CT' ? parseFloat(l.transfer_qty || 0).toFixed(4) : '—')}
              </td>
              <td style={{ padding: '4px', textAlign: 'center', fontFamily: 'monospace' }}>{formatDimensions(l)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1.5px solid #000', background: '#fafafa', fontWeight: 'bold', fontSize: '10px' }}>
            <td colSpan={3} style={{ borderRight: '1px solid #000', padding: '4px 6px', textAlign: 'left' }}>
              Total Lots: {lots.length}
            </td>
            <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'right' }}>
              {totalQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
            </td>
            <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'center' }}>{mainUnit}</td>
            <td style={{ borderRight: '1px solid #000', padding: '4px', textAlign: 'right' }}>
              {totalWeight > 0 ? totalWeight.toFixed(4) : '—'}
            </td>
            <td style={{ padding: '4px' }}></td>
          </tr>
        </tfoot>
      </table>

      {/* Signature Section */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        marginTop: 10,
        paddingTop: 6,
        borderTop: '1px solid #000'
      }}>
        <div style={{ border: '1px solid #ccc', padding: '6px 8px', borderRadius: 3 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase', fontSize: '10px' }}>SENDER</div>
          <div>Name: _______________________________</div>
          <div style={{ marginTop: 4 }}>Signature: ___________________________</div>
          <div style={{ marginTop: 4 }}>Date / Time: _________________________</div>
        </div>
        <div style={{ border: '1px solid #ccc', padding: '6px 8px', borderRadius: 3 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase', fontSize: '10px' }}>RECEIVER</div>
          <div>Name: _______________________________</div>
          <div style={{ marginTop: 4 }}>Signature: ___________________________</div>
          <div style={{ marginTop: 4 }}>Date / Time: _________________________</div>
        </div>
      </div>

      {/* Footer Notice */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        paddingTop: 4,
        borderTop: '1px dashed #666',
        fontSize: '9px',
        color: '#333'
      }}>
        <div style={{ fontStyle: 'italic', fontWeight: 'bold' }}>
          Internal department transfer only. No commercial value.
        </div>
        <div>
          Gen: {generatedAt} | ID: {transfer.transfer_id} | Page 1 of 1
        </div>
      </div>
    </div>
  );
}

export default function StockTransferChallanPrint({ transfer }) {
  if (!transfer) return null;
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div id="printable-challan-wrapper">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-challan-wrapper, #printable-challan-wrapper * {
            visibility: visible !important;
          }
          #printable-challan-wrapper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          @page {
            size: A4 portrait;
            margin: 6mm 8mm;
          }
          .challan-copy-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }

        @media screen {
          #printable-challan-wrapper {
            display: none;
          }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* TOP COPY */}
        <ChallanCopy
          transfer={transfer}
          copyLabel="ORIGINAL — SENDER COPY"
          generatedAt={generatedAt}
        />

        {/* CUT / FOLD DIVIDER */}
        <div style={{
          textAlign: 'center',
          borderTop: '1.5px dashed #000',
          paddingTop: '2px',
          margin: '2px 0',
          fontSize: '9px',
          fontWeight: 'bold',
          letterSpacing: '1px',
          color: '#444'
        }}>
          ✂ ------------------------------------- Cut / Fold Here ------------------------------------- ✂
        </div>

        {/* BOTTOM COPY */}
        <ChallanCopy
          transfer={transfer}
          copyLabel="DUPLICATE — RECEIVER COPY"
          generatedAt={generatedAt}
        />
      </div>
    </div>
  );
}
