/**
 * accountService — Chart of Accounts API wrapper.
 * Usage: const svc = accountService(useApi());
 */
export const accountService = (api) => ({
  getAll:         ()           => api.get('/api/accounts'),
  getTree:        ()           => api.get('/api/accounts/tree'),
  getById:        (id)         => api.get(`/api/accounts/${id}`),
  create:         (data)       => api.post('/api/accounts', data),
  update:         (id, data)   => api.put(`/api/accounts/${id}`, data),
  remove:         (id)         => api.del(`/api/accounts/${id}`),
});
