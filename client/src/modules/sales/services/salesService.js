/**
 * salesService — Sales Invoices API wrapper.
 * Usage: const svc = salesService(useApi());
 */
export const salesService = (api) => ({
  list:    (params = {}) => api.get(`/api/invoices?${new URLSearchParams(params)}`),
  getById: (id)          => api.get(`/api/invoices/${id}`),
  create:  (data)        => api.post('/api/invoices', data),
  update:  (id, data)    => api.put(`/api/invoices/${id}`, data),
  post:    (id)          => api.put(`/api/invoices/${id}/post`),
  void:    (id)          => api.put(`/api/invoices/${id}/void`),

  // Available rough lots for adding to invoice line items
  getAvailableRough: (params = {}) => api.get(`/api/rough-growth?${new URLSearchParams(params)}`),
});
