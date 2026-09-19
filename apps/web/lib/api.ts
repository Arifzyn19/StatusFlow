const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    // Never send a JSON content-type with an empty body — Fastify rejects
    // such requests (FST_ERR_CTP_EMPTY_JSON_BODY), breaking bodyless
    // DELETE/POST calls.
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw Object.assign(new Error(j.error ?? `Request failed (${res.status})`), {
      code: j.code,
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => req<{ email: string }>('/api/auth/me'),
  login: (email: string, password: string) =>
    req<{ email: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  setup: (email: string, password: string) =>
    req<{ email: string }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  accounts: () => req<Account[]>('/api/accounts'),
  createAccount: (name: string) =>
    req<Account>('/api/accounts', { method: 'POST', body: JSON.stringify({ name }) }),
  accountQr: (id: string) => req<QrState>(`/api/accounts/${id}/qr`),
  pairing: (id: string, phone: string) =>
    req<{ code: string }>(`/api/accounts/${id}/pairing`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  reconnect: (id: string) => req<{ ok: boolean }>(`/api/accounts/${id}/reconnect`, { method: 'POST' }),
  logoutAccount: (id: string) => req<{ ok: boolean }>(`/api/accounts/${id}/logout`, { method: 'POST' }),
  removeAccount: (id: string) => req<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),

  uploads: (params?: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
    return req<Paginated<Upload>>(`/api/uploads?${qs.toString()}`);
  },
  uploadDetail: (id: string) => req<Upload>(`/api/uploads/${id}`),
  deleteUpload: (id: string) => req<{ ok: boolean }>(`/api/uploads/${id}`, { method: 'DELETE' }),
  cancelUpload: (id: string) => req<{ ok: boolean }>(`/api/uploads/${id}/cancel`, { method: 'POST' }),

  stats: () => req<Stats>('/api/system/stats'),
  settings: () => req<SystemSettings>('/api/system/settings'),
  saveSettings: (body: Record<string, number>) =>
    req<{ ok: boolean }>('/api/system/settings', { method: 'PUT', body: JSON.stringify(body) }),
};

export interface Account {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrState {
  status: string;
  qr: string | null;
  qrDataUrl: string | null;
  stale: boolean;
  qrAt: number | null;
  reason: string | null;
}

export interface Upload {
  id: string;
  accountId: string;
  accountName?: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  status: string;
  errorMessage: string | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Stats {
  accounts: { total: number; connected: number; disconnected: number; byStatus: Record<string, number> };
  uploads: { total: number; success: number; failed: number };
  recent: { id: string; accountId: string; originalFilename: string; status: string; createdAt: string }[];
  system: {
    loadAvg: number[];
    totalMem: number;
    freeMem: number;
    usedMem: number;
    diskFree: number | null;
    cpuCount: number;
  };
  limits: {
    maxUploadSizeMB: number;
    maxVideoDurationSeconds: number;
    maxConcurrentUploads: number;
    maxConcurrentFfmpeg: number;
    allowedVideoMime: string[];
  };
}

export interface SystemSettings {
  maxUploadSizeMB: number;
  maxVideoDurationSeconds: number;
  maxConcurrentUploads: number;
  maxConcurrentFfmpeg: number;
  allowedVideoMime: string[];
  version: string;
}
