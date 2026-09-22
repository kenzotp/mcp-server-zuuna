import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, confirm } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

export function checklistTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_checklist",
      description: "Read a card's checklist: every item plus the total/completed counts the card face shows.",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}/checklist`),
        ),
      ),
    },
    {
      name: "zuuna_add_checklist_item",
      description: "Add a checklist item to a card (appended at the end).",
      inputSchema: { card: cardRef, content: z.string().min(1).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/checklist`, {
            body: { content: args.content },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_checklist_item",
      description: "Rename and/or tick a checklist item. Only the fields you send change.",
      inputSchema: {
        card: cardRef,
        itemId: z.string().min(1),
        content: z.string().min(1).max(500).optional(),
        completed: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const body: Record<string, unknown> = {};
        if (args.content !== undefined) body.content = args.content;
        if (args.completed !== undefined) body.completed = args.completed;
        return jsonResult(
          await client.request(
            "PATCH",
            `/api/v1/cards/${encodeURIComponent(String(args.card))}/checklist/${encodeURIComponent(String(args.itemId))}`,
            { body },
          ),
        );
      }),
    },
    {
      name: "zuuna_delete_checklist_item",
      description: "Remove a checklist item. Requires confirm: true.",
      inputSchema: { card: cardRef, itemId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request(
            "DELETE",
            `/api/v1/cards/${encodeURIComponent(String(args.card))}/checklist/${encodeURIComponent(String(args.itemId))}`,
          ),
        ),
      ),
    },
  ];
}
