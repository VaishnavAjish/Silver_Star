/**
 * depreciationService — Depreciation Runs API wrapper.
 * Usage: const svc = depreciationService(useApi());
 */
export const depreciationService = (api) => ({
  list:    (params = {}) => api.get(`/api/depreciation-runs?${new URLSearchParams(params)}`),
  getById: (id)          => api.get(`/api/depreciation-runs/${id}`),
  create:  (data)        => api.post('/api/depreciation-runs', data),
  post:    (id)          => api.put(`/api/depreciation-runs/${id}/post`),
  reverse: (id)          => api.put(`/api/depreciation-runs/${id}/reverse`),
});
