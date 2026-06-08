/**
 * expenseService — Operating Expenses API wrapper.
 * Usage: const svc = expenseService(useApi());
 */
export const expenseService = (api) => ({
  list:    (params = {}) => api.get(`/api/expenses?${new URLSearchParams(params)}`),
  getById: (id)          => api.get(`/api/expenses/${id}`),
  create:  (data)        => api.post('/api/expenses', data),
  update:  (id, data)    => api.put(`/api/expenses/${id}`, data),
  post:    (id)          => api.put(`/api/expenses/${id}/post`),
  void:    (id)          => api.put(`/api/expenses/${id}/void`),
});
