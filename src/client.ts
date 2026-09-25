/** The API answered with a non-2xx status. `message` is the API's own message. */
export class ZuunaApiError extends Error {
  readonly status: number;
  /** The v1 machine error code, e.g. "invalid_request", "not_found", "unauthorized". */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ZuunaApiError";
    this.status = status;
    this.code = code;
  }
}

/** The request never got an answer: DNS failure, connection refused, timeout. */
export class ZuunaNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZuunaNetworkError";
  }
}

export const DEFAULT_BASE_URL = "https://app.zuuna.de";
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Page size zuuna_board pins its card page at: the v1 API's own MAX_PAGE_SIZE
 * (it clamps any larger `?limit`). One page keeps a big board from flooding an
 * agent's context; the response's `nextCursor` says when more cards exist.
 */
export const BOARD_CARDS_PAGE_SIZE = 200;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions {
  /** Query string params. `undefined` values are omitted (never sent as "undefined"). */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body. Omitted entirely (no Content-Type either) when undefined. */
  body?: unknown;
  /** ZNA-2170 — a multipart body (the attachment upload). fetch sets the
   * multipart boundary content-type itself; never pair this with `body`. */
  form?: FormData;
}

/**
 * Validate and normalize a base URL: it must parse as an absolute http(s) URL.
 * Throws a plain Error with a clear message so the server can fail fast in the
 * constructor (i.e. at startup) instead of throwing a bare `new URL()` error
 * from the middle of a tool call. Returns the URL with exactly one trailing
 * slash, which is what `send()` joins paths against.
 */
export function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `Invalid ZUUNA_BASE_URL "${raw}": it must be an absolute http(s) URL, e.g. ${DEFAULT_BASE_URL}.`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `Invalid ZUUNA_BASE_URL "${raw}": unsupported scheme "${url.protocol}" — use http(s).`,
    );
  }
  const out = url.toString();
  return out.endsWith("/") ? out : `${out}/`;
}

export interface ZuunaClientOptions {
  /** Zuuna base URL. Defaults to https://app.zuuna.de (env ZUUNA_BASE_URL). Must be an absolute http(s) URL — anything else throws at construction. */
  baseUrl?: string;
  /** API token, sent as a Bearer token (env ZUUNA_API_TOKEN). */
  token: string;
  /** Per-request timeout in milliseconds. Default 15000. No retries are made. */
  timeoutMs?: number;
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin generic client over the Zuuna v1 API. One request, zero retries: 4xx/5xx
 * answers are surfaced as ZuunaApiError carrying the API's own status, code and
 * message — the same tool-error mapping the hosted MCP endpoint uses
 * (kanban-app src/lib/mcp/errors.ts) — and a lost network / timeout becomes
 * ZuunaNetworkError. Callers decide what to do — the server never silently
 * retries a write.
 */
export class ZuunaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ZuunaClientOptions) {
    const raw = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.baseUrl = validateBaseUrl(raw);
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (new URL(this.baseUrl).protocol !== "https:") {
      // stderr on purpose — stdout belongs to the MCP stdio transport.
      console.error(
        `mcp-server-zuuna: warning: ZUUNA_BASE_URL is not HTTPS (${this.baseUrl.replace(/\/$/, "")}). ` +
          `The API token would travel in cleartext; use https:// unless this is a local test endpoint.`,
      );
    }
  }

  /**
   * Call a v1 endpoint and parse its JSON response. `path` starts with
   * "/api/v1/..." (own leading slash trimmed before joining against baseUrl).
   */
  async request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.send(method, path, opts);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ZuunaNetworkError(`The Zuuna API at ${path} returned a non-JSON response.`, { cause: err });
    }
  }

  /**
   * Call a v1 endpoint and return the raw, already-ok Response — for the one
   * route (attachment download) whose body is not JSON. Non-2xx answers still
   * throw ZuunaApiError exactly like `request()`.
   */
  async requestRaw(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<Response> {
    return this.send(method, path, opts);
  }

  /** ZNA-2170 — POST a multipart form (the attachment upload). Same error
   * envelope as request(): a non-2xx answer throws ZuunaApiError with the
   * API's own status, code and message. */
  async requestForm<T = unknown>(method: HttpMethod, path: string, form: FormData): Promise<T> {
    const res = await this.send(method, path, { form });
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ZuunaNetworkError(`The Zuuna API at ${path} returned a non-JSON response.`, { cause: err });
    }
  }

  // ---- plumbing ----

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Does the fetch, timeout and error-envelope handling shared by both public methods. Returns only ok Responses — never-ok throws before returning. */
  private async send(method: HttpMethod, path: string, opts: RequestOptions): Promise<Response> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ZuunaNetworkError(
        `Could not reach the Zuuna API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (!res.ok) {
      // The v1 error envelope is { error: <code>, message: <human message> }.
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        // Non-JSON body — fall through to a generic message.
      }
      const p = (payload ?? {}) as { error?: unknown; message?: unknown };
      const code = typeof p.error === "string" && p.error ? p.error : `http_${res.status}`;
      const message =
        typeof p.message === "string" && p.message
          ? p.message
          : typeof p.error === "string" && p.error
            ? p.error
            : `Request failed with status ${res.status}`;
      throw new ZuunaApiError(res.status, code, message);
    }

    return res;
  }
}
