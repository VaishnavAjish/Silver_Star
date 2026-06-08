/**
 * reportService — Financial Reports API wrapper.
 * All report endpoints accept date-range and filter params.
 * Usage: const svc = reportService(useApi());
 */
export const reportService = (api) => ({
  // Core financial statements
  getLedger:               (params = {}) => api.get(`/api/reports/ledger?${new URLSearchParams(params)}`),
  getTrialBalance:         (params = {}) => api.get(`/api/reports/trial-balance?${new URLSearchParams(params)}`),
  getPnL:                  (params = {}) => api.get(`/api/reports/pnl?${new URLSearchParams(params)}`),
  getBalanceSheet:         (params = {}) => api.get(`/api/reports/balance-sheet?${new URLSearchParams(params)}`),
  getCostingReport:        (params = {}) => api.get(`/api/reports/costing?${new URLSearchParams(params)}`),

  // Subsidiary ledger reports
  getAccountsReceivable:   (params = {}) => api.get(`/api/reports/accounts-receivable?${new URLSearchParams(params)}`),
  getAccountsPayable:      (params = {}) => api.get(`/api/reports/accounts-payable?${new URLSearchParams(params)}`),

  // Asset reports
  getFixedAssetRegister:   (params = {}) => api.get(`/api/reports/fixed-asset-register?${new URLSearchParams(params)}`),
  getDepreciationSchedule: (params = {}) => api.get(`/api/reports/depreciation-schedule?${new URLSearchParams(params)}`),

  // Operational reports
  getBankReconciliation:   (params = {}) => api.get(`/api/reports/bank-reconciliation?${new URLSearchParams(params)}`),
  getCostCenter:           (params = {}) => api.get(`/api/reports/cost-center?${new URLSearchParams(params)}`),
  getCostCenterTxn:        (params = {}) => api.get(`/api/reports/cost-center-transactions?${new URLSearchParams(params)}`),
  getTransactions:         (params = {}) => api.get(`/api/reports/transactions?${new URLSearchParams(params)}`),
});
