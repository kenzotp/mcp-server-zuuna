import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { cardRef, confirm } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/**
 * Attachment metadata (list/get/delete, none of which touch the bytes) plus,
 * since ZNA-2170, the upload itself: `zuuna_upload_attachment` accepts a LOCAL
 * FILE PATH or base64 + a filename and POSTs the multipart body the v1 route
 * reads (field "file"). The route's own gates — the 10 MB cap, the storage
 * metering, the executable-extension check, the verified-email gate — run
 * unchanged, and its errors surface verbatim through the client's error
 * envelope.
 */
export function attachmentTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_upload_attachment",
      description:
        "Upload a file onto a card from a local file path, or from base64 plus a filename. The same limits the REST upload route enforces apply and its errors surface verbatim: 10 MB per file, the workspace storage cap (409 limit_reached), executable extensions refused, and the token creator needs a verified email.",
      inputSchema: {
        card: cardRef,
        path: z.string().min(1).optional().describe("Local file path to read and upload. Give this, or base64 + filename."),
        base64: z.string().min(1).optional().describe("The file's bytes, base64-encoded. Give with filename."),
        filename: z.string().min(1).optional().describe("The file's name, extension included (e.g. screenshot.png). Required with base64."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["cards:write"],
      run: wrap(async (args) => {
        const id = encodeURIComponent(String(args.card));
        let bytes: Uint8Array;
        let filename: string;
        if (args.path && args.base64) {
          throw new Error("Give either path or base64 + filename, not both.");
        }
        if (args.path) {
          const local = String(args.path);
          bytes = await readFile(local);
          filename = String(args.filename ?? basename(local));
        } else if (args.base64) {
          if (!args.filename) {
            throw new Error("filename is required when uploading base64 bytes.");
          }
          bytes = Buffer.from(String(args.base64), "base64");
          filename = String(args.filename);
        } else {
          throw new Error("Give a local file path, or base64 bytes plus a filename.");
        }
        const form = new FormData();
        form.set("file", new File([bytes], filename));
        return jsonResult(await client.requestForm("POST", `/api/v1/cards/${id}/attachments`, form));
      }),
    },
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
