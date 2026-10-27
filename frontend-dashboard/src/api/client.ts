import type {
  Report, ReportsResponse, SummaryResponse, TimeseriesResponse,
  AuditLogEntry, AuthUser, ConfigEntry, EventCategory,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const TOKEN_KEY = "nwbdap_token";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error || { code: "UNKNOWN", message: "Request failed" };
    throw new ApiError(res.status, err.code, err.message);
  }
  return data as T;
}

function buildQuery(params: Record<string, string | string[] | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === "") continue;
    if (Array.isArray(val)) val.forEach((v) => qs.append(key, v));
    else qs.append(key, String(val));
  }
  return qs.toString();
}

// ---------------- Public: reports ----------------
export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  category?: EventCategory[];
  state?: string;
  city?: string;
  status?: "verified" | "unverified";
  page?: number;
  limit?: number;
}

export function fetchReports(filters: ReportFilters = {}) {
  const qs = buildQuery(filters as Record<string, string | string[] | number | undefined>);
  return request<ReportsResponse>(`/api/reports?${qs}`);
}

export function fetchReport(reportId: string) {
  return request<Report>(`/api/reports/${reportId}`);
}

export function submitReport(body: {
  rawText: string;
  claimedCategory?: EventCategory;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}) {
  return request<{ reportId: string; status: string }>("/api/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------- Public: analytics ----------------
export function fetchSummary() {
  return request<SummaryResponse>("/api/analytics/summary");
}

export function fetchTimeseries(granularity: "hour" | "day" = "day") {
  return request<TimeseriesResponse>(`/api/analytics/timeseries?granularity=${granularity}`);
}

// ---------------- Auth ----------------
export async function login(email: string, password: string) {
  const result = await request<{ token: string; role: string; email: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  sessionStorage.setItem(TOKEN_KEY, result.token);
  return result;
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

export function fetchMe() {
  return request<{ user: AuthUser }>("/api/auth/me");
}

// ---------------- Admin ----------------
export function fetchQueue(params: { category?: string; state?: string } = {}) {
  const qs = buildQuery(params);
  return request<{ items: Report[] }>(`/api/admin/queue?${qs}`);
}

export function verifyReport(
  reportId: string,
  action: "approve" | "reject",
  comment?: string,
  categoryOverride?: EventCategory
) {
  return request<Report>(`/api/admin/reports/${reportId}/verify`, {
    method: "PATCH",
    body: JSON.stringify({ action, comment, categoryOverride }),
  });
}

export function fetchAudit(reportId: string) {
  return request<{ items: AuditLogEntry[] }>(`/api/admin/reports/${reportId}/audit`);
}

export function fetchConfig() {
  return request<{ items: ConfigEntry[] }>("/api/admin/config");
}

export function updateConfig(key: string, value: unknown) {
  return request<ConfigEntry>("/api/admin/config", {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  });
}

export interface AdminUser {
  _id: string;
  email: string;
  role: "moderator" | "admin";
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export function fetchUsers() {
  return request<{ items: AdminUser[] }>("/api/admin/users");
}

export function createUser(email: string, password: string, role: "moderator" | "admin") {
  return request<{ id: string; email: string; role: string }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
}

export function patchUser(id: string, body: { active?: boolean; role?: "moderator" | "admin" }) {
  return request<AdminUser>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
