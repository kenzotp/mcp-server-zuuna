import type { ZodRawShape } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ApiScope } from "./scopes.js";

/**
 * The shape every `src/tools/<area>.ts` file exports one array of. Mirrors the
 * hosted MCP endpoint's ToolDef (kanban-app src/lib/mcp/tool-types.ts), minus
 * the caller-context parameter — this package holds one ZuunaClient per
 * process (one bearer token), so `run` only ever needs the call's own args.
 */
export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
  /** Every scope in this list must be on the token for the tool to be
   * registered at all (see buildAllowedTools in tools/index.ts). Empty =
   * always registered (zuuna_me only needs a valid token). */
  requiredScopes: ApiScope[];
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}
