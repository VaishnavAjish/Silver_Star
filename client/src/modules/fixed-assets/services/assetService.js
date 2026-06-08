/**
 * assetService — Fixed Assets & Templates API wrapper.
 * Usage: const svc = assetService(useApi());
 */
export const assetService = (api) => ({
  // Fixed asset register
  list:              (params = {}) => api.get(`/api/fixed-assets?${new URLSearchParams(params)}`),
  getById:           (id)          => api.get(`/api/fixed-assets/${id}`),
  create:            (data)        => api.post('/api/fixed-assets', data),
  update:            (id, data)    => api.put(`/api/fixed-assets/${id}`, data),
  retire:            (id, data)    => api.put(`/api/fixed-assets/${id}/retire`, data),

  // Depreciation ledger for a single asset
  getDepreciationHistory: (id)     => api.get(`/api/fixed-assets/${id}/depreciation`),

  // Asset templates (default depreciation config per category)
  listTemplates:     (params = {}) => api.get(`/api/asset-templates?${new URLSearchParams(params)}`),
  getTemplate:       (id)          => api.get(`/api/asset-templates/${id}`),
  createTemplate:    (data)        => api.post('/api/asset-templates', data),
  updateTemplate:    (id, data)    => api.put(`/api/asset-templates/${id}`, data),
  deleteTemplate:    (id)          => api.del(`/api/asset-templates/${id}`),

  // Asset categories master
  listCategories:    ()            => api.get('/api/fixed-asset-categories'),
  createCategory:    (data)        => api.post('/api/fixed-asset-categories', data),
  updateCategory:    (id, data)    => api.put(`/api/fixed-asset-categories/${id}`, data),
});
