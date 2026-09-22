import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, groupId, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** Sprints. Every verb here requires the workspace's sprints plan feature — the v1 routes check it, not this file. */
export function sprintTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_sprints",
      description: "List the workspace's sprints, optionally narrowed to one group and/or state (PLANNED|ACTIVE|CLOSED).",
      inputSchema: {
        groupId: groupId.optional(),
        state: z.enum(["PLANNED", "ACTIVE", "CLOSED"]).optional(),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/sprints", {
            query: {
              groupId: args.groupId as string | undefined,
              state: args.state as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_get_sprint",
      description: "Get a sprint plus the cards currently in it.",
      inputSchema: { sprintId: z.string().min(1), ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/sprints/${encodeURIComponent(String(args.sprintId))}`, {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_create_sprint",
      description: "Create a PLANNED sprint in a group.",
      inputSchema: {
        groupId,
        name: z.string().min(1).max(120),
        goal: z.string().max(500).optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/sprints", {
            body: { groupId: args.groupId, name: args.name, goal: args.goal, startDate: args.startDate, endDate: args.endDate },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_sprint",
      description:
        "Update a sprint's name/goal/dates. Only the fields you send change. Sprint lifecycle (start/close) is not exposed here — it materializes boards and archival metrics and stays an in-app action.",
      inputSchema: {
        sprintId: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        goal: z.string().max(500).nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const body: Record<string, unknown> = {};
        for (const k of ["name", "goal", "startDate", "endDate"]) {
          if (Object.prototype.hasOwnProperty.call(args, k)) body[k] = args[k];
        }
        return jsonResult(
          await client.request("PATCH", `/api/v1/sprints/${encodeURIComponent(String(args.sprintId))}`, { body }),
        );
      }),
    },
    {
      name: "zuuna_add_cards_to_sprint",
      description:
        "Pull cards into a sprint. Each must belong to the sprint's own group. If the sprint already has a materialized (started) board, a card moves onto it; otherwise it is simply planned in. Response lists which ids were added vs. skipped, with a reason.",
      inputSchema: { sprintId: z.string().min(1), cardIds: z.array(z.string().min(1)).min(1).max(200) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/sprints/${encodeURIComponent(String(args.sprintId))}/cards`, {
            body: { cardIds: args.cardIds },
          }),
        ),
      ),
    },
    {
      name: "zuuna_remove_card_from_sprint",
      description:
        "Take a card out of its sprint (clears its sprint membership). A card standing on the sprint's OWN materialized board leaves it for the group's backlog; a card on an ordinary board stays exactly where it is.",
      inputSchema: { sprintId: z.string().min(1), card: cardRef },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request(
            "DELETE",
            `/api/v1/sprints/${encodeURIComponent(String(args.sprintId))}/cards/${encodeURIComponent(String(args.card))}`,
          ),
        ),
      ),
    },
  ];
}
