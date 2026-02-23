const API_BASE = import.meta.env.VITE_API_URL || "";

/** Message shown when the backend is unreachable (connection refused, 502/503, etc.). */
export const SERVER_UNREACHABLE_MSG =
  "Cannot reach the server. Ensure the backend is running (port 8000) and that the frontend proxy can connect to it. Check for port or IP conflicts.";

export type ApiError = { detail: string | { msg: string }[] };

let _refreshPromise: Promise<boolean> | null = null;

/** Attempt to refresh the access token using the stored refresh token. Returns true on success. */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem("access_token", data.access_token);
      if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);
      return true;
    }
  } catch {
    // network error during refresh
  }
  return false;
}

async function request<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
  _isRetry = false,
): Promise<T> {
  const { json, ...init } = options;
  const headers: HeadersInit = {
    ...(init.headers as Record<string, string>),
  };
  const token = localStorage.getItem("access_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    const isNetworkError =
      e instanceof TypeError &&
      (e.message === "Failed to fetch" || e.message === "Load failed" || e.message.includes("NetworkError"));
    if (isNetworkError) throw new Error(SERVER_UNREACHABLE_MSG);
    throw e;
  }
  if (res.status === 502 || res.status === 503)
    throw new Error(SERVER_UNREACHABLE_MSG);

  // Auto-refresh on 401 (expired token) - one attempt only
  if (res.status === 401 && !_isRetry && !path.includes("/auth/login") && !path.includes("/auth/refresh")) {
    if (!_refreshPromise) _refreshPromise = tryRefresh().finally(() => { _refreshPromise = null; });
    const refreshed = await _refreshPromise;
    if (refreshed) return request<T>(path, { ...options, json }, true);
    // Refresh failed - clear tokens and redirect to login
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    window.location.href = "/";
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = body as ApiError;
    let msg = typeof err.detail === "string" ? err.detail : err.detail?.[0]?.msg ?? res.statusText;
    if (res.status === 500) {
      if (!msg || msg === "Internal Server Error") msg = SERVER_UNREACHABLE_MSG;
    }
    throw new Error(msg);
  }
  if (res.status === 204) return {} as T;
  return res.json().catch(() => ({} as T));
}

/** Trigger browser download of a file from an API path (uses auth token). */
export async function downloadFile(path: string, suggestedName: string): Promise<void> {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(res.statusText || "Download failed");
  const blob = await res.blob();
  const name = res.headers.get("Content-Disposition")?.match(/filename="?([^";\n]+)"?/)?.[1] || suggestedName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** POST JSON body, then trigger download of response as file (e.g. backup export). */
export async function postAndDownload(path: string, body: unknown, suggestedName: string): Promise<void> {
  const token = localStorage.getItem("access_token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = typeof (err as { detail?: string }).detail === "string" ? (err as { detail: string }).detail : res.statusText;
    throw new Error(msg || "Download failed");
  }
  const blob = await res.blob();
  const name = res.headers.get("Content-Disposition")?.match(/filename="?([^";\n]+)"?/)?.[1] || suggestedName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: "POST", json }),
  patch: <T>(path: string, json?: unknown) => request<T>(path, { method: "PATCH", json }),
  delete: <T = void>(path: string, options?: { headers?: Record<string, string> }) =>
    request<T>(path, { method: "DELETE", headers: options?.headers }),
};
