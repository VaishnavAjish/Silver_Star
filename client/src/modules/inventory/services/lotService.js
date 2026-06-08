/**
 * lotService — Lot Movements & Process Issues API wrapper.
 * Usage: const svc = lotService(useApi());
 */
export const lotService = (api) => ({
  // Lot movements ledger
  listMovements:  (params = {}) => api.get(`/api/lot-movements?${new URLSearchParams(params)}`),
  getMovement:    (id)          => api.get(`/api/lot-movements/${id}`),

  // Process issues (send to machine)
  listIssues:     (params = {}) => api.get(`/api/lot-process-issues?${new URLSearchParams(params)}`),
  getIssue:       (id)          => api.get(`/api/lot-process-issues/${id}`),
  createIssue:    (data)        => api.post('/api/lot-process-issues', data),

  // Returns from machine (multi-line: usable / damaged / consumed / reprocess / QC)
  createReturn:   (issueId, data) => api.post(`/api/lot-process-issues/${issueId}/return`, data),
  getReturn:      (issueId)       => api.get(`/api/lot-process-issues/${issueId}/return`),
});
