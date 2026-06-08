/**
 * manufacturingService — Manufacturing dashboard & process master API wrapper.
 * Usage: const svc = manufacturingService(useApi());
 */
export const manufacturingService = (api) => ({
  // Control Tower (real-time machine dashboard)
  getControlTower:  ()             => api.get('/api/manufacturing/dashboard'),
  getMachineStatus: (id)           => api.get(`/api/machines/${id}/status`),

  // Process master (CVD recipes / process definitions)
  listProcesses:    (params = {})  => api.get(`/api/process-master?${new URLSearchParams(params)}`),
  getProcess:       (id)           => api.get(`/api/process-master/${id}`),
  createProcess:    (data)         => api.post('/api/process-master', data),
  updateProcess:    (id, data)     => api.put(`/api/process-master/${id}`, data),
  deleteProcess:    (id)           => api.del(`/api/process-master/${id}`),

  // Machine master
  listMachines:     (params = {})  => api.get(`/api/machines?${new URLSearchParams(params)}`),
  getMachine:       (id)           => api.get(`/api/machines/${id}`),
  updateMachine:    (id, data)     => api.put(`/api/machines/${id}`, data),

  // Rough growth output
  listGrowthOutput: (params = {})  => api.get(`/api/rough-growth?${new URLSearchParams(params)}`),
  getGrowthOutput:  (id)           => api.get(`/api/rough-growth/${id}`),
});
