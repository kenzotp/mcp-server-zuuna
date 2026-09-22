import { z } from "zod";
import type { ZuunaClient } from "../client.js";
import { WEBHOOK_EVENTS } from "../constants.js";
import { confirm } from "../schema-fragments.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

const eventsArg = z
  .array(z.enum(WEBHOOK_EVENTS))
  .optional()
  .describe("Event names to subscribe to. Omit (or send []) to receive all of them.");

/** Outbound webhook endpoints. ONE scope, `webhooks:manage`, covers every verb here — every act (list/create/patch/delete/test/read-deliveries) is administering this workspace's push subscriptions. */
export function webhookTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_list_webhooks",
      description: "List this workspace's webhook endpoints. Never returns a signing secret (only the create call does, once).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async () => jsonResult(await client.request("GET", "/api/v1/webhooks"))),
    },
    {
      name: "zuuna_create_webhook",
      description:
        "Register a webhook endpoint. The response's `secret` is the ONLY time the signing secret is ever shown — store it immediately, there is no way to read it back.",
      inputSchema: {
        url: z.string().url(),
        events: eventsArg,
        description: z.string().max(120).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", "/api/v1/webhooks", {
            body: { url: args.url, events: args.events, description: args.description },
          }),
        ),
      ),
    },
    {
      name: "zuuna_update_webhook",
      description: "Edit a webhook endpoint. Only the fields you send change; enabled: false is how a subscriber pauses itself without losing the registration.",
      inputSchema: {
        webhookId: z.string().min(1),
        enabled: z.boolean().optional(),
        url: z.string().url().optional(),
        events: eventsArg,
        description: z.string().max(120).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async (args) => {
        const body: Record<string, unknown> = {};
        for (const k of ["enabled", "url", "events", "description"]) {
          if (Object.prototype.hasOwnProperty.call(args, k)) body[k] = args[k];
        }
        return jsonResult(
          await client.request("PATCH", `/api/v1/webhooks/${encodeURIComponent(String(args.webhookId))}`, { body }),
        );
      }),
    },
    {
      name: "zuuna_delete_webhook",
      description: "Remove a webhook endpoint (its delivery log goes with it). Requires confirm: true.",
      inputSchema: { webhookId: z.string().min(1), confirm },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async (args) =>
        jsonResult(await client.request("DELETE", `/api/v1/webhooks/${encodeURIComponent(String(args.webhookId))}`)),
      ),
    },
    {
      name: "zuuna_test_webhook",
      description: "Send a real `ping` delivery to one endpoint, regardless of its subscribed events, and report the fresh delivery status.",
      inputSchema: { webhookId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("POST", `/api/v1/webhooks/${encodeURIComponent(String(args.webhookId))}/test`),
        ),
      ),
    },
    {
      name: "zuuna_list_webhook_deliveries",
      description:
        "Read an endpoint's last 20 delivery attempts (payload truncated to 2 KB; a payload naming a board this token cannot read is redacted).",
      inputSchema: { webhookId: z.string().min(1) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: ["webhooks:manage"],
      run: wrap(async (args) =>
        jsonResult(
          await client.request("GET", `/api/v1/webhooks/${encodeURIComponent(String(args.webhookId))}/deliveries`),
        ),
      ),
    },
  ];
}
