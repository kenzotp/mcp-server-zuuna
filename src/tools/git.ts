import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { CI_STATUSES, GIT_KINDS } from "../constants.js";
import { groupId } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

const repoArg = z.object({
  remoteUrl: z
    .string()
    .min(1)
    .describe("The repo's remote URL, in whatever form (HTTPS or SSH) — resolved to the same RepoLink either way."),
  provider: z.string().optional(),
});

/**
 * Git-on-board: link branches/commits/PRs and CI status to cards. These three
 * are the Bearer-authed, CI-shaped endpoints under /api/v1/git.
 *
 * NOT exposed: `POST /git/merges` (the merge-history feed — a bulk,
 * walker-specific ingest, not a sensible single tool call) and everything
 * under `/git/webhooks/*` and `/git/providers/*`, which are INBOUND receivers
 * authenticated by an HMAC signature or a provider OAuth handshake, never a
 * Bearer token — there is no v1 scope that could gate them and no token
 * identity to attribute a call to.
 */
export function gitTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_link_git_branches",
      description:
        'REPLACE-ALL snapshot of a repo\'s in-flight branches in a group (up to 500). Each needs at least name and headSha; a branch named for a card ("ZNA-249-…" or matching the group\'s prefix) links automatically. An empty branches array is refused unless confirmEmpty is true — that guard exists so a half-failed snapshot cannot silently wipe the page.',
      inputSchema: {
        repo: repoArg,
        groupId,
        branches: z
          .array(
            z.object({
              name: z.string().min(1),
              headSha: z.string().min(1),
              base: z.string().optional(),
              baseSha: z.string().optional(),
              forkedAt: z.string().optional(),
              ahead: z.number().int().min(0).optional(),
              commitsTotal: z.number().int().min(0).optional(),
              commitsKeyed: z.number().int().min(0).optional(),
              keys: z.array(z.string()).max(20).optional(),
              prNumber: z.string().optional(),
              prState: z.string().optional(),
              authorName: z.string().optional(),
              lastCommitAt: z.string().optional(),
            }),
          )
          .max(500),
        confirmEmpty: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["git:write"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/git/branches", {
            body: { repo: args.repo, groupId: args.groupId, branches: args.branches, confirmEmpty: args.confirmEmpty },
          }),
        ),
      ),
    },
    {
      name: "zuuna_report_ci_checks",
      description: "Record CI status checks (up to 1000 per call), each attached to whichever card its commit/branch/PR or description names.",
      inputSchema: {
        repo: repoArg,
        checks: z
          .array(
            z.object({
              name: z.string().min(1),
              status: z.enum(CI_STATUSES),
              sha: z.string().optional(),
              branch: z.string().optional(),
              pr: z.string().optional(),
              url: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .min(1)
          .max(1000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["git:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("POST", "/api/v1/git/checks", { body: { repo: args.repo, checks: args.checks } })),
      ),
    },
    {
      name: "zuuna_record_git_events",
      description: 'Record git events (commit/branch/pr, up to 1000 per call) via smart-commits ("PREFIX-123" in the ref or message) to link them to cards.',
      inputSchema: {
        repo: repoArg,
        events: z
          .array(
            z.object({
              kind: z.enum(GIT_KINDS),
              ref: z.string().min(1),
              message: z.string().optional(),
              title: z.string().optional(),
              url: z.string().optional(),
              state: z.string().optional(),
              author: z.string().optional(),
              baseRef: z.string().optional(),
              baseSha: z.string().optional(),
            }),
          )
          .min(1)
          .max(1000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["git:write"],
      run: wrap(async (args) =>
        jsonResult(await client.request("POST", "/api/v1/git/events", { body: { repo: args.repo, events: args.events } })),
      ),
    },
  ];
}
