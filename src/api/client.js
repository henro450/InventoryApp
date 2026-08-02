import * as SecureStore from 'expo-secure-store';

// Point this at your machine's LAN IP when testing on a physical device (localhost won't
// resolve to your computer from a phone). e.g. 'http://192.168.1.50:4000/api'
export const API_BASE_URL = 'http://localhost:4000/api';

async function getToken() {
  return SecureStore.getItemAsync('authToken');
}

// AUTH-03: registered by AuthContext so a 401 on an already-authenticated request can force
// a clean logout centrally, without every screen having to handle it individually.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) {
      await clearToken();
      if (unauthorizedHandler) unauthorizedHandler(data.code);
    }
    const err = new Error(data.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  registerCompany: (payload) => request('/auth/register-company', { method: 'POST', body: payload, auth: false }),

  getMyCompany: () => request('/companies/mine'),
  createSubCompany: (payload) => request('/companies/sub-companies', { method: 'POST', body: payload }),
  updateSubCompany: (id, payload) => request(`/companies/sub-companies/${id}`, { method: 'PATCH', body: payload }),
  deactivateSubCompany: (id) => request(`/companies/sub-companies/${id}/deactivate`, { method: 'PATCH' }),
  reactivateSubCompany: (id) => request(`/companies/sub-companies/${id}/reactivate`, { method: 'PATCH' }),

  getItems: (companyId) => request(`/items${companyId ? `?companyId=${companyId}` : ''}`),
  createItem: (payload) => request('/items', { method: 'POST', body: payload }),

  createTransaction: (payload) => request('/transactions', { method: 'POST', body: payload }),

  getAuditLogs: (companyId) => request(`/audit-logs${companyId ? `?companyId=${companyId}` : ''}`),

  getStockOnHandReport: (companyId, { category, itemId } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (category) params.set('category', category);
    if (itemId) params.set('itemId', itemId);
    return request(`/reports/stock-on-hand?${params.toString()}`);
  },
  getSalesVsPurchases: (companyId, { from, to } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/reports/sales-vs-purchases?${params.toString()}`);
  },
  getMarginByItem: (companyId) => request(`/reports/margin-by-item${companyId ? `?companyId=${companyId}` : ''}`),
  getTransactionMargins: (companyId, { itemId, from, to, limit } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (itemId) params.set('itemId', itemId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (limit) params.set('limit', limit);
    return request(`/reports/transaction-margins?${params.toString()}`);
  },

  syncPush: (items, transactions, itemUpdates = []) =>
    request('/sync/push', { method: 'POST', body: { items, transactions, itemUpdates } }),
  syncPull: (since) => request(`/sync/pull?since=${encodeURIComponent(since || '1970-01-01T00:00:00.000Z')}`),
};

export async function saveToken(token) {
  await SecureStore.setItemAsync('authToken', token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync('authToken');
}
