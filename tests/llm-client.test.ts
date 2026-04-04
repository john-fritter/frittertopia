import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMClient } from "../src/engine/LLMClient.js";

function makeResponse(
  status: number,
  body: unknown,
  ok = status >= 200 && status < 300
): Response {
  return {
    ok,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makeSuccessBody(text: string) {
  return { choices: [{ message: { content: text } }] };
}

describe("LLMClient", () => {
  beforeEach(() => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    delete process.env["OPENROUTER_MODEL"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["OPENROUTER_MODEL"];
  });

  it("returns generated text on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(200, makeSuccessBody("The fog thins.")))
    );

    const client = new LLMClient();
    const result = await client.generate("You are a narrator.", "Describe the fog.");

    expect(result).toEqual({ ok: true, text: "The fog thins." });
  });

  it("passes system and user prompts in the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, makeSuccessBody("ok")));
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient();
    await client.generate("sys", "usr");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "usr" });
  });

  it("respects model/maxTokens/temperature overrides", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, makeSuccessBody("ok")));
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient();
    await client.generate("sys", "usr", {
      model: "openai/gpt-4o-mini",
      maxTokens: 100,
      temperature: 0.1,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.1);
  });

  it("returns error result on non-2xx API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(429, "rate limited", false))
    );

    const client = new LLMClient();
    const result = await client.generate("sys", "usr");

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch("429");
  });

  it("returns error result on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const client = new LLMClient();
    const result = await client.generate("sys", "usr");

    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("returns error result on timeout (AbortError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }))
    );

    const client = new LLMClient();
    const result = await client.generate("sys", "usr");

    expect(result).toEqual({ ok: false, error: "Request timed out after 10 seconds" });
  });

  it("returns error result when API key is missing", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = new LLMClient();
    const result = await client.generate("sys", "usr");

    expect(result).toEqual({ ok: false, error: "OPENROUTER_API_KEY is not configured" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("OPENROUTER_API_KEY"));
  });

  it("does not throw — callers always get a result object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const client = new LLMClient();
    await expect(client.generate("sys", "usr")).resolves.toMatchObject({ ok: false });
  });

  it("uses OPENROUTER_MODEL env var as default model", async () => {
    process.env["OPENROUTER_MODEL"] = "anthropic/claude-haiku";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, makeSuccessBody("ok")));
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient();
    await client.generate("sys", "usr");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("anthropic/claude-haiku");
  });
});
