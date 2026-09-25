import { z } from "zod";
import { resolveBoard } from "../board-resolve.js";
import type { ZuunaClient } from "../client.js";
import { boardId, boardRef, groupId } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** GET .../cards' list envelope — only the fields zuuna_board needs to know about. */
interface CardListPage {
  data: unknown[];
  nextCursor?: string;
}

export function boardTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_boards",
      description:
        "List the workspace's boards (non-archived, non-private). Each entry carries id, title, key (card prefix), groupId. Use the id with zuuna_board.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async () => jsonResult(await client.request("GET", "/api/v1/boards"))),
    },
    {
      name: "zuuna_board",
      description:
        "Get one board assembled: its columns (in order, with WIP limits and SLA hours) and its cards (key, title, column, priority, type). The card list pages at 200; when more cards exist the response carries cardsTruncated and a nextCursor — pass that back as cardsCursor for the next page. Accepts the board id, its key (card prefix) or its title.",
      inputSchema: {
        board: boardRef,
        cardsCursor: z.string().min(1).optional().describe("nextCursor from a previous zuuna_board call on this board."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read", "cards:read"],
      run: wrap(async (args) => {
        const resolved = await resolveBoard(client, String(args.board));
        const [columns, cards] = await Promise.all([
          resolved.columns
            ? Promise.resolve(resolved.columns)
            : client.request("GET", `/api/v1/boards/${encodeURIComponent(resolved.boardId)}/columns`),
          client.request<CardListPage>(
            "GET",
            `/api/v1/boards/${encodeURIComponent(resolved.boardId)}/cards`,
            { query: { limit: 200, cursor: args.cardsCursor as string | undefined } },
          ),
        ]);
        const columnsBody = columns as {
          boardId: string;
          title: string;
          key: string | null;
          groupId: string | null;
          columns: unknown[];
        };
        return jsonResult({
          board: {
            id: columnsBody.boardId,
            title: columnsBody.title,
            key: columnsBody.key,
            groupId: columnsBody.groupId,
          },
          columns: columnsBody.columns,
          cards: cards.data,
          ...(cards.nextCursor ? { cardsTruncated: true, nextCursor: cards.nextCursor } : {}),
        });
      }),
    },
    {
      name: "zuuna_create_board",
      description: "Create an empty board (no columns yet — add them with zuuna_create_column) in a group. Body: title, groupId.",
      inputSchema: {
        groupId,
        title: z.string().min(1),
        description: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["boards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/boards", {
            body: { groupId: args.groupId, title: args.title, description: args.description },
          }),
        ),
      ),
    },
    {
      name: "zuuna_list_columns",
      description:
        "List a board's columns in order — id, title, isDone, statusCategory, position, WIP limit, SLA hours. These columnId values are what a card move expects.",
      inputSchema: { boardId },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/columns`),
        ),
      ),
    },
    {
      name: "zuuna_create_column",
      description: "Add a column to an existing (non-archived) board.",
      inputSchema: {
        boardId,
        title: z.string().min(1),
        position: z.number().int().min(0).optional().describe("Defaults to the end of the board."),
        isDone: z.boolean().optional(),
        statusCategory: z.enum(["OPEN", "ACTIVE", "DONE"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["boards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/columns`, {
            body: {
              title: args.title,
              position: args.position,
              isDone: args.isDone,
              statusCategory: args.statusCategory,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_list_board_fields",
      description:
        "Read the custom fields attached to a board: id, name, type, in display order. For SELECT, MULTISELECT and TAGS fields, options is the option vocabulary a card's customFields value may use; for every other type options is null. update_card's customFields argument is keyed by these field ids.",
      inputSchema: { boardId },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/fields`),
        ),
      ),
    },
    {
      name: "zuuna_list_automations",
      description:
        "Read a board's automation rules: trigger, conditions, actions, enabled, recent run outcomes. Read-only — automations cannot be created or edited through this server, only inspected. A sendWebhook action's URL is redacted (it can carry a chat-app incoming-webhook secret).",
      inputSchema: { boardId },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/automations`),
        ),
      ),
    },
  ];
}
