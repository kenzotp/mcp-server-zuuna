import { z, type ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZuunaApiError, ZuunaClient, ZuunaNetworkError } from "./client.js";
import type { ZuunaColumn, ZuunaColumnsResponse } from "./types.js";

export const PRIORITIES = ["HIGHEST", "HIGH", "NORMAL", "LOW", "LOWEST"] as const;

/**
 * The 8 MCP tools. Every handler takes the validated args and returns either a
 * JSON payload or an MCP tool error — API errors keep the API's own message,
 * and nothing is ever retried silently.
 */
export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof ZuunaApiError
      ? `Zuuna API error (${err.status}, ${err.code}): ${err.message}`
      : err instanceof ZuunaNetworkError
        ? `Zuuna API unreachable: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function wrap(run: (args: Record<string, never>) => Promise<CallToolResult>) {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    try {
      return await run(args as Record<string, never>);
    } catch (err) {
      return errorResult(err);
    }
  };
}

// ---- reference resolution helpers ----

/**
 * Resolve a board reference that may be a board id (the v1 board routes only
 * take the id) or, as a convenience, a board key/title. Grounded strictly in
 * GET /columns (direct probe) and GET /boards (fallback match).
 */
async function resolveBoard(
  client: ZuunaClient,
  ref: string,
): Promise<{ boardId: string; columns?: ZuunaColumnsResponse }> {
  try {
    const columns = await client.columns(ref);
    return { boardId: ref, columns };
  } catch (err) {
    // Only fall back on a genuine "no such board", never on auth/network faults.
    if (!(err instanceof ZuunaApiError) || err.status !== 404) throw err;
  }
  const { data } = await client.boards();
  const needle = ref.trim().toLowerCase();
  const match = data.find(
    (b) => b.id === ref || (b.key && b.key.toLowerCase() === needle) || b.title.trim().toLowerCase() === needle,
  );
  if (!match) {
    throw new ZuunaApiError(404, "not_found", `No board matches "${ref}" by id, key or title.`);
  }
  return { boardId: match.id };
}

/** Resolve a column title (case-insensitive) against a board's columns. */
function resolveColumn(columns: ZuunaColumn[], columnTitle: string): string {
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

// ---- tool definitions ----

export function buildToolRegistrations(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_me",
      description:
        "Show the identity of the Zuuna API token in use: organization, plan, granted scopes and (when lapsed) the grace-window deadline. Use this first to check what the token may do.",
      inputSchema: {},
      run: wrap(async () => jsonResult(await client.me())),
    },
    {
      name: "zuuna_boards",
      description:
        "List the boards of the token's organization (non-archived, non-private). Each entry carries id, title, card key prefix and timestamps. Use the id with zuuna_board.",
      inputSchema: {},
      run: wrap(async () => jsonResult(await client.boards())),
    },
    {
      name: "zuuna_board",
      description:
        "Get one board assembled: its columns (in order) and its cards with key, title, column, priority and type. The card list is capped at one 200-card page so a big board cannot flood the context; when more cards exist the response sets cardsTruncated and a nextCursor — pass that as cardsCursor for the next page. Accepts the board id or its key/title (e.g. the card prefix).",
      inputSchema: {
        board: z.string().min(1).describe("Board id, board key (card prefix) or board title."),
        cardsCursor: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Opaque nextCursor from a previous zuuna_board response — fetches that board's next page of cards.",
          ),
      },
      run: wrap(async (args) => {
        const resolved = await resolveBoard(client, args.board as string);
        // Reuse the columns the id-probe already fetched; otherwise both reads
        // run in parallel. The card list is paged (200 per page — the v1 API's
        // own MAX_PAGE_SIZE) so a huge board cannot flood the agent's context.
        const [columns, cards] = await Promise.all([
          resolved.columns ? Promise.resolve(resolved.columns) : client.columns(resolved.boardId),
          client.boardCards(resolved.boardId, { cursor: args.cardsCursor as string | undefined }),
        ]);
        const payload = {
          board: { id: columns.boardId, title: columns.title, key: columns.key, groupId: columns.groupId },
          columns: columns.columns,
          cards: cards.data.map((c) => ({
            key: c.key,
            id: c.id,
            title: c.title,
            column: c.status,
            columnId: c.columnId,
            priority: c.priority,
            type: c.type,
            isArchived: c.isArchived,
            assignees: c.assignees,
            dueDate: c.dueDate,
          })),
        };
        // When the page is not the whole board, say so and hand back the
        // cursor instead of implying the list was complete.
        if (cards.nextCursor) {
          return jsonResult({ ...payload, cardsTruncated: true, nextCursor: cards.nextCursor });
        }
        return jsonResult(payload);
      }),
    },
    {
      name: "zuuna_card",
      description:
        "Get a card's full detail — description, priority, type, due date, checklist counts, assignees, epic, custom fields, attachments. Accepts the display key (e.g. ZNA-2001) or the card id.",
      inputSchema: {
        card: z.string().min(1).describe("Card key (e.g. ZNA-2001) or card id."),
      },
      run: wrap(async (args) => jsonResult(await client.card(args.card as string))),
    },
    {
      name: "zuuna_create_card",
      description:
        "Create a card on a board. Title is required; give the target column by id or by title (omitted = the board's first column). Returns the new card's id and key. Retries are safe: pass the same idempotencyKey again after a lost response or 5xx and the API returns the original card instead of a duplicate.",
      inputSchema: {
        title: z.string().min(1).describe("Card title (required)."),
        boardId: z.string().min(1).optional().describe("Board id (from zuuna_boards). Provide this or boardKey."),
        boardKey: z.string().min(1).optional().describe("Board key/title instead of boardId; resolved via the board list."),
        description: z.string().nullable().optional().describe("Card description (plain text or sanitized HTML). null clears."),
        columnId: z.string().min(1).optional().describe("Target column id. Provide this or columnTitle."),
        columnTitle: z.string().min(1).optional().describe("Target column title (resolved against the board's columns)."),
        idempotencyKey: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Client-chosen key for safe retries (e.g. "order-4711-card"). If this key was already used in this workspace, the API returns the ORIGINAL card (200) instead of creating a duplicate. Use a fresh key for each new card; reuse one key only for retries of the same logical card.',
          ),
      },
      run: wrap(async (args) => {
        const title = args.title as string;
        let boardId = args.boardId as string | undefined;
        if (!boardId && args.boardKey) {
          const resolved = await resolveBoardByKey(client, args.boardKey as string);
          boardId = resolved;
        }
        if (!boardId) {
          return errorResult(new Error("Provide a board (boardId or boardKey)."));
        }
        let columnId = args.columnId as string | undefined;
        if (!columnId && args.columnTitle) {
          const cols = await client.columns(boardId);
          columnId = resolveColumn(cols.columns, args.columnTitle as string);
        }
        const body: {
          title: string;
          description?: string | null;
          columnId?: string;
          idempotencyKey?: string;
        } = { title };
        if (args.description !== undefined) body.description = args.description as string | null;
        if (columnId) body.columnId = columnId;
        if (args.idempotencyKey !== undefined) body.idempotencyKey = args.idempotencyKey as string;
        return jsonResult(await client.createCard(boardId, body));
      }),
    },
    {
      name: "zuuna_update_card",
      description:
        "Edit a card: title, description and/or priority (HIGHEST|HIGH|NORMAL|LOW|LOWEST, or null to clear). Only the fields you send change. Accepts a card key (ZNA-2001) or id.",
      inputSchema: {
        card: z.string().min(1).describe("Card key (e.g. ZNA-2001) or card id."),
        title: z.string().min(1).optional().describe("New title."),
        description: z.string().nullable().optional().describe("New description. null clears it."),
        priority: z.enum(PRIORITIES).nullable().optional().describe("New priority, or null to clear."),
      },
      run: wrap(async (args) => {
        const patch: { title?: string; description?: string | null; priority?: string | null } = {};
        if (args.title !== undefined) patch.title = args.title as string;
        if (args.description !== undefined) patch.description = args.description as string | null;
        if (args.priority !== undefined) patch.priority = args.priority as string | null;
        if (Object.keys(patch).length === 0) {
          return errorResult(new Error("Provide at least one of: title, description, priority."));
        }
        return jsonResult(await client.updateCard(args.card as string, patch));
      }),
    },
    {
      name: "zuuna_move_card",
      description:
        "Move a card to another column. Give the target column by id or by title (resolved against the card's board). Accepts a card key (ZNA-2001) or id.",
      inputSchema: {
        card: z.string().min(1).describe("Card key (e.g. ZNA-2001) or card id."),
        columnId: z.string().min(1).optional().describe("Target column id. Provide this or columnTitle."),
        columnTitle: z.string().min(1).optional().describe("Target column title (resolved against the card's board)."),
      },
      run: wrap(async (args) => {
        let columnId = args.columnId as string | undefined;
        if (!columnId && args.columnTitle) {
          const detail = await client.card(args.card as string);
          if (!detail.boardId) {
            return errorResult(
              new Error("This card is in the group backlog and is not on a board, so it has no column to move to."),
            );
          }
          const cols = await client.columns(detail.boardId);
          columnId = resolveColumn(cols.columns, args.columnTitle as string);
        }
        if (!columnId) {
          return errorResult(new Error("Provide a target column (columnId or columnTitle)."));
        }
        return jsonResult(await client.updateCard(args.card as string, { columnId }));
      }),
    },
    {
      name: "zuuna_comment",
      description:
        "Add a comment to a card. The author is the user who created the API token. Accepts a card key (ZNA-2001) or id.",
      inputSchema: {
        card: z.string().min(1).describe("Card key (e.g. ZNA-2001) or card id."),
        body: z.string().min(1).describe("Comment text (plain text or sanitized HTML; @mentions notify)."),
      },
      run: wrap(async (args) =>
        jsonResult(await client.addComment(args.card as string, args.body as string)),
      ),
    },
  ];
}

/** Resolve a board key/title to an id via GET /boards (used by zuuna_create_card). */
async function resolveBoardByKey(client: ZuunaClient, ref: string): Promise<string | undefined> {
  const { data } = await client.boards();
  const needle = ref.trim().toLowerCase();
  const match = data.find(
    (b) => b.id === ref || (b.key && b.key.toLowerCase() === needle) || b.title.trim().toLowerCase() === needle,
  );
  return match?.id;
}
