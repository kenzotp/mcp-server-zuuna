import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** `zuuna_comment` keeps this package's original name and semantics. */
export function commentTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_comments",
      description: "Read a card's discussion, oldest first — the order it happened, and the order an incremental sync appends in.",
      inputSchema: { card: cardRef, ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["comments:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}/comments`, {
            query: { limit: args.limit as number | undefined, cursor: args.cursor as string | undefined },
          }),
        ),
      ),
    },
    {
      name: "zuuna_comment",
      description: "Add a comment to a card. The author is the user who created the API token. @mentions notify.",
      inputSchema: { card: cardRef, body: z.string().min(1).describe("Comment text (plain text or sanitized HTML).") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["comments:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/comments`, {
            body: { body: args.body },
          }),
        ),
      ),
    },
  ];
}
