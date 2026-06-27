import React from 'react';
import { DollarSign, Percent, Download, FileText, Printer, Settings } from 'lucide-react';
import './ReportToolbar.css'; // Add minimal css if needed

export default function ReportToolbar({ 
  currency, onCurrencyChange,
  format, onFormatChange,
  decimals, onDecimalsChange,
  onExportPDF, onExportExcel, onPrint
}) {
  return (
    <div className="report-toolbar">
      <div className="toolbar-section">
        <label className="toolbar-label">Currency</label>
        <div className="btn-group">
          <button className={`btn-toggle ${currency === 'INR' ? 'active' : ''}`} onClick={() => onCurrencyChange('INR')}>INR</button>
          <button className={`btn-toggle ${currency === 'USD' ? 'active' : ''}`} onClick={() => onCurrencyChange('USD')}>USD</button>
          <button className={`btn-toggle ${currency === 'BOTH' ? 'active' : ''}`} onClick={() => onCurrencyChange('BOTH')}>BOTH</button>
        </div>
      </div>

      <div className="toolbar-section">
        <label className="toolbar-label">Format</label>
        <div className="btn-group">
          <button className={`btn-toggle ${format === 'INDIAN' ? 'active' : ''}`} onClick={() => onFormatChange('INDIAN')}>Indian</button>
          <button className={`btn-toggle ${format === 'INTERNATIONAL' ? 'active' : ''}`} onClick={() => onFormatChange('INTERNATIONAL')}>Intl</button>
        </div>
      </div>

      <div className="toolbar-section">
        <label className="toolbar-label">Decimals</label>
        <div className="btn-group">
          <button className={`btn-toggle ${decimals === 0 ? 'active' : ''}`} onClick={() => onDecimalsChange(0)}>0</button>
          <button className={`btn-toggle ${decimals === 2 ? 'active' : ''}`} onClick={() => onDecimalsChange(2)}>2</button>
          <button className={`btn-toggle ${decimals === 4 ? 'active' : ''}`} onClick={() => onDecimalsChange(4)}>4</button>
        </div>
      </div>

      <div className="toolbar-actions">
        {onExportPDF && (
          <button className="btn-action" onClick={onExportPDF} title="Export PDF">
            <FileText size={16} />
          </button>
        )}
        {onExportExcel && (
          <button className="btn-action" onClick={onExportExcel} title="Export Excel">
            <Download size={16} />
          </button>
        )}
        {onPrint && (
          <button className="btn-action" onClick={onPrint} title="Print">
            <Printer size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
