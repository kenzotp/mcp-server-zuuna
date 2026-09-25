import { describe, expect, it } from "vitest";

import {
  FIXTURE,
  callTool,
  fixtureHandler,
  makeTools,
  resolveToolsForToken,
  resultJson,
} from "./helpers.js";

// ZNA-2168 — zuuna_me's hiddenTools: every tool the token's scopes hide, each
// with the scope(s) that would unlock it, from the same catalog
// resolveToolsForToken filters. Fully mocked, no network.

interface MeBody {
  tokenId: string;
  scopes: string[];
  hiddenTools: { name: string; scopes: string[] }[];
}

async function meWithScopes(scopes: string[]): Promise<MeBody> {
  const handler = fixtureHandler({
    "GET /api/v1/me": { status: 200, json: { ...FIXTURE.meReadOnly, scopes } },
  });
  const { tools } = makeTools(handler);
  return (await resultJson(await callTool(tools, "zuuna_me"))) as MeBody;
}

describe("zuuna_me hiddenTools", () => {
  it("a token with the full scope catalog gets an empty hiddenTools list", async () => {
    const { tools } = makeTools(fixtureHandler());
    const body = (await resultJson(await callTool(tools, "zuuna_me"))) as MeBody;
    expect(body.tokenId).toBe(FIXTURE.me.tokenId);
    expect(body.hiddenTools).toEqual([]);
  });

  it("a read-only token sees exactly the write tools it lacks, each with the missing scope", async () => {
    const body = await meWithScopes(["boards:read", "cards:read", "comments:read", "time:read"]);
    const byName = new Map(body.hiddenTools.map((h) => [h.name, h.scopes]));
    expect(byName.get("zuuna_create_card")).toEqual(["cards:write"]);
    expect(byName.get("zuuna_comment")).toEqual(["comments:write"]);
    expect(byName.get("zuuna_board")).toBeUndefined(); // both of its scopes are granted
    expect(byName.get("zuuna_me")).toBeUndefined(); // zero-scope tools are never hidden
  });

  it("a tool hidden for two scopes lists both", async () => {
    const body = await meWithScopes([]);
    const board = body.hiddenTools.find((h) => h.name === "zuuna_board");
    expect(board?.scopes.sort()).toEqual(["boards:read", "cards:read"]);
  });

  it("hiddenTools is exactly the complement of what resolveToolsForToken registers", async () => {
    const handler = fixtureHandler({
      "GET /api/v1/me": { status: 200, json: { ...FIXTURE.meReadOnly, scopes: ["cards:read"] } },
    });
    const { all, client } = makeTools(handler);
    const { tools } = await resolveToolsForToken(client, all);
    const registered = new Set(tools.map((t) => t.name));

    const fresh = makeTools(handler);
    const body = (await resultJson(await callTool(fresh.tools, "zuuna_me"))) as MeBody;
    const hidden = new Set(body.hiddenTools.map((h) => h.name));

    for (const tool of all) {
      expect(registered.has(tool.name)).toBe(!hidden.has(tool.name));
    }
  });
});
