import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, confirm } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/**
 * Attachment METADATA only. Uploading is deliberately not exposed — same as
 * the hosted endpoint (kanban-app src/lib/mcp/tools/attachments.ts):
 * `POST /cards/{id}/attachments` takes `multipart/form-data`, and there is no
 * JSON-friendly path onto it (the v1 route reads a binary `File`, which an MCP
 * tool argument cannot carry). List/get/delete never touch the bytes either.
 */
export function attachmentTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_attachments",
      description: "List a card's attachments (metadata only: id, filename, MIME type, size, who uploaded it).",
      inputSchema: { card: cardRef },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/cards/${encodeURIComponent(String(args.card))}/attachments`),
        ),
      ),
    },
    {
      name: "zuuna_get_attachment",
      description:
        "Get one attachment's metadata (filename, MIME type, byte size). Never returns the file's bytes — use zuuna_list_attachments first to find the attachmentId.",
      inputSchema: { card: cardRef, attachmentId: z.string().min(1) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["cards:read"],
      run: wrap(async (args) => {
        const cardId = String(args.card);
        const attachmentId = String(args.attachmentId);
        // The download route answers raw bytes with metadata only in headers —
        // read the length, then discard the body without putting it in the
        // tool result.
        const res = await client.requestRaw(
          "GET",
          `/api/v1/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`,
        );
        const bytes = await res.arrayBuffer();
        const disposition = res.headers.get("content-disposition") ?? "";
        const nameMatch = disposition.match(/filename="?([^"]+)"?/);
        return jsonResult({
          id: attachmentId,
          originalName: nameMatch?.[1] ?? null,
          mimeType: res.headers.get("content-type"),
          size: bytes.byteLength,
        });
      }),
    },
    {
      name: "zuuna_delete_attachment",
      description: "Remove an attachment from a card. Requires confirm: true.",
      inputSchema: { card: cardRef, attachmentId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request(
            "DELETE",
            `/api/v1/cards/${encodeURIComponent(String(args.card))}/attachments/${encodeURIComponent(String(args.attachmentId))}`,
          ),
        ),
      ),
    },
  ];
}
