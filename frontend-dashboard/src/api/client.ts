const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

type RequestOptions = RequestInit & {
  token?: string;
};

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers = new Headers(fetchOptions.headers);

  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    let message = `API Error: ${response.status}`;

    try {
      const errorData = await response.json();

      if (errorData?.message) {
        message = errorData.message;
      } else if (errorData?.error) {
        message = errorData.error;
      }
    } catch {
      // Response was not JSON
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/* =========================
   GET
========================= */

export async function get<T>(
  endpoint: string,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "GET",
  });
}

/* =========================
   POST
========================= */

export async function post<T>(
  endpoint: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/* =========================
   PUT
========================= */

export async function put<T>(
  endpoint: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/* =========================
   PATCH
========================= */

export async function patch<T>(
  endpoint: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/* =========================
   DELETE
========================= */

export async function remove<T>(
  endpoint: string,
  options?: RequestOptions
): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "DELETE",
  });
}

/* =========================
   API CLIENT
========================= */

export const apiClient = {
  get,
  post,
  put,
  patch,
  delete: remove,
};

export default apiClient;