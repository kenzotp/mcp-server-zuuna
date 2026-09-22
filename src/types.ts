/**
 * Shapes the tools need to inspect rather than pass straight through
 * (grounded in the v1 route sources in the kanban-app repo). Every other
 * response is forwarded to the caller as JSON, untyped — the same
 * pass-through the hosted MCP endpoint uses (kanban-app src/lib/mcp/errors.ts
 * `fromV1`), so an additive API change flows through unchanged.
 */

/** GET /api/v1/me — token self-description. */
export interface ZuunaMe {
  tokenId: string;
  org: { id: string; product: string; plan: string };
  scopes: string[];
  /** Set only while the workspace is LAPSED and the token runs on its grace window. */
  apiAccessEndsAt: string | null;
}

/** GET /api/v1/boards — list item, just the fields board resolution needs. */
export interface ZuunaBoardSummary {
  id: string;
  title: string;
  key: string | null;
}

export interface ZuunaBoardsResponse {
  data: ZuunaBoardSummary[];
  nextCursor?: string;
}

/** GET /api/v1/boards/{boardId}/columns */
export interface ZuunaColumn {
  id: string;
  title: string;
}

export interface ZuunaColumnsResponse {
  boardId: string;
  title: string;
  key: string | null;
  groupId: string | null;
  columns: ZuunaColumn[];
}
