'use strict';

/**
 * GST Engine
 * A unified service for calculating GST across the entire ERP (Purchase Notes, Vendor Bills, etc.).
 * Designed to be extensible for future CGST/SGST/IGST splits without requiring consumer refactoring.
 */

function calculateLineGST(amount, taxPct) {
  const taxable = parseFloat(amount) || 0;
  const pct = parseFloat(taxPct) || 0;
  const taxAmount = taxable * (pct / 100);
  
  return {
    taxable,
    taxAmount,
    lineTotal: taxable + taxAmount
  };
}

function calculateDocumentGST(lines) {
  let totalTaxable = 0;
  let totalTax = 0;
  
  const processedLines = lines.map(line => {
    // For purchase notes, amount is often qty * rate. For bills it's just amount.
    // If the consumer passes 'amount' directly, we use it. Otherwise compute qty * rate.
    let amt = 0;
    if (line.amount !== undefined && line.amount !== null && line.amount !== '') {
      amt = parseFloat(line.amount) || 0;
    } else {
      amt = (parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0);
    }
    
    const { taxable, taxAmount, lineTotal } = calculateLineGST(amt, line.tax_pct);
    
    totalTaxable += taxable;
    totalTax += taxAmount;
    
    return {
      ...line,
      computed_amount: taxable,
      computed_tax_amount: taxAmount,
      computed_total: lineTotal
    };
  });
  
  return {
    lines: processedLines,
    totalTaxable,
    totalTax,
    grandTotal: totalTaxable + totalTax
  };
}

module.exports = {
  calculateLineGST,
  calculateDocumentGST
};
