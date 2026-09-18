import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, ZuunaApiError, ZuunaClient, ZuunaNetworkError } from "../src/client.js";
import { FIXTURE, makeClient, mockFetch } from "./helpers.js";

describe("ZuunaClient", () => {
  it("sends the Bearer token, Accept and JSON content type to the right URL", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: FIXTURE.me }));
    await client.me();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/me");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_test");
    expect(calls[0].headers.Accept).toBe("application/json");

    const post = makeClient(() => ({ status: 201, json: FIXTURE.createdCard }));
    await post.client.createCard("b1", { title: "New card" });
    expect(post.calls[0].method).toBe("POST");
    expect(post.calls[0].headers["Content-Type"]).toBe("application/json");
    expect(post.calls[0].body).toEqual({ title: "New card" });
  });

  it("encodes path segments", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: FIXTURE.cardDetail }));
    await client.card("ZNA-2001");
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/cards/ZNA-2001");
  });

  it("rejects with the API's envelope on 401", async () => {
    const { client } = makeClient(() => FIXTURE.unauthorized);
    await expect(client.me()).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: FIXTURE.unauthorized.json.message,
    });
  });

  it("rejects with the API's envelope on 404", async () => {
    const { client } = makeClient(() => FIXTURE.notFoundCard);
    await expect(client.card("ZNA-9999")).rejects.toBeInstanceOf(ZuunaApiError);
    await expect(client.card("ZNA-9999")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "Card not found.",
    });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    const { impl } = mockFetch(() => ({ status: 500, json: { error: "boom" } }));
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl: impl });
    // Respond with a non-JSON body this time.
    const failing = new ZuunaClient({
      baseUrl: "https://zuuna.test",
      token: "t",
      fetchImpl: (async () => new Response("<html>gateway error</html>", { status: 502 })) as typeof fetch,
    });
    await expect(client.me()).rejects.toMatchObject({ status: 500, code: "boom" });
    await expect(failing.me()).rejects.toMatchObject({ status: 502, code: "http_502" });
  });

  it("wraps network failures in ZuunaNetworkError", async () => {
    const { client } = makeClient(() => ({ networkError: "ECONNREFUSED" }));
    await expect(client.boards()).rejects.toBeInstanceOf(ZuunaNetworkError);
    await expect(client.boards()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("times out and does not retry", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      })) as unknown as typeof fetch;
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl, timeoutMs: 30 });
    await expect(client.me()).rejects.toBeInstanceOf(ZuunaNetworkError);
    await expect(client.me()).rejects.toThrow(/timed out|aborted/i);
  });

  it("uses the documented default base URL", () => {
    expect(DEFAULT_BASE_URL).toBe("https://app.zuuna.de");
  });
});
