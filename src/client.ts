import type {
  ZuunaBoardCardsResponse,
  ZuunaBoardsResponse,
  ZuunaCardDetail,
  ZuunaCardWriteResult,
  ZuunaColumnsResponse,
  ZuunaCommentResult,
  ZuunaMe,
} from "./types.js";

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
 * Page size for the board card list: the v1 API's own MAX_PAGE_SIZE (it clamps
 * any larger `?limit`). One page keeps a big board from flooding an agent's
 * context; the response's `nextCursor` says when more cards exist.
 */
export const BOARD_CARDS_PAGE_SIZE = 200;

/**
 * Validate and normalize a base URL: it must parse as an absolute http(s) URL.
 * Throws a plain Error with a clear message so the server can fail fast in the
 * constructor (i.e. at startup) instead of throwing a bare `new URL()` error
 * from the middle of a tool call. Returns the URL with exactly one trailing
 * slash, which is what `request()` joins paths against.
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
 * Thin typed client over the Zuuna v1 API. One request, zero retries: 4xx
 * answers are surfaced as ZuunaApiError carrying the API's own message, and a
 * lost network / timeout becomes ZuunaNetworkError. Callers decide what to do —
 * the server never silently retries a write.
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

  // ---- endpoint methods (grounded in the v1 routes) ----

  /** GET /api/v1/me — any valid token. */
  me(): Promise<ZuunaMe> {
    return this.request("GET", "/api/v1/me");
  }

  /** GET /api/v1/boards — scope boards:read. Unpaged by default = the full list. */
  boards(): Promise<ZuunaBoardsResponse> {
    return this.request("GET", "/api/v1/boards");
  }

  /** GET /api/v1/boards/{boardId}/columns — scope boards:read. */
  columns(boardId: string): Promise<ZuunaColumnsResponse> {
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/columns`);
  }

  /**
   * GET /api/v1/boards/{boardId}/cards — scope cards:read. Paged at
   * BOARD_CARDS_PAGE_SIZE (the API clamps at its MAX_PAGE_SIZE anyway), so a
   * huge board comes back one context-friendly page at a time: when the answer
   * carries a `nextCursor`, more cards exist — pass it back as `cursor`.
   */
  boardCards(boardId: string, opts?: { cursor?: string }): Promise<ZuunaBoardCardsResponse> {
    const params = new URLSearchParams({ limit: String(BOARD_CARDS_PAGE_SIZE) });
    if (opts?.cursor) params.set("cursor", opts.cursor);
    return this.request(
      "GET",
      `/api/v1/boards/${encodeURIComponent(boardId)}/cards?${params.toString()}`,
    );
  }

  /** GET /api/v1/cards/{idOrKey} — scope cards:read. The handle accepts a cuid OR a display key ("ZNA-123"). */
  card(idOrKey: string): Promise<ZuunaCardDetail> {
    return this.request("GET", `/api/v1/cards/${encodeURIComponent(idOrKey)}`);
  }

  /**
   * POST /api/v1/boards/{boardId}/cards — scope cards:write. `idempotencyKey`
   * (v1 ZNA-556) makes retries safe: re-sending the same key after a lost
   * response or a 5xx returns the ORIGINAL card (200) instead of minting a
   * duplicate.
   */
  createCard(
    boardId: string,
    input: { title: string; description?: string | null; columnId?: string; idempotencyKey?: string },
  ): Promise<ZuunaCardWriteResult> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/cards`, input);
  }

  /**
   * PATCH /api/v1/cards/{idOrKey} — scope cards:write. Only the sent fields
   * change. `columnId` moves the card (the v1 PATCH validates it belongs to
   * the card's board and enforces HARD WIP limits).
   */
  updateCard(
    idOrKey: string,
    patch: { title?: string; description?: string | null; priority?: string | null; columnId?: string },
  ): Promise<ZuunaCardWriteResult> {
    return this.request("PATCH", `/api/v1/cards/${encodeURIComponent(idOrKey)}`, patch);
  }

  /** POST /api/v1/cards/{cardId}/comments — scope comments:write. */
  addComment(idOrKey: string, body: string): Promise<ZuunaCommentResult> {
    return this.request("POST", `/api/v1/cards/${encodeURIComponent(idOrKey)}/comments`, { body });
  }

  // ---- plumbing ----

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl).toString();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
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

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ZuunaNetworkError(`The Zuuna API at ${url} returned a non-JSON response.`, { cause: err });
    }
  }
}
