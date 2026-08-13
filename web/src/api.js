// tiny fetch wrapper — cookie-based session, JSON in/out
async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: (u, b) => request('DELETE', u, b),
};

// endpoint helpers
export const API = {
  // auth
  login: (b) => api.post('/api/auth/login', b),
  logout: () => api.post('/api/auth/logout'),
  me: () => api.get('/api/auth/me'),
  // stats
  stats: () => api.get('/api/stats'),
  // settings
  settings: () => api.get('/api/settings'),
  updateAccount: (b) => api.post('/api/settings/account', b),
  twofaSetup: () => api.post('/api/settings/2fa/setup'),
  twofaEnable: (b) => api.post('/api/settings/2fa/enable', b),
  twofaDisable: (b) => api.post('/api/settings/2fa/disable', b),
  devices: () => api.get('/api/settings/devices'),
  revokeDevice: (id) => api.del(`/api/settings/devices/${id}`),
  revokeAllDevices: () => api.del('/api/settings/devices'),
  // groups
  groups: (kind) => api.get(`/api/groups?kind=${kind}`),
  createGroup: (b) => api.post('/api/groups', b),
  renameGroup: (id, name) => api.put(`/api/groups/${id}`, { name }),
  deleteGroup: (id) => api.del(`/api/groups/${id}`),
  // automation
  automationOverview: () => api.get('/api/automation'),
  runAirportReset: (airportId) => api.post('/api/automation/airport-reset', airportId ? { airportId } : {}),
  runTrafficStats: () => api.post('/api/automation/traffic-stats', {}),
  saveSchedules: (schedules) => api.put('/api/automation/schedule', { schedules }),
  testAirportReset: (airportId) => api.post('/api/automation/test-reset', { airportId }),
  // airports
  airports: () => api.get('/api/airports'),
  detectPanel: (b) => api.post('/api/airports/detect', b),
  createAirport: (b) => api.post('/api/airports', b),
  updateAirport: (id, b) => api.put(`/api/airports/${id}`, b),
  deleteAirport: (id) => api.del(`/api/airports/${id}`),
  batchDeleteAirports: (ids) => api.post('/api/airports/batch/delete', { ids }),
  batchGroupAirports: (ids, group_name) => api.post('/api/airports/batch/group', { ids, group_name }),
  fetchAirport: (id) => api.post(`/api/airports/${id}/fetch`),
  batchFetchAirports: (ids) => api.post('/api/airports/batch/fetch', { ids }),
  resetAirport: (id) => api.post(`/api/airports/${id}/reset`),
  manualResetAirport: (id, sub_url) => api.post(`/api/airports/${id}/manual-reset`, { sub_url }),
  // nodes
  nodes: (qs = '') => api.get(`/api/nodes${qs}`),
  deleteNode: (id) => api.del(`/api/nodes/${id}`),
  batchDeleteNodes: (ids) => api.post('/api/nodes/batch/delete', { ids }),
  nodeLatency: (ids) => api.post('/api/nodes/latency', { ids }),
  // users
  users: () => api.get('/api/users'),
  createUser: (b) => api.post('/api/users', b),
  updateUser: (id, b) => api.put(`/api/users/${id}`, b),
  deleteUser: (id) => api.del(`/api/users/${id}`),
  batchDeleteUsers: (ids) => api.post('/api/users/batch/delete', { ids }),
  batchToggleUsers: (ids, enabled) => api.post('/api/users/batch/toggle', { ids, enabled }),
  batchGroupUsers: (ids, group_name) => api.post('/api/users/batch/group', { ids, group_name }),
  userSub: (id) => api.get(`/api/users/${id}/sub`),
  userPreview: (id) => api.get(`/api/users/${id}/preview`),
  resetUser: (id, b) => api.post(`/api/users/${id}/reset`, b),
  // templates
  templates: () => api.get('/api/templates'),
  createTemplate: (b) => api.post('/api/templates', b),
  updateTemplate: (id, b) => api.put(`/api/templates/${id}`, b),
  deleteTemplate: (id) => api.del(`/api/templates/${id}`),
  // tasks
  tasks: () => api.get('/api/tasks'),
  task: (id) => api.get(`/api/tasks/${id}`),
  clearTasks: () => api.del('/api/tasks'),
};
