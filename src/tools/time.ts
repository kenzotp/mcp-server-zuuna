import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, confirm, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

const durationArgs = {
  seconds: z.number().positive().optional().describe("Duration in seconds. Provide this or duration."),
  duration: z.string().min(1).optional().describe('Duration like "2h 30m". Provide this or seconds.'),
  note: z.string().max(2000).optional(),
};

/** Time tracking: log/start/stop/list/active/bulk/edit/delete. Every verb here requires the workspace's timeTracking plan feature — the v1 routes check it, not this file. */
export function timeTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_card_time",
      description: "List logged time entries on a card, newest first, plus the card's total seconds.",
      inputSchema: { card: cardRef, ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["time:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}/time`, {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_log_time",
      description:
        'Log a CLOSED time entry on a card — work already done. Provide seconds or a duration string ("2h 30m"). For an ongoing timer use zuuna_start_timer / zuuna_stop_timer instead.',
      inputSchema: { card: cardRef, ...durationArgs, startedAt: z.string().optional().describe("ISO 8601. Defaults to now.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/time`, {
            body: { seconds: args.seconds, duration: args.duration, note: args.note, startedAt: args.startedAt },
          }),
        ),
      ),
    },
    {
      name: "zuuna_start_timer",
      description:
        "Start a running timer on a card. Idempotent: starting an already-running timer for the same person is a no-op, not an error. Optional userEmail delegates the timer to another workspace member (e.g. relaying a Slack action) — resolved against THIS workspace's membership only.",
      inputSchema: { card: cardRef, userEmail: z.string().email().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/time`, {
            body: { action: "start", userEmail: args.userEmail },
          }),
        ),
      ),
    },
    {
      name: "zuuna_stop_timer",
      description: "Stop a card's running timer, closing it at the elapsed duration. A no-op (not an error) if nothing is running.",
      inputSchema: { card: cardRef, userEmail: z.string().email().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/time`, {
            body: { action: "stop", userEmail: args.userEmail },
          }),
        ),
      ),
    },
    {
      name: "zuuna_list_active_timers",
      description: "List every running timer visible to this token, optionally filtered to one member by email.",
      inputSchema: { userEmail: z.string().email().optional() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["time:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/time/active", {
            query: { userEmail: args.userEmail as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_time_entry",
      description: "Correct a logged time entry's duration and/or note. Refused while the entry's timer is still running — stop it first.",
      inputSchema: { entryId: z.string().min(1), ...durationArgs },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("PATCH", `/api/v1/time/${encodeURIComponent(String(args.entryId))}`, {
            body: { seconds: args.seconds, duration: args.duration, note: args.note },
          }),
        ),
      ),
    },
    {
      name: "zuuna_delete_time_entry",
      description: "Remove a logged time entry. Requires confirm: true.",
      inputSchema: { entryId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("DELETE", `/api/v1/time/${encodeURIComponent(String(args.entryId))}`)),
      ),
    },
    {
      name: "zuuna_import_time_entries",
      description:
        "Bulk-import normalized time entries (up to 200 per call) — from Clockify/Toggl/Harvest or a script. Each entry needs cardKey/cardId (or a PREFIX-N in description) plus seconds or start+end; userEmail attributes it. Idempotent on (source, externalId): repeating one updates it rather than duplicating it. One bad entry does not fail the rest.",
      inputSchema: {
        entries: z
          .array(
            z.object({
              cardId: z.string().min(1).optional(),
              cardKey: z.string().min(1).optional(),
              description: z.string().max(2000).optional(),
              seconds: z.number().positive().optional(),
              start: z.string().optional(),
              end: z.string().optional(),
              note: z.string().optional(),
              userEmail: z.string().email().optional(),
              source: z.string().optional(),
              externalId: z.string().optional(),
              deleted: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(200),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["time:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("POST", "/api/v1/time/entries", { body: { entries: args.entries } })),
      ),
    },
  ];
}
