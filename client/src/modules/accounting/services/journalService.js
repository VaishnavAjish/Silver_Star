/**
 * journalService — Journal Entries API wrapper.
 * Usage: const svc = journalService(useApi());
 */
export const journalService = (api) => ({
  list:      (params = {}) => api.get(`/api/journal-entries?${new URLSearchParams(params)}`),
  getById:   (id)          => api.get(`/api/journal-entries/${id}`),
  create:    (data)        => api.post('/api/journal-entries', data),
  update:    (id, data)    => api.put(`/api/journal-entries/${id}`, data),
  voidEntry: (id)          => api.put(`/api/journal-entries/${id}/void`),
  postEntry: (id)          => api.put(`/api/journal-entries/${id}/post`),
});
