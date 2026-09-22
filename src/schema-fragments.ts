import { z } from "zod";
import { API_CARD_TYPES, API_PRIORITIES } from "./constants.js";

export const cardRef = z
  .string()
  .min(1)
  .describe('Card key (e.g. "ZNA-2001") or card id. Both work everywhere a card is addressed.');

export const boardRef = z
  .string()
  .min(1)
  .describe("Board id, board key (its card prefix) or board title.");

export const boardId = z.string().min(1).describe("Board id, from zuuna_boards.");

export const groupId = z.string().min(1).describe("Group id, from zuuna_list_groups.");

export const confirm = z
  .literal(true)
  .describe("Must be exactly `true` to perform this action — a safety gate on a destructive call.");

export const priorityEnum = z.enum(API_PRIORITIES);
export const cardTypeEnum = z.enum(API_CARD_TYPES);

/** Spread into a tool's own `inputSchema` object to add opt-in cursor paging, identical to the v1 list endpoints' own `?limit`/`?cursor` contract. */
export const pageArgs = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Page size (max 200). Omitted: the whole collection, one response."),
  cursor: z.string().min(1).optional().describe("Opaque nextCursor from a previous page of this same list."),
};

/**
 * Only the keys present in `args` — an omitted optional field must stay
 * absent from the v1 body, never become `undefined` in it, so the route's own
 * presence checks see exactly what the caller sent.
 */
export function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(args, k)) out[k] = args[k];
  }
  return out;
}
