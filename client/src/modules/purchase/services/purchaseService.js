/**
 * purchaseService — Purchase Notes (vendor bills) API wrapper.
 * Usage: const svc = purchaseService(useApi());
 */
export const purchaseService = (api) => ({
  list:    (params = {}) => api.get(`/api/purchase-notes?${new URLSearchParams(params)}`),
  getById: (id)          => api.get(`/api/purchase-notes/${id}`),
  create:  (data)        => api.post('/api/purchase-notes', data),
  update:  (id, data)    => api.put(`/api/purchase-notes/${id}`, data),
  post:    (id)          => api.put(`/api/purchase-notes/${id}/post`),
  void:    (id)          => api.put(`/api/purchase-notes/${id}/void`),
});
