import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { groupId, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** Groups (Prisma `Team`), their members and their epics. kanban-app
 * docs/CONVENTIONS.md "Vocabulary": Prisma `Team` = the UI's Group; `Squad`
 * is the UI's Team — this file is entirely the former. */
export function groupTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_groups",
      description:
        "List the workspace's groups (Prisma model Team; the UI calls this a Group — it owns boards, sprints, releases and the card-key prefix). A restricted group this token may not act in is omitted, not merely flagged. The returned id is what every groupId argument elsewhere expects.",
      inputSchema: { ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/groups", {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_list_group_members",
      description: "List a group's members: id, name, email. These ids are the valid values for a card's assigneeIds.",
      inputSchema: { groupId, ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/groups/${encodeURIComponent(String(args.groupId))}/members`, {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_list_epics",
      description:
        "List a group's epics — id, key, title, colour. An epic is a real card (Prisma model Label; the UI calls it an Epic), so its key resolves through the ordinary card tools too.",
      inputSchema: { groupId, ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/groups/${encodeURIComponent(String(args.groupId))}/epics`, {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_create_epic",
      description:
          "Create an epic in a group: a real ticket with its own key (a board-less group card), referencable and linkable like any other card. Title is required; colour comes from the 8-name palette and defaults to purple.",
      inputSchema: {
        groupId,
        title: z.string().min(1),
        description: z.string().nullable().optional(),
        color: z
          .enum(["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"])
          .optional()
          .describe("Epic chip colour; omitted means the palette default (purple)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/groups/${encodeURIComponent(String(args.groupId))}/epics`, {
            body: { title: args.title, description: args.description, color: args.color },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_epic",
      description:
          "Edit an epic. Only the fields you send change: title, description, colour.",
      inputSchema: {
        groupId,
        epicId: z.string().min(1).describe("Epic id (zuuna_list_epics)."),
        title: z.string().min(1).optional().describe("Omitted fields stay unchanged."),
        description: z.string().nullable().optional(),
        color: z
          .enum(["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"])
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request(
            "PATCH",
            `/api/v1/groups/${encodeURIComponent(String(args.groupId))}/epics/${encodeURIComponent(String(args.epicId))}`,
            {
              body: {
                ...(args.title !== undefined ? { title: args.title } : {}),
                ...(args.description !== undefined ? { description: args.description } : {}),
                ...(args.color !== undefined ? { color: args.color } : {}),
              },
            },
          ),
        ),
      ),
    },
    {
      name: "zuuna_list_group_cards",
      description:
        "List every card in a group, whether it stands on a board or in the group's backlog (a board-less card, columnId null). Use this to discover backlog cards — no other list surfaces them. `placement` narrows to board|backlog|all (default all).",
      inputSchema: {
        groupId,
        placement: z.enum(["board", "backlog", "all"]).optional().describe("Default: all."),
        archived: z.enum(["false", "true", "all"]).optional().describe("Default: false (only non-archived cards)."),
        updatedSince: z.string().optional().describe("ISO 8601 timestamp — only cards changed after it."),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/groups/${encodeURIComponent(String(args.groupId))}/cards`, {
            query: {
              placement: args.placement as string | undefined,
              archived: args.archived as string | undefined,
              updatedSince: args.updatedSince as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            },
          }),
        ),
      ),
    },
  ];
}
