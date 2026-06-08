/**
 * paymentService — Payments & Receipts API wrapper.
 * Usage: const svc = paymentService(useApi());
 */
export const paymentService = (api) => ({
  // Payments (vendor outflows)
  listPayments:    (params = {}) => api.get(`/api/payments?${new URLSearchParams(params)}`),
  getPayment:      (id)          => api.get(`/api/payments/${id}`),
  createPayment:   (data)        => api.post('/api/payments', data),
  updatePayment:   (id, data)    => api.put(`/api/payments/${id}`, data),

  // Receipts (customer inflows)
  listReceipts:    (params = {}) => api.get(`/api/receipts?${new URLSearchParams(params)}`),
  getReceipt:      (id)          => api.get(`/api/receipts/${id}`),
  createReceipt:   (data)        => api.post('/api/receipts', data),
  updateReceipt:   (id, data)    => api.put(`/api/receipts/${id}`, data),

  // Shared: open-document allocations
  getAllocations:   (type, id)          => api.get(`/api/${type}/${id}/allocations`),
  allocate:         (type, id, data)    => api.post(`/api/${type}/${id}/allocate`, data),
  removeAllocation: (type, id, allocId) => api.del(`/api/${type}/${id}/allocations/${allocId}`),
});
