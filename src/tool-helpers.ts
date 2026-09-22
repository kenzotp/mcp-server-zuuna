import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZuunaApiError, ZuunaNetworkError } from "./client.js";

/** Turn a successful payload into an MCP tool result. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Turn a plain message into an MCP tool error result. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Turn any thrown error (API, network, or a local validation Error) into an MCP tool error, with the API's own status/code/message when there is one. */
export function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof ZuunaApiError
      ? `Zuuna API error (${err.status}, ${err.code}): ${err.message}`
      : err instanceof ZuunaNetworkError
        ? `Zuuna API unreachable: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
  return toolError(message);
}

/** Wraps a tool's run function so any throw (ZuunaApiError, ZuunaNetworkError, or a plain local Error) becomes an MCP tool error instead of an uncaught rejection. */
export function wrap(
  run: (args: Record<string, unknown>) => Promise<CallToolResult>,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await run(args);
    } catch (err) {
      return errorResult(err);
    }
  };
}
