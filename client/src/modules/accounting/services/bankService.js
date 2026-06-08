/**
 * bankService — Bank Deposits & Reconciliation API wrapper.
 * Usage: const svc = bankService(useApi());
 */
export const bankService = (api) => ({
  // Bank Deposits
  listDeposits:  (params = {}) => api.get(`/api/bank-deposits?${new URLSearchParams(params)}`),
  getDeposit:    (id)          => api.get(`/api/bank-deposits/${id}`),
  createDeposit: (data)        => api.post('/api/bank-deposits', data),
  updateDeposit: (id, data)    => api.put(`/api/bank-deposits/${id}`, data),
  deleteDeposit: (id)          => api.del(`/api/bank-deposits/${id}`),

  // Bank Reconciliation
  getReconStatement: (params = {}) => api.get(`/api/reports/bank-reconciliation?${new URLSearchParams(params)}`),
  reconcileEntry:    (data)         => api.post('/api/bank-recon/reconcile', data),
  unreconcileEntry:  (id)           => api.post(`/api/bank-recon/${id}/unreconcile`),
});
