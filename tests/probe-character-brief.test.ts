import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runProbe, ScenarioSchema } from "../scripts/probe-character-brief.js";
import type { CharacterRoll } from "../src/game/characterGenerator.js";

const SCENARIO_DIR = path.join(import.meta.dirname, "..", "scripts", "scenarios");

describe("ScenarioSchema validation", () => {
  it("accepts a well-formed ordinary scenario", () => {
    const data = {
      description: "Ordinary male character, no unusual traits",
      roll: {
        gender: "man",
        age: "adult",
        height: "average",
        build: "lean",
        skin: "fair",
        eyes: "brown",
        hair: "brown",
        fantasticalFeature: null,
        skinMarks: [],
      },
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(true);
  });

  it("accepts a scenario with fantastical feature and skin marks", () => {
    const data = {
      description: "Unusual character",
      roll: {
        gender: "woman",
        age: "young adult",
        height: "tall",
        build: "sturdy",
        skin: "iridescent",
        eyes: "vivid violet",
        hair: "silver",
        fantasticalFeature: "small horns (two symmetrical)",
        skinMarks: ["freckles (heavy)", "large tattoo"],
      },
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const data = { description: "Incomplete", roll: { gender: "man" } };
    expect(ScenarioSchema.safeParse(data).success).toBe(false);
  });

  it("rejects unknown top-level fields via .strict()", () => {
    const validRoll = {
      gender: "man",
      age: "adult",
      height: "average",
      build: "lean",
      skin: "fair",
      eyes: "brown",
      hair: "brown",
      fantasticalFeature: null,
      skinMarks: [],
    };
    const data = { description: "Test", roll: validRoll, extra: "bad" };
    expect(ScenarioSchema.safeParse(data).success).toBe(false);
  });

  it("rejects unknown roll fields via .strict()", () => {
    const data = {
      description: "Test",
      roll: {
        gender: "man",
        age: "adult",
        height: "average",
        build: "lean",
        skin: "fair",
        eyes: "brown",
        hair: "brown",
        fantasticalFeature: null,
        skinMarks: [],
        extra: "bad",
      },
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(false);
  });

  it("rejects wrong type for fantasticalFeature", () => {
    const data = {
      description: "Test",
      roll: {
        gender: "man",
        age: "adult",
        height: "average",
        build: "lean",
        skin: "fair",
        eyes: "brown",
        hair: "brown",
        fantasticalFeature: 42,
        skinMarks: [],
      },
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(false);
  });
});

describe("runProbe output", () => {
  const mockGenerateFn = vi.fn<(roll: CharacterRoll) => Promise<string>>();
  let tmpDir: string;

  afterEach(() => {
    vi.clearAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes a well-formed output file with the expected iteration count", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
    mockGenerateFn.mockResolvedValue("mock brief output");

    const scenarioPath = path.join(SCENARIO_DIR, "brief-ordinary.yaml");
    const result = await runProbe({
      scenarioPath,
      count: 10,
      generateFn: mockGenerateFn,
      outputDir: tmpDir,
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
    const content = fs.readFileSync(result.outputPath, "utf-8");

    expect(content).toContain("**Iterations:** 10");
    expect(result.successCount).toBe(10);
    expect(result.failureCount).toBe(0);

    expect(content).toContain("## Input");
    expect(content).toContain("## Prompt sent");
    expect(content).toContain("### System prompt");
    expect(content).toContain("### User prompt");
    expect(content).toContain("## Results");

    const iterationHeaders = content.match(/### Iteration \d+/g);
    expect(iterationHeaders).toHaveLength(10);

    expect(mockGenerateFn).toHaveBeenCalledTimes(10);
  });

  it("records failures when generateFn throws", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
    mockGenerateFn
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("whoops"))
      .mockResolvedValue("ok rest");

    const scenarioPath = path.join(SCENARIO_DIR, "brief-unusual.yaml");
    const result = await runProbe({
      scenarioPath,
      count: 5,
      generateFn: mockGenerateFn,
      outputDir: tmpDir,
    });

    const content = fs.readFileSync(result.outputPath, "utf-8");

    expect(result.successCount).toBe(4);
    expect(result.failureCount).toBe(1);
    expect(content).toContain("Iteration 2 — ERROR");
    expect(content).toContain("whoops");

    const iterationHeaders = content.match(/### Iteration \d+/g);
    expect(iterationHeaders).toHaveLength(5);
  });

  it("includes roll values from the scenario file in the Input section", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
    mockGenerateFn.mockResolvedValue("brief");

    const scenarioPath = path.join(SCENARIO_DIR, "brief-unusual.yaml");
    const result = await runProbe({
      scenarioPath,
      count: 1,
      generateFn: mockGenerateFn,
      outputDir: tmpDir,
    });

    const content = fs.readFileSync(result.outputPath, "utf-8");
    expect(content).toContain('gender: "woman"');
    expect(content).toContain(
      'fantasticalFeature: "small horns (two symmetrical)"'
    );
    expect(content).toContain('freckles (heavy)');
    expect(content).toContain('large tattoo');
  });

  it("creates the output directory if it doesn't exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
    const nestedDir = path.join(tmpDir, "subdir", "deep");
    mockGenerateFn.mockResolvedValue("brief");

    const scenarioPath = path.join(SCENARIO_DIR, "brief-ordinary.yaml");
    const result = await runProbe({
      scenarioPath,
      count: 1,
      generateFn: mockGenerateFn,
      outputDir: nestedDir,
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
  });
});
