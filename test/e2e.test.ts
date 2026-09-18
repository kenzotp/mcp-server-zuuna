import { describe, expect, it } from "vitest";
import { ZuunaClient } from "../src/client.js";

/**
 * OPTIONAL live E2E — strictly READ-ONLY.
 *
 * Runs only when explicitly enabled and a token is provided:
 *
 *   ZUUNA_E2E=1 ZUUNA_API_TOKEN=... npm run test:e2e
 *
 * It hits exactly two endpoints, both reads: GET /api/v1/me and
 * GET /api/v1/boards. No cards are created, moved or commented on.
 * Override the target with ZUUNA_BASE_URL (e.g. a staging host).
 */
const enabled = process.env.ZUUNA_E2E === "1" && !!process.env.ZUUNA_API_TOKEN;
const suite = enabled ? describe : describe.skip;

suite("E2E against a live Zuuna (read-only: /me and /boards only)", () => {
  const client = new ZuunaClient({
    baseUrl: process.env.ZUUNA_BASE_URL,
    token: process.env.ZUUNA_API_TOKEN as string,
    timeoutMs: 20_000,
  });

  it("GET /api/v1/me returns the token identity", async () => {
    const me = await client.me();
    expect(me.tokenId).toBeTruthy();
    expect(Array.isArray(me.scopes)).toBe(true);
  });

  it("GET /api/v1/boards returns a list", async () => {
    const res = await client.boards();
    expect(Array.isArray(res.data)).toBe(true);
  });
});
