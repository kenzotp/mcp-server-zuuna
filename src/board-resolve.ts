import { ZuunaApiError, ZuunaClient } from "./client.js";
import type { ZuunaBoardsResponse, ZuunaColumn, ZuunaColumnsResponse } from "./types.js";

export interface ResolvedBoard {
  boardId: string;
  /** Set only when the direct id-probe hit — reuse it instead of a second GET. */
  columns?: ZuunaColumnsResponse;
}

/**
 * Resolve a board reference that may be a board id (the v1 board routes only
 * take the id) or, as a convenience, a board key/title. Grounded strictly in
 * GET /columns (direct probe) and GET /boards (fallback match) — the same two
 * calls the hosted MCP endpoint's resolveBoard makes (kanban-app
 * src/lib/mcp/board-resolve.ts), over HTTP instead of in-process.
 */
export async function resolveBoard(client: ZuunaClient, ref: string): Promise<ResolvedBoard> {
  try {
    const columns = await client.request<ZuunaColumnsResponse>(
      "GET",
      `/api/v1/boards/${encodeURIComponent(ref)}/columns`,
    );
    return { boardId: ref, columns };
  } catch (err) {
    // Only fall back on a genuine "no such board", never on auth/network faults.
    if (!(err instanceof ZuunaApiError) || err.status !== 404) throw err;
  }
  const { data } = await client.request<ZuunaBoardsResponse>("GET", "/api/v1/boards");
  const needle = ref.trim().toLowerCase();
  const match = data.find(
    (b) => b.id === ref || (b.key && b.key.toLowerCase() === needle) || b.title.trim().toLowerCase() === needle,
  );
  if (!match) {
    throw new ZuunaApiError(404, "not_found", `No board matches "${ref}" by id, key or title.`);
  }
  return { boardId: match.id };
}

/** Resolve a column title (case-insensitive) against a board's own columns. */
export function resolveColumnByTitle(columns: ZuunaColumn[], columnTitle: string): string {
  const needle = columnTitle.trim().toLowerCase();
  const matches = columns.filter((c) => c.title.trim().toLowerCase() === needle);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new ZuunaApiError(
      404,
      "not_found",
      `No column titled "${columnTitle}" on this board. Columns: ${columns.map((c) => c.title).join(", ") || "(none)"}.`,
    );
  }
  throw new ZuunaApiError(
    400,
    "invalid_request",
    `Column title "${columnTitle}" is ambiguous on this board (${matches.length} matches). Use columnId instead.`,
  );
}
