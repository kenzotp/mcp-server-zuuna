import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { boardId, cardTypeEnum, confirm, priorityEnum } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

const RECURRING_UNITS = ["days", "weeks", "months"] as const;

/** Recurring card series. Starting one lives under a board (it mints cards onto it); pausing/editing/ending it is board-independent. */
export function recurringTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_recurring_cards",
      description: "List a board's recurring-card series, paused and active both.",
      inputSchema: { boardId },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/recurring`),
        ),
      ),
    },
    {
      name: "zuuna_create_recurring_card",
      description: "Start a recurring-card series on a board: every everyN unit(s) (days|weeks|months) it mints a card from the given template, until endAt (if set).",
      inputSchema: {
        boardId,
        title: z.string().min(1),
        description: z.string().nullable().optional(),
        priority: priorityEnum.nullable().optional(),
        type: cardTypeEnum.optional(),
        columnId: z.string().min(1).nullable().optional(),
        everyN: z.number().int().min(1),
        unit: z.enum(RECURRING_UNITS),
        endAt: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/boards/${encodeURIComponent(String(args.boardId))}/recurring`, {
            body: {
              title: args.title,
              description: args.description,
              priority: args.priority,
              type: args.type,
              columnId: args.columnId,
              everyN: args.everyN,
              unit: args.unit,
              endAt: args.endAt,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_recurring_card",
      description:
        "Edit a series' interval, end date and/or pause state (enabled). Resuming a paused series re-schedules its next run from now, so it never bursts out catch-up cards.",
      inputSchema: {
        id: z.string().min(1),
        everyN: z.number().int().min(1).optional(),
        unit: z.enum(RECURRING_UNITS).optional(),
        endAt: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const body: Record<string, unknown> = {};
        for (const k of ["everyN", "unit", "endAt", "enabled"]) {
          if (Object.prototype.hasOwnProperty.call(args, k)) body[k] = args[k];
        }
        return jsonResult(
          await client.request("PATCH", `/api/v1/recurring/${encodeURIComponent(String(args.id))}`, { body }),
        );
      }),
    },
    {
      name: "zuuna_delete_recurring_card",
      description: "Cancel a recurring-card series for good (no trash). Requires confirm: true.",
      inputSchema: { id: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("DELETE", `/api/v1/recurring/${encodeURIComponent(String(args.id))}`)),
      ),
    },
  ];
}
