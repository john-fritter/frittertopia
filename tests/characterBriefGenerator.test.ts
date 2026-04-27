import { describe, it, expect, afterEach, vi } from "vitest";
import { client, generateCharacterBrief } from "../src/game/characterBriefGenerator.js";
import type { CharacterRoll } from "../src/game/characterGenerator.js";

const sampleRoll: CharacterRoll = {
  gender: "female",
  age: "adult",
  height: "average",
  build: "average",
  skin: "warm beige",
  eyes: "hazel",
  hair: "auburn",
  fantasticalFeature: "pointed ears",
  skinMarks: ["small tattoo"],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateCharacterBrief — success path", () => {
  it("returns a non-empty string on LLM success", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({
      ok: true,
      text: "A woman in her early thirties, average build.",
    });
    const result = await generateCharacterBrief(sampleRoll);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the LLM text unchanged", async () => {
    const text = "A woman in her early thirties, average build.";
    vi.spyOn(client, "generate").mockResolvedValue({ ok: true, text });
    expect(await generateCharacterBrief(sampleRoll)).toBe(text);
  });

  it("stops retrying after the first success", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValueOnce({ ok: false, error: "fail" })
      .mockResolvedValueOnce({ ok: true, text: "Success on second try." });
    const result = await generateCharacterBrief(sampleRoll);
    expect(result).toBe("Success on second try.");
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("generateCharacterBrief — failure path", () => {
  it("returns a non-empty string when LLM fails", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "API error 500" });
    const result = await generateCharacterBrief(sampleRoll);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("retries MAX_RETRIES times before returning fallback", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: false, error: "fail" });
    await generateCharacterBrief(sampleRoll);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("fallback contains gender, age, build, skin, eyes, and hair", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "fail" });
    const result = await generateCharacterBrief(sampleRoll);
    expect(result).toContain("female");
    expect(result).toContain("adult");
    expect(result).toContain("average");
    expect(result).toContain("warm beige");
    expect(result).toContain("hazel");
    expect(result).toContain("auburn");
  });

  it("fallback includes fantastical feature when present", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "fail" });
    const result = await generateCharacterBrief(sampleRoll);
    expect(result).toContain("pointed ears");
  });

  it("fallback omits fantastical feature when null", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "fail" });
    const noFeatureRoll: CharacterRoll = { ...sampleRoll, fantasticalFeature: null };
    const result = await generateCharacterBrief(noFeatureRoll);
    expect(result).not.toContain("null");
    expect(result).not.toContain("Fantastical feature:");
  });

  it("fallback includes skin marks when present", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "fail" });
    const result = await generateCharacterBrief(sampleRoll);
    expect(result).toContain("small tattoo");
  });

  it("fallback omits skin marks section when array is empty", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "fail" });
    const noMarksRoll: CharacterRoll = { ...sampleRoll, skinMarks: [] };
    const result = await generateCharacterBrief(noMarksRoll);
    expect(result).not.toContain("Marks:");
  });

  it("never throws — returns a string even when generate rejects", async () => {
    vi.spyOn(client, "generate").mockRejectedValue(new Error("network failure"));
    await expect(generateCharacterBrief(sampleRoll)).resolves.toEqual(expect.any(String));
  });

  it("fallback does not contain error language", async () => {
    vi.spyOn(client, "generate").mockResolvedValue({ ok: false, error: "API error 429" });
    const result = await generateCharacterBrief(sampleRoll);
    const lower = result.toLowerCase();
    expect(lower).not.toContain("error");
    expect(lower).not.toContain("api");
    expect(lower).not.toContain("fail");
    expect(lower).not.toContain("429");
  });
});

describe("generateCharacterBrief — user prompt contents", () => {
  it("user prompt contains all rolled traits", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: true, text: "brief" });
    await generateCharacterBrief(sampleRoll);
    const userPrompt = mock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("female");
    expect(userPrompt).toContain("adult");
    expect(userPrompt).toContain("average");
    expect(userPrompt).toContain("warm beige");
    expect(userPrompt).toContain("hazel");
    expect(userPrompt).toContain("auburn");
    expect(userPrompt).toContain("pointed ears");
  });

  it("fantastical feature appears in user prompt when present", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: true, text: "brief" });
    await generateCharacterBrief(sampleRoll);
    const userPrompt = mock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("pointed ears");
  });

  it("user prompt shows 'none' for fantastical feature when null", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: true, text: "brief" });
    const noFeatureRoll: CharacterRoll = { ...sampleRoll, fantasticalFeature: null };
    await generateCharacterBrief(noFeatureRoll);
    const userPrompt = mock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("none");
    expect(userPrompt).not.toContain("null");
  });

  it("user prompt includes skin marks when array is non-empty", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: true, text: "brief" });
    await generateCharacterBrief(sampleRoll);
    const userPrompt = mock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("Skin marks:");
    expect(userPrompt).toContain("small tattoo");
  });

  it("user prompt omits skin marks field entirely when array is empty", async () => {
    const mock = vi
      .spyOn(client, "generate")
      .mockResolvedValue({ ok: true, text: "brief" });
    const noMarksRoll: CharacterRoll = { ...sampleRoll, skinMarks: [] };
    await generateCharacterBrief(noMarksRoll);
    const userPrompt = mock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).not.toContain("Skin marks:");
    expect(userPrompt).not.toContain("none"); // field omitted entirely, not set to "none"
  });
});
