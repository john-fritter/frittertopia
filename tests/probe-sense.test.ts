import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ScenarioSchema, runSenseProbe } from "../scripts/probe-sense.js";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";

function makeWorld(roomKey: string): World {
  const world = new World();
  registerComponents(world);

  const worldTimeId = world.createEntity("world.time");
  world.addComponent(worldTimeId, "TimeOfDay", {
    bracket: "morning",
    moonFraction: 0.5,
    moonPhase: "third_quarter",
    updatedAt: new Date().toISOString(),
  });

  const roomId = world.createEntity(roomKey);
  world.addComponent(roomId, "Room", { name: "Test Room" });
  world.addComponent(roomId, "Description", { short: "a test room" });
  world.addComponent(roomId, "RoomBrief", { brief: "A room for testing purposes." });

  return world;
}

describe("ScenarioSchema validation", () => {
  it("accepts a well-formed scenario", () => {
    const data = {
      description: "Test scenario",
      roomKey: "test.room",
      currentPlayer: {
        name: "anon",
        brief: "CANON:\n- Woman, adult.",
      },
      calls: [{ role: "describe-room", count: 1 }],
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(true);
  });

  it("accepts scenario with all optional fields", () => {
    const data = {
      description: "Full test",
      roomKey: "test.room",
      overrides: {
        time: { bracket: "afternoon", moonPhase: "full", moonAboveHorizon: false },
        weather: { tempC: 10, precipState: "rain", pressureMb: 1000, pressureTrend: "falling" },
      },
      currentPlayer: {
        name: "anon",
        roll: { gender: "man", age: "adult", height: "average", build: "lean", skin: "fair", eyes: "brown", hair: "brown", fantasticalFeature: null, skinMarks: [] },
      },
      otherPlayers: [{ name: "other", brief: "Other person." }],
      items: [{ shortDescription: "a coin", brief: "A gold coin.", presence: "A coin on the floor." }],
      calls: [
        { role: "describe-room", count: 2 },
        { role: "describe", input: "look", count: 3 },
      ],
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(true);
  });

  it("accepts describe calls without input", () => {
    const data = {
      description: "No input",
      roomKey: "test.room",
      currentPlayer: { name: "anon", brief: "A person." },
      calls: [{ role: "describe", count: 1 }],
    };
    const result = ScenarioSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects missing roomKey", () => {
    const data = {
      description: "No room",
      currentPlayer: { name: "anon", brief: "A person." },
      calls: [{ role: "describe-room", count: 1 }],
    };
    expect(ScenarioSchema.safeParse(data).success).toBe(false);
  });

  it("rejects player with both brief and roll", () => {
    const data = {
      description: "Both",
      roomKey: "test.room",
      currentPlayer: {
        name: "anon",
        brief: "Some brief.",
        roll: { gender: "man", age: "adult", height: "average", build: "lean", skin: "fair", eyes: "brown", hair: "brown", fantasticalFeature: null, skinMarks: [] },
      },
      calls: [{ role: "describe-room", count: 1 }],
    };
    const result = ScenarioSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects player with neither brief nor roll", () => {
    const data = {
      description: "Neither",
      roomKey: "test.room",
      currentPlayer: { name: "anon" },
      calls: [{ role: "describe-room", count: 1 }],
    };
    const result = ScenarioSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    const data = {
      description: "Extra",
      roomKey: "test.room",
      currentPlayer: { name: "anon", brief: "A person." },
      calls: [{ role: "describe-room", count: 1 }],
      extraField: "bad",
    };
    const result = ScenarioSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects otherPlayer with both brief and roll", () => {
    const data = {
      description: "Other both",
      roomKey: "test.room",
      currentPlayer: { name: "anon", brief: "A person." },
      otherPlayers: [{
        name: "other",
        brief: "Brief.",
        roll: { gender: "man", age: "adult", height: "average", build: "lean", skin: "fair", eyes: "brown", hair: "brown", fantasticalFeature: null, skinMarks: [] },
      }],
      calls: [{ role: "describe-room", count: 1 }],
    };
    const result = ScenarioSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("runSenseProbe output", () => {
  let world: World;
  let tmpDir: string;

  beforeEach(() => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    world = makeWorld("test.room");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["OPENROUTER_API_KEY"];
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes a well-formed output file with expected structure", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-sense-test-"));

    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "mock description text" });

    const result = await runSenseProbe({
      world,
      scenario: {
        description: "Test scenario",
        roomKey: "test.room",
        currentPlayer: { name: "Tester", brief: "A test player." },
        otherPlayers: [{ name: "Other1", brief: "Another player." }],
        calls: [
          { role: "describe-room", count: 2 },
          { role: "describe", input: "look self", count: 3 },
        ],
      },
      scenarioStem: "test-scenario",
      outputDir: tmpDir,
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
    const content = fs.readFileSync(result.outputPath, "utf-8");

    expect(content).toContain("# Sense Probe —");
    expect(content).toContain("test-scenario.yaml");
    expect(content).toContain("**Description:** Test scenario");
    expect(content).toContain("## World state");
    expect(content).toContain("**Room:** test.room (Test Room)");
    expect(content).toContain("**Current player:** Tester");
    expect(content).toContain("**Other players:** Other1");
    expect(content).toContain("## Call 1: describe-room (×2)");
    expect(content).toContain("## Call 2: describe — \"look self\" (×3)");

    const call1Headers = content.match(/### Iteration \d+/g);
    expect(call1Headers).toHaveLength(5);

    expect(content).toContain("### System prompt");
    expect(content).toContain("### User prompt");
    expect(content).toContain("mock description text");
  });

  it("reports correct success and failure counts", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-sense-test-"));

    const generateMock = vi.spyOn(world.llm, "generate");
    generateMock
      .mockResolvedValueOnce({ ok: true, text: "ok 1" })
      .mockResolvedValueOnce({ ok: true, text: "ok 2" })
      .mockResolvedValueOnce({ ok: true, text: "ok 3" });

    const result = await runSenseProbe({
      world,
      scenario: {
        description: "Mixed",
        roomKey: "test.room",
        currentPlayer: { name: "Tester", brief: "A player." },
        calls: [
          { role: "describe-room", count: 3 },
        ],
      },
      outputDir: tmpDir,
    });

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(generateMock).toHaveBeenCalledTimes(3);

    const content = fs.readFileSync(result.outputPath, "utf-8");
    const iterationHeaders = content.match(/### Iteration \d+/g);
    expect(iterationHeaders).toHaveLength(3);
  });

  it("creates the output directory if it doesn't exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-sense-test-"));
    const nestedDir = path.join(tmpDir, "subdir", "deep");

    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "ok" });

    const result = await runSenseProbe({
      world,
      scenario: {
        description: "Nested dir",
        roomKey: "test.room",
        currentPlayer: { name: "Tester", brief: "A player." },
        calls: [{ role: "describe-room", count: 1 }],
      },
      outputDir: nestedDir,
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  it("throws error for unknown room key", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-sense-test-"));

    await expect(
      runSenseProbe({
        world,
        scenario: {
          description: "Bad room",
          roomKey: "nonexistent.room",
          currentPlayer: { name: "Tester", brief: "A player." },
          calls: [{ role: "describe-room", count: 1 }],
        },
        outputDir: tmpDir,
      }),
    ).rejects.toThrow(/nonexistent\.room/);
  });

  it("handles LLM errors gracefully — fallback text returned, counted as success", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-sense-test-"));

    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: false, error: "API error 500" });

    const result = await runSenseProbe({
      world,
      scenario: {
        description: "All fail",
        roomKey: "test.room",
        currentPlayer: { name: "Tester", brief: "A player." },
        calls: [{ role: "describe-room", count: 3 }],
      },
      outputDir: tmpDir,
    });

    // describe/describeSense never throw — they return fallback text on LLM error.
    // The probe records these as successes because a string was returned.
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);

    const content = fs.readFileSync(result.outputPath, "utf-8");
    expect(content).toContain("Iteration 1");
    expect(content).toContain("Iteration 2");
    expect(content).toContain("Iteration 3");
    expect(content).not.toContain("ERROR");
  });
});
