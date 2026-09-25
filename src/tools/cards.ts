import { z } from "zod";
import { resolveBoard, resolveColumnByTitle } from "../board-resolve.js";
import type { ZuunaClient } from "../client.js";
import { boardId, cardRef, cardTypeEnum, confirm, pageArgs, pick, priorityEnum } from "../schema-fragments.js";
import { jsonResult, toolError, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";
import type { ZuunaColumnsResponse } from "../types.js";

const dueLikeDate = z
  .string()
  .nullable()
  .optional()
  .describe('"YYYY-MM-DD" (anchored at noon UTC) or a full ISO 8601 timestamp. null clears it.');

export function cardTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_card",
      description:
        "Get a card's full detail: description, priority, type, due/start dates, checklist counts, assignees, epic, custom field values, attachment metadata.",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}`)),
      ),
    },
    {
      name: "zuuna_list_board_cards",
      description:
        "List a board's cards, in board order by default (column then position). `archived` narrows to false|true|all (default false); `updatedSince` (ISO 8601) narrows to cards changed after it, for incremental sync.",
      inputSchema: {
        boardId,
        archived: z.enum(["false", "true", "all"]).optional(),
        updatedSince: z.string().optional(),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/cards`, {
            query: {
              archived: args.archived as string | undefined,
              updatedSince: args.updatedSince as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_search_cards",
      description:
        "Search cards workspace-wide: the one list that needs no board or group id up front. Filters narrow: q (case-insensitive text in title + description), groupId, boardId, columnId, assigneeId, epicId, priority (HIGHEST|HIGH|NORMAL|LOW|LOWEST), label (a tag option id or \"<fieldId>:<optionId>\" token). archived narrows to false|true|all (default false); updatedSince (ISO 8601) narrows to cards changed after it, for incremental sync. Bad values are refused with an error, never silently ignored.",
      inputSchema: {
        q: z.string().optional(),
        groupId: z.string().optional(),
        boardId: z.string().optional(),
        columnId: z.string().optional(),
        assigneeId: z.string().optional(),
        priority: priorityEnum.optional(),
        epicId: z.string().optional(),
label: z.string().optional().describe("A tag option id, or a fieldId:optionId token, the shape the board filter uses."),
        archived: z.enum(["false", "true", "all"]).optional(),
        updatedSince: z.string().optional(),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/cards", {
              query: {
                q: args.q as string | undefined,
                groupId: args.groupId as string | undefined,
                boardId: args.boardId as string | undefined,
                columnId: args.columnId as string | undefined,
                assigneeId: args.assigneeId as string | undefined,
                priority: args.priority as string | undefined,
                epicId: args.epicId as string | undefined,
                label: args.label as string | undefined,
                archived: args.archived as string | undefined,
                updatedSince: args.updatedSince as string | undefined,
                limit: args.limit as number | undefined,
                cursor: args.cursor as string | undefined,
              },
          }),
        ),
      ),
    },
    {
      name: "zuuna_create_card",
      description:
        "Create a card on a board. Title is required; give the target column by id or by title (omitted = the board's first column). idempotencyKey makes a retry safe: re-sending the same key after a lost response or a 5xx returns the ORIGINAL card instead of a duplicate.",
      inputSchema: {
        title: z.string().min(1),
        boardId: z.string().min(1).optional().describe("Board id. Provide this or boardRef."),
        boardRef: z.string().min(1).optional().describe("Board key/title instead of boardId, resolved via the board list."),
        description: z.string().nullable().optional(),
        priority: priorityEnum.optional(),
        type: cardTypeEnum.optional(),
        dueDate: dueLikeDate,
        startDate: dueLikeDate,
        estimateSeconds: z
          .number()
          .nullable()
          .optional()
          .describe("Time-tracking estimate in seconds. Requires the timeTracking plan feature to set a non-null value."),
        columnId: z.string().min(1).optional().describe("Target column id. Provide this or columnTitle."),
        columnTitle: z.string().min(1).optional().describe("Target column title, resolved against the board's columns."),
        assigneeIds: z.array(z.string()).optional().describe("Workspace member ids; must be members of the board's group."),
        idempotencyKey: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        let boardIdValue = args.boardId as string | undefined;
        if (!boardIdValue && args.boardRef) {
          boardIdValue = (await resolveBoard(client, String(args.boardRef))).boardId;
        }
        if (!boardIdValue) return toolError("Provide a board (boardId or boardRef).");

        let columnId = args.columnId as string | undefined;
        if (!columnId && args.columnTitle) {
          const cols = await client.request<ZuunaColumnsResponse>(
            "GET",
            `/api/v1/boards/${encodeURIComponent(boardIdValue)}/columns`,
          );
          columnId = resolveColumnByTitle(cols.columns, String(args.columnTitle));
        }

        const body = {
          ...pick(args, [
            "title",
            "description",
            "priority",
            "type",
            "dueDate",
            "startDate",
            "estimateSeconds",
            "assigneeIds",
            "idempotencyKey",
          ]),
          ...(columnId ? { columnId } : {}),
        };
        return jsonResult(
          await client.request("POST", `/api/v1/boards/${encodeURIComponent(boardIdValue)}/cards`, { body }),
        );
      }),
    },
    {
      name: "zuuna_create_cards",
      description:
        "Create up to 50 cards on ONE board in a single call. Each item validates exactly like zuuna_create_card (title required; target column by id only) and the answer is one result per item: created (id, key, title, status, columnId) or the error that item alone would have gotten. The card cap counts the whole batch; board, closed-sprint and limit errors stay whole-request.",
      inputSchema: {
        boardId: z.string().min(1).optional().describe("Board id. Provide this or boardRef."),
        boardRef: z.string().min(1).optional().describe("Board key/title instead of boardId, resolved via the board list."),
        cards: z
            .array(
              z.object({
                title: z.string().min(1),
                description: z.string().nullable().optional(),
                priority: priorityEnum.optional(),
                type: cardTypeEnum.optional(),
                dueDate: dueLikeDate,
                startDate: dueLikeDate,
                estimateSeconds: z.number().nullable().optional(),
                columnId: z.string().min(1).optional().describe("Target column id (columnTitle is not available on the bulk form)."),
                assigneeIds: z.array(z.string()).optional(),
                idempotencyKey: z.string().min(1).optional(),
              })
            )
            .min(1)
            .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        let boardIdValue = args.boardId as string | undefined;
        if (!boardIdValue && args.boardRef) {
          boardIdValue = (await resolveBoard(client, String(args.boardRef))).boardId;
        }
        if (!boardIdValue) return toolError("Provide a board (boardId or boardRef).");
        return jsonResult(
          await client.request("POST", `/api/v1/boards/${encodeURIComponent(boardIdValue)}/cards`, {
            body: { cards: args.cards },
          }),
        );
      }),
    },
    {
      name: "zuuna_update_card",
      description:
        "Edit a card. Only the fields you send change: title, description, priority, type, dueDate, startDate, estimateSeconds, storyPoints, ready, columnId (move within the SAME board — a cross-board move is zuuna_move_card_to_board), assigneeIds (REPLACES the full set; [] clears everyone), customFields (object keyed by field id; null/empty clears one — zuuna_list_board_fields names the ids and the option vocabulary).",
      inputSchema: {
        card: cardRef,
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        priority: priorityEnum.nullable().optional(),
        type: cardTypeEnum.optional(),
        dueDate: dueLikeDate,
        startDate: dueLikeDate,
        estimateSeconds: z.number().nullable().optional(),
        storyPoints: z.number().min(0).max(999).nullable().optional(),
        ready: z.boolean().optional(),
        columnId: z.string().min(1).optional(),
        assigneeIds: z.array(z.string()).optional(),
        customFields: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const body = pick(args, [
          "title",
          "description",
          "priority",
          "type",
          "dueDate",
          "startDate",
          "estimateSeconds",
          "storyPoints",
          "ready",
          "columnId",
          "assigneeIds",
          "customFields",
        ]);
        if (Object.keys(body).length === 0) return toolError("Provide at least one field to change.");
        return jsonResult(
          await client.request("PATCH", `/api/v1/cards/${encodeURIComponent(String(args.card))}`, { body }),
        );
      }),
    },
    {
      name: "zuuna_move_card",
      description:
        "Move a card to another column on the SAME board. Give the target column by id or by title (resolved against the card's own board). For moving to a DIFFERENT board use zuuna_move_card_to_board.",
      inputSchema: {
        card: cardRef,
        columnId: z.string().min(1).optional().describe("Provide this or columnTitle."),
        columnTitle: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const id = String(args.card);
        let columnId = args.columnId as string | undefined;
        if (!columnId && args.columnTitle) {
          const detail = await client.request<{ boardId: string | null }>(
            "GET",
            `/api/v1/cards/${encodeURIComponent(id)}`,
          );
          if (!detail.boardId) {
            return toolError("This card is in the group backlog and is not on a board, so it has no column to move to.");
          }
          const cols = await client.request<ZuunaColumnsResponse>(
            "GET",
            `/api/v1/boards/${encodeURIComponent(detail.boardId)}/columns`,
          );
          columnId = resolveColumnByTitle(cols.columns, String(args.columnTitle));
        }
        if (!columnId) return toolError("Provide a target column (columnId or columnTitle).");
        return jsonResult(
          await client.request("PATCH", `/api/v1/cards/${encodeURIComponent(id)}`, { body: { columnId } }),
        );
      }),
    },
    {
      name: "zuuna_move_card_to_board",
      description:
        "Move a card to a DIFFERENT board (cross-board move). Optional targetColumnId; omitted, the card lands in the target's default column for its current status category.",
      inputSchema: {
        card: cardRef,
        targetBoardId: z.string().min(1),
        targetColumnId: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/move`, {
            body: { targetBoardId: args.targetBoardId, targetColumnId: args.targetColumnId },
          }),
        ),
      ),
    },
    {
      name: "zuuna_archive_card",
      description: "Archive a card (reversible — see zuuna_unarchive_card).",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/archive`),
        ),
      ),
    },
    {
      name: "zuuna_unarchive_card",
      description:
        "Restore an archived card to active (the inverse of zuuna_archive_card). Refused if the workspace is at its card limit.",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("DELETE", `/api/v1/cards/${encodeURIComponent(String(args.card))}/archive`),
        ),
      ),
    },
    {
      name: "zuuna_delete_card",
      description:
        'Move a card to Trash (restorable for 30 days via zuuna_restore_card, then permanently purged). Refused with time_entries_exist if the card carries logged time, UNLESS confirm is true — passing confirm also acknowledges deleting those hours. Requires confirm: true.',
      inputSchema: { card: cardRef, confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("DELETE", `/api/v1/cards/${encodeURIComponent(String(args.card))}`, {
            query: { withTime: "1" },
          }),
        ),
      ),
    },
    {
      name: "zuuna_restore_card",
      description: "Pull a card back out of Trash. Refused if the workspace is at its card limit (an archived+trashed card is exempt).",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/restore`),
        ),
      ),
    },
  ];
}
