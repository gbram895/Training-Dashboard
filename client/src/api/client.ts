const TOKEN_KEY = 'training-dashboard.token';
const USER_KEY = 'training-dashboard.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);

  if (!res.ok) {
    // A dead/expired token (e.g. the server's signing secret rotated, or the
    // token's own 30-day expiry passed) otherwise left the app stuck showing
    // stale "logged in" state from localStorage forever, spinning on
    // whatever loading screen depended on this request succeeding — send the
    // user back to a real login instead.
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/register') {
      setToken(null);
      localStorage.removeItem(USER_KEY);
      window.location.href = '/login';
    }
    const message = body?.error?.formErrors?.[0] ?? body?.error ?? res.statusText;
    throw new ApiError(res.status, typeof message === 'string' ? message : 'Request failed');
  }

  return body as T;
}
