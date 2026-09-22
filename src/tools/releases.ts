import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { confirm, groupId, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/**
 * Releases: plan, publish and correct them. NOT exposed here: the bulk
 * commit-manifest ingestion (`commits`/`preview` on `POST /releases`) — that
 * is the CI pipeline's own bulk endpoint (up to 2000 commits per call,
 * designed for `cut-release.sh`), not a sensible interactive tool call. This
 * covers the metadata/publish half of that same route, same as the hosted
 * endpoint (kanban-app src/lib/mcp/tools/releases.ts).
 */
export function releaseTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_releases",
      description: "List a group's releases, optionally narrowed to a state (PLANNED|RELEASED|ARCHIVED).",
      inputSchema: { groupId, state: z.enum(["PLANNED", "RELEASED", "ARCHIVED"]).optional(), ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/releases", {
            query: {
              groupId: args.groupId as string,
              state: args.state as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_get_release",
      description: "Get one release's detail: state, dates, tag, shipped card/point counts.",
      inputSchema: { releaseId: z.string().min(1) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(await client.request("GET", `/api/v1/releases/${encodeURIComponent(String(args.releaseId))}`)),
      ),
    },
    {
      name: "zuuna_create_release",
      description:
        'Plan or publish a release in a group. Provide releaseId (to fill in an existing planned release), or a name/tag to create one. publish defaults to false when no tag/commits context is given — pass publish: true to mark it RELEASED and fire release.published to webhook subscribers immediately.',
      inputSchema: {
        groupId,
        releaseId: z.string().min(1).optional(),
        name: z.string().max(80).optional(),
        tag: z.string().max(200).optional(),
        tagUrl: z.string().max(1000).optional(),
        notes: z.string().max(100_000).optional(),
        releaseDate: z.string().nullable().optional(),
        publish: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["releases:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/releases", {
            body: {
              groupId: args.groupId,
              releaseId: args.releaseId,
              name: args.name,
              tag: args.tag,
              tagUrl: args.tagUrl,
              notes: args.notes,
              releaseDate: args.releaseDate,
              publish: args.publish,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_release",
      description:
        "Correct a release. action=edit changes name/description/releaseDate/notes/tag (only the fields you send); unpublish reverts a RELEASED release to PLANNED (keeps its shipped-card archive); archive/unarchive is a display filter, not a data lock.",
      inputSchema: {
        releaseId: z.string().min(1),
        action: z.enum(["edit", "unpublish", "archive", "unarchive"]).default("edit"),
        name: z.string().max(80).optional(),
        description: z.string().max(2000).nullable().optional(),
        releaseDate: z.string().nullable().optional(),
        notes: z.string().max(100_000).nullable().optional(),
        tag: z.string().max(200).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["releases:write"],
      run: wrap(async (args) => {
        const body: Record<string, unknown> = { action: args.action };
        for (const k of ["name", "description", "releaseDate", "notes", "tag"]) {
          if (Object.prototype.hasOwnProperty.call(args, k)) body[k] = args[k];
        }
        return jsonResult(
          await client.request("PATCH", `/api/v1/releases/${encodeURIComponent(String(args.releaseId))}`, { body }),
        );
      }),
    },
    {
      name: "zuuna_delete_release",
      description:
        "Permanently delete a release (its commit/merge history, sprint links, card-release links and shipped-card archive all cascade with it). Requires confirm: true.",
      inputSchema: { releaseId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["releases:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("DELETE", `/api/v1/releases/${encodeURIComponent(String(args.releaseId))}`)),
      ),
    },
  ];
}
