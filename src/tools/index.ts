// The whole tool set, assembled from the per-resource files (ZNA-2155,
// mirrors kanban-app's src/lib/mcp/tools/index.ts + register.ts). Kept as one
// flat builder rather than one giant file: each resource owns its own tool
// definitions, and this file only concatenates and scope-filters them.
// ZNA-2168 — meTools takes a lazy `() => allTools` closure so zuuna_me can
// report hiddenTools from the full catalog: the arrow only runs at tool-call
// time, after the array below is finished, so there is no cycle.

import { attachmentTools } from "./attachments.js";
import { boardTools } from "./boards.js";
import { cardTools } from "./cards.js";
import { checklistTools } from "./checklist.js";
import { commentTools } from "./comments.js";
import { deploymentTools } from "./deployments.js";
import { gitTools } from "./git.js";
import { groupTools } from "./groups.js";
import { meTools } from "./me.js";
import { recurringTools } from "./recurring.js";
import { relationTools } from "./relations.js";
import { releaseTools } from "./releases.js";
import { sprintTools } from "./sprints.js";
import { timeTools } from "./time.js";
import { webhookTools } from "./webhooks.js";
import type { ZuunaClient } from "../client.js";
import type { ToolRegistration } from "../tool-types.js";
import type { ZuunaMe } from "../types.js";

/** The full 70-tool set, built against one client (one bearer token per process). */
export function buildToolRegistrations(client: ZuunaClient): ToolRegistration[] {
  const allTools: ToolRegistration[] = [
    ...meTools(client, () => allTools),
    ...groupTools(client),
    ...boardTools(client),
    ...cardTools(client),
    ...commentTools(client),
    ...checklistTools(client),
    ...relationTools(client),
    ...attachmentTools(client),
    ...timeTools(client),
    ...sprintTools(client),
    ...recurringTools(client),
    ...releaseTools(client),
    ...deploymentTools(client),
    ...webhookTools(client),
    ...gitTools(client),
  ];
  return allTools;
}

/** The tools a set of granted scopes allows — every one of a tool's requiredScopes must be present. Mirrors the hosted endpoint's `allowedTools` (kanban-app src/lib/mcp/register.ts). */
export function allowedTools(tools: ToolRegistration[], scopes: readonly string[]): ToolRegistration[] {
  const scopeSet = new Set(scopes);
  return tools.filter((tool) => tool.requiredScopes.every((s) => scopeSet.has(s)));
}

export interface ResolvedToolSet {
  tools: ToolRegistration[];
  /** false when GET /me failed and we fell back to registering everything. */
  scoped: boolean;
}

/**
 * Scope-gate `allTools` against this token's own GET /me. On any failure
 * (network, an invalid/expired token, anything) this registers the full set
 * instead and writes one stderr line saying why — every call is still
 * enforced by the API itself regardless of what got registered here.
 */
export async function resolveToolsForToken(
  client: ZuunaClient,
  allTools: ToolRegistration[],
): Promise<ResolvedToolSet> {
  try {
    const me = await client.request<ZuunaMe>("GET", "/api/v1/me");
    return { tools: allowedTools(allTools, me.scopes), scoped: true };
  } catch (err) {
    console.error(
      `mcp-server-zuuna: could not read GET /api/v1/me to scope the tool list (${
        err instanceof Error ? err.message : String(err)
      }); registering the full tool set — every call remains scope-checked by the API.`,
    );
    return { tools: allTools, scoped: false };
  }
}
