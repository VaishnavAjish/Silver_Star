/**
 * vendorService — Vendor (Accounts Payable sub-ledger) API wrapper.
 * Usage: const svc = vendorService(useApi());
 */
export const vendorService = (api) => ({
  list:        (params = {}) => api.get(`/api/vendors?${new URLSearchParams(params)}`),
  getById:     (id)          => api.get(`/api/vendors/${id}`),
  create:      (data)        => api.post('/api/vendors', data),
  update:      (id, data)    => api.put(`/api/vendors/${id}`, data),

  // AP sub-ledger: outstanding bills, advance balance, payment history
  getLedger:   (id, params = {}) => api.get(`/api/vendors/${id}/ledger?${new URLSearchParams(params)}`),
  getOpenBills: (id)              => api.get(`/api/vendors/${id}/open-bills`),
  getAdvances:  (id)              => api.get(`/api/vendors/${id}/advances`),
});
