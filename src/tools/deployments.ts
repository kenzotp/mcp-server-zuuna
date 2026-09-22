import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { groupId, pageArgs } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

/** Deployments: an OBSERVATION surface (what the pipeline did), not a control one. There is no "trigger a deploy" verb in v1 to expose. */
export function deploymentTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_deployments",
      description: "List deployment history, optionally narrowed to a group and/or environment.",
      inputSchema: { groupId: groupId.optional(), environment: z.string().optional(), ...pageArgs },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["boards:read"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", "/api/v1/deployments", {
            query: {
              groupId: args.groupId as string | undefined,
              environment: args.environment as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            },
          }),
        ),
      ),
    },
    {
      name: "zuuna_report_deployment",
      description:
        'Report a deployment\'s progress (building|succeeded|failed|...) or update the one in flight. Idempotent on (environment, externalId) — repeat callbacks from the same CI run update ONE row. groupId binds it to a release/board pipeline; omitted, it is still recorded workspace-wide.',
      inputSchema: {
        environment: z.string().min(1).max(40),
        state: z.string().min(1).describe("A deployment state, e.g. building|succeeded|failed."),
        groupId: groupId.nullable().optional(),
        externalId: z.string().max(200).optional().describe("The CI run's own id — the idempotency key."),
        releaseId: z.string().optional(),
        tag: z.string().max(100).optional(),
        sha: z.string().max(64).optional(),
        url: z.string().max(500).optional(),
        runUrl: z.string().max(500).optional(),
        startedAt: z.string().nullable().optional(),
        buildFinishedAt: z.string().nullable().optional(),
        finishedAt: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["deployments:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/deployments", {
            body: {
              environment: args.environment,
              state: args.state,
              groupId: args.groupId,
              externalId: args.externalId,
              releaseId: args.releaseId,
              tag: args.tag,
              sha: args.sha,
              url: args.url,
              runUrl: args.runUrl,
              startedAt: args.startedAt,
              buildFinishedAt: args.buildFinishedAt,
              finishedAt: args.finishedAt,
            },
          }),
        ),
      ),
    },
  ];
}
