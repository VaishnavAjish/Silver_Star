/**
 * inventoryService — Inventory Lots API wrapper.
 * Usage: const svc = inventoryService(useApi());
 */
export const inventoryService = (api) => ({
  // Lot listing (supports filter params: status, location, search, etc.)
  getLots:        (params = {}) => api.get(`/api/inventory?${new URLSearchParams(params)}`),
  getLot:         (id)          => api.get(`/api/lots/${id}`),

  // Lot operations
  mixLots:        (data)        => api.post('/api/lots/mix', data),
  splitLot:       (data)        => api.post('/api/lots/split', data),
  updateLot:      (id, data)    => api.put(`/api/lots/${id}`, data),

  // Opening / Closing entries
  createOpening:  (data)        => api.post('/api/inventory/opening', data),
  createClosing:  (data)        => api.post('/api/inventory/closing', data),

  // Lineage tree
  getLineage:     (id)          => api.get(`/api/lots/${id}/lineage`),

  // Stock transfer
  transferPreview: (data)       => api.post('/api/stock-transfer/preview', data),
  transferExecute: (data)       => api.post('/api/stock-transfer', data),
});
