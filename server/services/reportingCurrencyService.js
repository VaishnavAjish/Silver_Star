const pool = require('../db/pool');
const { logger } = require('../middleware/logger');

class ReportingCurrencyService {
  constructor() {
    this.cachedPreferences = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 30000; // 30 seconds
  }

  async getPreferences() {
    const now = Date.now();
    if (this.cachedPreferences && (now - this.cacheTime < this.CACHE_TTL)) {
      return this.cachedPreferences;
    }

    const defaults = {
      base_currency: 'INR',
      reporting_currency: 'USD',
      reporting_exchange_rate: 85.000000,
      display_currency: 'INR',
      number_format: 'INDIAN',
      decimal_precision: 2,
      negative_number_style: 'ACCOUNTING'
    };

    try {
      const res = await pool.query(`SELECT * FROM company_reporting_preferences WHERE id = true`);
      if (res.rows.length > 0) {
        this.cachedPreferences = res.rows[0];
        this.cacheTime = now;
      } else {
        // Table exists but empty — use defaults
        this.cachedPreferences = defaults;
      }
    } catch (err) {
      // 42P01 = table does not exist (migration not yet applied) — use defaults gracefully
      if (err.code === '42P01') {
        logger.warn('company_reporting_preferences table not found — using defaults. Run migration phase43_reporting_preferences.sql');
        this.cachedPreferences = defaults;
      } else {
        logger.error({ err }, 'Failed to fetch reporting preferences');
        throw err;
      }
    }

    return this.cachedPreferences;
  }

  formatAmount(amount, formatLocale, currencyCode, decimals, negativeStyle) {
    if (amount === null || amount === undefined || isNaN(amount)) return amount;
    
    let isNegative = amount < 0;
    let absAmount = Math.abs(amount);

    let formatter = new Intl.NumberFormat(formatLocale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    let formatted = formatter.format(absAmount);
    
    if (isNegative) {
      if (negativeStyle === 'ACCOUNTING') {
        return `(${formatted})`;
      } else {
        return `-${formatted}`;
      }
    }
    return formatted;
  }

  async formatReport(reportData, type, userOverrides = {}) {
    const prefs = await this.getPreferences();
    
    const displayCurrency = userOverrides.currency || prefs.display_currency;
    const numberFormat = userOverrides.format || prefs.number_format;
    const decimals = userOverrides.decimals !== undefined ? parseInt(userOverrides.decimals) : prefs.decimal_precision;
    const negativeStyle = prefs.negative_number_style;
    const exchangeRate = parseFloat(prefs.reporting_exchange_rate);

    const formatLocale = numberFormat === 'INTERNATIONAL' ? 'en-US' : 'en-IN';

    // Recursive function to attach formatted fields to any node containing 'amount', 'balance', 'debit', 'credit' etc.
    const traverseAndFormat = (node) => {
      if (Array.isArray(node)) {
        return node.map(n => traverseAndFormat(n));
      } else if (node !== null && typeof node === 'object') {
        const newNode = { ...node };
        const fieldsToFormat = ['amount', 'balance', 'net_balance', 'group_net', 'group_total', 'dr_val', 'cr_val', 'debit', 'credit', 'total_debit', 'total_credit', 'grandDebit', 'grandCredit', 'closing_balance', 'net_profit', 'total_assets', 'total_liabilities', 'total_equity', 'totalAssets', 'totalLiabilities', 'totalEquity', 'retainedEarnings', 'totalRevenue', 'totalCogs', 'grossProfit', 'totalOpex', 'netProfit', 'openingStock', 'purchases', 'closingStock'];

        for (const field of fieldsToFormat) {
          if (newNode[field] !== undefined && newNode[field] !== null) {
            const inrAmount = parseFloat(newNode[field]) || 0;
            const reportingAmount = inrAmount / exchangeRate;

            newNode[`${field}_inr`] = inrAmount;
            newNode[`${field}_reporting`] = reportingAmount;

            newNode[`${field}_formatted_inr`] = this.formatAmount(inrAmount, formatLocale, prefs.base_currency, decimals, negativeStyle);
            newNode[`${field}_formatted_reporting`] = this.formatAmount(reportingAmount, formatLocale, prefs.reporting_currency, decimals, negativeStyle);

            if (displayCurrency === 'INR') {
              newNode[`${field}_display`] = newNode[`${field}_formatted_inr`];
            } else if (displayCurrency === 'USD' || displayCurrency === prefs.reporting_currency) {
              newNode[`${field}_display`] = newNode[`${field}_formatted_reporting`];
            } else if (displayCurrency === 'BOTH') {
              newNode[`${field}_display`] = `${newNode[`${field}_formatted_inr`]} \n(${newNode[`${field}_formatted_reporting`]})`;
            } else {
              newNode[`${field}_display`] = newNode[`${field}_formatted_inr`];
            }
          }
        }

        // Traverse children recursively for tree structures like Trial Balance
        for (const key of Object.keys(newNode)) {
          if (Array.isArray(newNode[key]) || (newNode[key] !== null && typeof newNode[key] === 'object' && !(newNode[key] instanceof Date))) {
            newNode[key] = traverseAndFormat(newNode[key]);
          }
        }
        
        return newNode;
      }
      return node;
    };

    return traverseAndFormat(reportData);
  }
}

module.exports = new ReportingCurrencyService();
