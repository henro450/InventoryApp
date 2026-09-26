import * as SecureStore from 'expo-secure-store';

// Production defaults to Render. EXPO_PUBLIC_API_URL can override this at bundle time for
// local development, e.g. http://192.168.1.50:4000/api on a physical device.
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'https://inventryapi.onrender.com/api'
).replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = 15000;

// For requests made outside request() (file previews/downloads) that need the session.
export async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

  // A bad connection can leave fetch hanging for minutes; give up after 15s so screens fall
  // back to the data on this phone instead of spinning. Network failures carry no `status`.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err.name === 'AbortError'
        ? 'The server took too long to respond. Check your connection and try again.'
        : "Couldn't reach the server. Check your internet connection."
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) {
      await clearToken();
      if (unauthorizedHandler) unauthorizedHandler(data.code);
    }
    const err = new Error(data.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    if (data.code) err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  // Invite / password-reset links (the token arrives via the beams://set-password deep link).
  getPasswordToken: (token) => request(`/auth/password-token?token=${encodeURIComponent(token)}`, { auth: false }),
  setPassword: (payload) => request('/auth/set-password', { method: 'POST', body: payload, auth: false }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),

  // Fingerprint login (see src/auth/biometrics.js).
  registerBiometric: (deviceName) => request('/auth/biometric/register', { method: 'POST', body: { deviceName } }),
  biometricLogin: (deviceToken) => request('/auth/biometric/login', { method: 'POST', body: { deviceToken }, auth: false }),
  revokeBiometric: (deviceToken) => request('/auth/biometric/revoke', { method: 'POST', body: { deviceToken }, auth: false }),

  // SuperAdmin: profiling Main Companies.
  adminListCompanies: () => request('/admin/companies'),
  adminCreateCompany: (payload) => request('/admin/companies', { method: 'POST', body: payload }),
  adminUpdateCompany: (id, payload) => request(`/admin/companies/${id}`, { method: 'PATCH', body: payload }),
  adminResendInvite: (id) => request(`/admin/companies/${id}/resend-invite`, { method: 'POST' }),
  adminCompanyUsers: (id) => request(`/admin/companies/${id}/users`),
  adminGetSettings: () => request('/admin/settings'),
  adminUpdateSettings: (payload) => request('/admin/settings', { method: 'PUT', body: payload }),
  adminListPayments: (status) => request(`/admin/payments${status ? `?status=${status}` : ''}`),
  adminApprovePayment: (id, note) => request(`/admin/payments/${id}/approve`, { method: 'POST', body: { note } }),
  adminRejectPayment: (id, note) => request(`/admin/payments/${id}/reject`, { method: 'POST', body: { note } }),

  // Company admins: subscription and proof of payment.
  getSubscription: () => request('/subscription'),
  uploadSubscriptionPayment: (payload) => request('/subscription/payments', { method: 'POST', body: payload }),

  getMyCompany: () => request('/companies/mine'),
  getMe: () => request('/auth/me'),

  // Company admins: users of their own company.
  getCompanyUsers: () => request('/company-users'),
  addCompanyUser: (payload) => request('/company-users', { method: 'POST', body: payload }),
  updateCompanyUser: (id, payload) => request(`/company-users/${id}`, { method: 'PATCH', body: payload }),
  resendCompanyUserInvite: (id) => request(`/company-users/${id}/resend-invite`, { method: 'POST' }),
  createSubCompany: (payload) => request('/companies/sub-companies', { method: 'POST', body: payload }),
  updateSubCompany: (id, payload) => request(`/companies/sub-companies/${id}`, { method: 'PATCH', body: payload }),
  updateAlertSettings: (payload) => request('/companies/mine', { method: 'PATCH', body: payload }),
  deactivateSubCompany: (id) => request(`/companies/sub-companies/${id}/deactivate`, { method: 'PATCH' }),
  reactivateSubCompany: (id) => request(`/companies/sub-companies/${id}/reactivate`, { method: 'PATCH' }),
  resendSubCompanyInvite: (id) => request(`/companies/sub-companies/${id}/resend-invite`, { method: 'POST' }),

  getItems: (companyId) => request(`/items${companyId ? `?companyId=${companyId}` : ''}`),
  createItem: (payload) => request('/items', { method: 'POST', body: payload }),

  createTransaction: (payload) => request('/transactions', { method: 'POST', body: payload }),

  getAuditLogs: (companyId, { userId, action, from, to } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (userId) params.set('userId', userId);
    if (action) params.set('action', action);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/audit-logs?${params.toString()}`);
  },

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
  getOversightSummary: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/reports/oversight-summary?${params.toString()}`);
  },
  getDiscrepancies: (companyId, { from, to } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/reports/discrepancies?${params.toString()}`);
  },
  getPriceTrend: (companyId, { itemId, priceType } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (itemId) params.set('itemId', itemId);
    if (priceType) params.set('priceType', priceType);
    return request(`/reports/price-trend?${params.toString()}`);
  },
  getAlerts: (companyId) => request(`/reports/alerts${companyId ? `?companyId=${companyId}` : ''}`),
  getReportSnapshots: (companyId, { limit } = {}) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (limit) params.set('limit', limit);
    return request(`/reports/snapshots?${params.toString()}`);
  },
  generateReportSnapshot: (companyId) =>
    request(`/reports/snapshots/generate${companyId ? `?companyId=${companyId}` : ''}`, { method: 'POST' }),

  syncPush: (items, transactions, itemUpdates = []) =>
    request('/sync/push', { method: 'POST', body: { items, transactions, itemUpdates } }),
  syncPull: (since) => request(`/sync/pull?since=${encodeURIComponent(since || '1970-01-01T00:00:00.000Z')}`),
  syncOperations: (operations) =>
    request('/sync/operations', { method: 'POST', body: { operations } }),
  syncChanges: (cursor = '0', limit = 500) =>
    request(`/sync/changes?cursor=${encodeURIComponent(cursor)}&limit=${limit}`),
};

export async function saveToken(token) {
  await SecureStore.setItemAsync('authToken', token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync('authToken');
}
