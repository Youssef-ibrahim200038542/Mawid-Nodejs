// Minimal, typed fetch client for /api/v1.
// - Same-origin cookies (the HttpOnly session cookie is never readable from JS).
// - CSRF: a synchronizer token kept in memory only (never localStorage), fetched lazily and
//   sent as X-CSRF-Token on every unsafe request. If the server rotates the session (login,
//   expiry) we refetch once and retry.
import type { ApiErrorBody } from "./types";

const base = "/api/v1";
const unsafe = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

export class ApiError extends Error {
    status: number;
    code: string;
    details: ApiErrorBody["error"]["details"];
    constructor(status: number, code: string, message: string, details?: ApiErrorBody["error"]["details"]) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function setCsrfToken(token: string | null) {
    csrfToken = token;
}

// Called when an authenticated request answers 401 (session expired, or revoked after a password
// reset). The auth layer clears its state, and route guards send the user to the login page.
type UnauthenticatedListener = (code: string) => void;
const unauthenticatedListeners = new Set<UnauthenticatedListener>();
export function onUnauthenticated(listener: UnauthenticatedListener) {
    unauthenticatedListeners.add(listener);
    return () => {
        unauthenticatedListeners.delete(listener);
    };
}
// Credential checks answer 401 by design and must not log anyone out.
const credentialPaths = new Set(["/auth/login", "/auth/me"]);

async function fetchCsrf(): Promise<string> {
    if (csrfToken) return csrfToken;
    csrfPromise ??= fetch(`${base}/auth/csrf`, { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(async (res) => {
            if (!res.ok) throw new ApiError(res.status, "CSRF_UNAVAILABLE", "Could not start a secure session.");
            const data = (await res.json()) as { csrfToken: string };
            csrfToken = data.csrfToken;
            return data.csrfToken;
        })
        .finally(() => {
            csrfPromise = null;
        });
    return csrfPromise;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    query?: Query;
    signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    return `${base}${path}${qs ? `?${qs}` : ""}`;
}

export async function api<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
    const method = options.method || "GET";
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (unsafe.has(method)) headers["x-csrf-token"] = await fetchCsrf();

    let res: Response;
    try {
        res = await fetch(buildUrl(path, options.query), {
            method,
            headers,
            credentials: "same-origin",
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: options.signal,
        });
    } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        throw new ApiError(0, "NETWORK", "Can't reach Mawid. Check your connection and try again.");
    }

    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;

    if (!res.ok) {
        const error = data?.error;
        if (error?.code === "CSRF_INVALID" && !retried) {
            csrfToken = null;
            return api<T>(path, options, true);
        }
        if (res.status === 401 && !credentialPaths.has(path)) {
            csrfToken = null;
            for (const listener of unauthenticatedListeners) listener(error?.code || "UNAUTHENTICATED");
        }
        throw new ApiError(res.status, error?.code || "REQUEST_FAILED", error?.message || "The request could not be completed.", error?.details);
    }
    return data as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
