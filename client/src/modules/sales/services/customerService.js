/**
 * customerService — Customer (Accounts Receivable sub-ledger) API wrapper.
 * Usage: const svc = customerService(useApi());
 */
export const customerService = (api) => ({
  list:          (params = {}) => api.get(`/api/customers?${new URLSearchParams(params)}`),
  getById:       (id)          => api.get(`/api/customers/${id}`),
  create:        (data)        => api.post('/api/customers', data),
  update:        (id, data)    => api.put(`/api/customers/${id}`, data),

  // AR sub-ledger: outstanding invoices, advance balance, receipt history
  getLedger:     (id, params = {}) => api.get(`/api/customers/${id}/ledger?${new URLSearchParams(params)}`),
  getOpenInvoices: (id)             => api.get(`/api/customers/${id}/open-invoices`),
  getAdvances:     (id)             => api.get(`/api/customers/${id}/advances`),
});
