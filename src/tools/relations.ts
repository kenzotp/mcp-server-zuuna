import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { CARD_RELATION_TYPES } from "../constants.js";
import { cardRef, confirm } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** Card relations (dependencies/links). Requires the workspace's cardRelations plan capability, enforced by the v1 routes themselves. */
export function relationTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_relations",
      description:
        "List a card's relations to other cards (blocks, depends on, subtask of, scheduling links, ...), each with its direction relative to this card.",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}/relations`),
        ),
      ),
    },
    {
      name: "zuuna_add_relation",
      description:
        'Link this card to another. `type` is one of the catalog values ("clones" is set automatically by Zuuna and is refused here). `direction` (outward|inward, default outward) picks which card is the semantic SOURCE for a non-symmetric type — e.g. outward "blocks" means THIS card blocks the target. A scheduling type (fs/ss/ff/sf) may carry lagDays and is refused if it would create a dependency cycle.',
      inputSchema: {
        card: cardRef,
        type: z.enum(CARD_RELATION_TYPES),
        targetCard: z.string().min(1).describe("The other card's key or id."),
        direction: z.enum(["outward", "inward"]).optional(),
        lagDays: z.number().int().min(-3650).max(3650).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/cards/${encodeURIComponent(String(args.card))}/relations`, {
            body: {
              type: args.type,
              targetCardId: args.targetCard,
              direction: args.direction,
              lagDays: args.lagDays,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_delete_relation",
      description: "Remove a relation, from either card it connects. Requires confirm: true.",
      inputSchema: { card: cardRef, linkId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request(
            "DELETE",
            `/api/v1/cards/${encodeURIComponent(String(args.card))}/relations/${encodeURIComponent(String(args.linkId))}`,
          ),
        ),
      ),
    },
  ];
}
