import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { PromptBuilder } from "../src/engine/description/PromptBuilder.js";
import type { RoomContext } from "../src/engine/description/ContextBuilder.js";

const PROMPTS_DIR = path.join(import.meta.dirname, "..", "content", "prompts");

describe("PromptBuilder", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);
  });

  // Requirement: buildSystemPrompt("describe-room") includes storyteller.md content
  describe("buildSystemPrompt('describe-room')", () => {
    it("contains world context", () => {
      // unique phrase from world.md
      expect(builder.buildSystemPrompt("describe-room")).toContain("monastery");
    });

    it("contains storyteller voice", () => {
      // unique phrase from storyteller.md
      expect(builder.buildSystemPrompt("describe-room")).toContain(
        "been here a long time",
      );
    });

    it("contains describe-room role instructions", () => {
      // unique phrase from roles/describe-room.md
      expect(builder.buildSystemPrompt("describe-room")).toContain("present field");
    });

    it("does not contain character-brief role instructions", () => {
      // unique phrase from roles/character-brief.md must be absent
      expect(builder.buildSystemPrompt("describe-room")).not.toContain(
        "physical continuity record",
      );
    });
  });

  // Requirement: buildSystemPrompt("character-brief") does not include storyteller.md content
  // characterBriefGenerator calls buildSystemPrompt("character-brief", false)
  describe("buildSystemPrompt('character-brief', false)", () => {
    it("contains world context", () => {
      expect(builder.buildSystemPrompt("character-brief", false)).toContain("monastery");
    });

    it("contains brief-generator instructions", () => {
      // unique phrase from roles/brief-generator.md
      expect(builder.buildSystemPrompt("character-brief", false)).toContain(
        "prompt infrastructure",
      );
    });

    it("contains character-brief role instructions", () => {
      // unique phrase from roles/character-brief.md
      expect(builder.buildSystemPrompt("character-brief", false)).toContain(
        "physical continuity record",
      );
    });

    it("does not contain storyteller voice", () => {
      // "been here a long time" is the unique storyteller.md phrase
      expect(builder.buildSystemPrompt("character-brief", false)).not.toContain(
        "been here a long time",
      );
    });

    it("does not contain describe-room role instructions", () => {
      expect(builder.buildSystemPrompt("character-brief", false)).not.toContain(
        "present field",
      );
    });
  });

  // Requirement: buildSystemPrompt("describe") uses describe.md, not describe-room.md
  describe("buildSystemPrompt('describe')", () => {
    it("contains world context", () => {
      expect(builder.buildSystemPrompt("describe")).toContain("monastery");
    });

    it("contains storyteller voice", () => {
      expect(builder.buildSystemPrompt("describe")).toContain("been here a long time");
    });

    it("contains describe role instructions", () => {
      // unique phrase from roles/describe.md
      expect(builder.buildSystemPrompt("describe")).toContain("self-directed");
    });

    it("does not contain describe-room role instructions", () => {
      expect(builder.buildSystemPrompt("describe")).not.toContain("present field");
    });

    it("does not contain character-brief role instructions", () => {
      expect(builder.buildSystemPrompt("describe")).not.toContain("physical continuity record");
    });
  });

  // Requirement: buildSystemPrompt("describe-room") does not bleed into describe
  describe("describe vs describe-room isolation", () => {
    it("describe-room does not contain sense role instructions", () => {
      expect(builder.buildSystemPrompt("describe-room")).not.toContain("self-directed");
    });
  });

  // Requirement: world.md content appears in ALL system prompts regardless of role
  describe("world.md content — shared across all roles", () => {
    it("contains the body-difference line in every role", () => {
      const phrase = "Do not treat visible difference as proof of nature, origin, morality, or destiny";
      expect(builder.buildSystemPrompt("describe-room")).toContain(phrase);
      expect(builder.buildSystemPrompt("describe")).toContain(phrase);
      expect(builder.buildSystemPrompt("character-brief", false)).toContain(phrase);
      expect(builder.buildSystemPrompt("room-brief", false)).toContain(phrase);
    });

    it("contains playability constraints in every role", () => {
      // moved from character-brief.md task to world.md so all roles see it
      const phrase = "fit through a normal doorway";
      expect(builder.buildSystemPrompt("describe-room")).toContain(phrase);
      expect(builder.buildSystemPrompt("describe")).toContain(phrase);
      expect(builder.buildSystemPrompt("character-brief", false)).toContain(phrase);
      expect(builder.buildSystemPrompt("room-brief", false)).toContain(phrase);
    });
  });

  // Requirement: storyteller.md contains the character brief usage guidance
  describe("storyteller.md content", () => {
    it("contains character brief usage guidance", () => {
      expect(builder.buildSystemPrompt("describe-room")).toContain(
        "Use character briefs as continuity records, not scripts",
      );
    });

    it("contains the appearance inference prohibition", () => {
      const phrase =
        "Do not infer personality, backstory, social role, health, morality, species, ancestry, culture, origin, or destiny from appearance";
      expect(builder.buildSystemPrompt("describe-room")).toContain(phrase);
    });

    it("is absent from character-brief prompt", () => {
      expect(builder.buildSystemPrompt("character-brief", false)).not.toContain(
        "Use character briefs as continuity records, not scripts",
      );
    });
  });

  // Requirement: task-layer content does not bleed into other tasks
  describe("task layer isolation", () => {
    it("character-brief task content is absent from describe-room and describe prompts", () => {
      // "forgettable" is unique to character-brief.md
      expect(builder.buildSystemPrompt("describe-room")).not.toContain("forgettable");
      expect(builder.buildSystemPrompt("describe")).not.toContain("forgettable");
    });

    it("describe task content (self-directed) is absent from describe-room and brief prompts", () => {
      expect(builder.buildSystemPrompt("describe-room")).not.toContain("self-directed");
      expect(builder.buildSystemPrompt("character-brief", false)).not.toContain("self-directed");
      expect(builder.buildSystemPrompt("room-brief", false)).not.toContain("self-directed");
    });

    it("describe-room task content (present field) is absent from describe and brief prompts", () => {
      expect(builder.buildSystemPrompt("describe")).not.toContain("present field");
      expect(builder.buildSystemPrompt("character-brief", false)).not.toContain("present field");
      expect(builder.buildSystemPrompt("room-brief", false)).not.toContain("present field");
    });

    it("room-brief task content (REVEAL) is absent from storyteller prompts", () => {
      // REVEAL keyword is unique to room-brief.md
      expect(builder.buildSystemPrompt("describe-room")).not.toContain("REVEAL");
      expect(builder.buildSystemPrompt("describe")).not.toContain("REVEAL");
    });
  });

  // Requirement: brief-generator role content appears in brief tasks but not storyteller tasks
  describe("brief-generator role layer", () => {
    it("'prompt infrastructure' appears in brief tasks but not storyteller tasks", () => {
      expect(builder.buildSystemPrompt("character-brief", false)).toContain("prompt infrastructure");
      expect(builder.buildSystemPrompt("room-brief", false)).toContain("prompt infrastructure");
      expect(builder.buildSystemPrompt("describe-room")).not.toContain("prompt infrastructure");
      expect(builder.buildSystemPrompt("describe")).not.toContain("prompt infrastructure");
    });
  });

  describe("loadPromptFiles", () => {
    it("replaces content on reload from the same directory", () => {
      const before = builder.buildSystemPrompt("describe-room");
      builder.loadPromptFiles(PROMPTS_DIR);
      expect(builder.buildSystemPrompt("describe-room")).toBe(before);
    });

    it("produces different output for the two roles after loading", () => {
      const room = builder.buildSystemPrompt("describe-room");
      const brief = builder.buildSystemPrompt("character-brief", false);
      expect(room).not.toBe(brief);
    });
  });
});

// ---------------------------------------------------------------------------
// Item brief blocks in user prompts
// ---------------------------------------------------------------------------

function minimalCtx(overrides: Partial<RoomContext> = {}): RoomContext {
  return {
    roomName: "The Kitchen",
    roomBrief: "A stone kitchen.",
    roomShort: "A stone kitchen.",
    entitiesPresent: [],
    otherPlayers: [],
    isFirstVisit: false,
    timeOfDay: "morning",
    moonPhase: "new",
    moonAboveHorizon: false,
    weather: "clear",
    exits: {},
    characterBriefs: [],
    roomItemBriefs: [],
    inventoryItemBriefs: [],
    ...overrides,
  };
}

describe("buildRoomUserPrompt — item briefs", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);
  });

  it("omits [ITEMS] block when no room items have ItemBrief", () => {
    const output = builder.buildRoomUserPrompt(minimalCtx(), "look");
    expect(output).not.toContain("[ITEMS]");
  });

  it("includes [ITEMS] block when room items have ItemBrief", () => {
    const ctx = minimalCtx({
      roomItemBriefs: [
        {
          short: "a Coleman lantern",
          brief: "A battered lantern, fuel sloshing inside.",
          state: { lit: false, oil: "full" },
          location: "in room",
        },
      ],
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("[ITEMS]");
    expect(output).toContain("[ITEM: a Coleman lantern]");
    expect(output).toContain("A battered lantern, fuel sloshing inside.");
    expect(output).toContain("lit=false");
    expect(output).toContain("oil=full");
    expect(output).toContain("POSITION: in room");
  });

  it("omits STATE line when item has no state", () => {
    const ctx = minimalCtx({
      roomItemBriefs: [
        { short: "a coin", brief: "A gold coin.", location: "in room" },
      ],
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("[ITEM: a coin]");
    expect(output).toContain("POSITION: in room");
    // [ENVIRONMENT] always emits STATE:; verify no item-level STATE appears
    expect(output).not.toMatch(/\[ITEM:[^\]]*\][^}]*STATE:/s);
  });

  it("omits placedAt from state display", () => {
    const ctx = minimalCtx({
      roomItemBriefs: [
        {
          short: "a widget",
          brief: "A widget.",
          state: { placedAt: 12345, lit: true },
          location: "in room",
        },
      ],
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).not.toContain("placedAt");
    expect(output).toContain("lit=true");
  });

  it("does not include inventory items in room prompt", () => {
    const ctx = minimalCtx({
      inventoryItemBriefs: [
        { short: "a gold coin", brief: "A coin.", location: "carried by Maren" },
      ],
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).not.toContain("[ITEMS]");
    expect(output).not.toContain("a gold coin");
  });
});

describe("buildSenseUserPrompt — item briefs", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);
  });

  it("omits [ITEMS] block when no items have briefs", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Maren",
      characterBriefs: [{ name: "Maren", brief: "Tall, dark-haired." }],
    });
    const output = builder.buildSenseUserPrompt(ctx, "look");
    expect(output).not.toContain("[ITEMS]");
  });

  it("includes room items and inventory items together in [ITEMS]", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Maren",
      characterBriefs: [{ name: "Maren", brief: "Tall, dark-haired." }],
      roomItemBriefs: [
        {
          short: "a Coleman lantern",
          brief: "A battered lantern.",
          state: { lit: false },
          location: "in room",
        },
      ],
      inventoryItemBriefs: [
        { short: "a gold coin", brief: "A coin.", location: "carried by Maren" },
      ],
    });
    const output = builder.buildSenseUserPrompt(ctx, "look around");
    expect(output).toContain("[ITEMS]");
    expect(output).toContain("[ITEM: a Coleman lantern]");
    expect(output).toContain("POSITION: in room");
    expect(output).toContain("[ITEM: a gold coin]");
    expect(output).toContain("CARRIED");
    expect(output).not.toContain("POSITION: carried by");
  });

  it("includes only inventory items when room has none with briefs", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Maren",
      characterBriefs: [{ name: "Maren", brief: "Tall." }],
      inventoryItemBriefs: [
        { short: "a coin", brief: "A gold coin.", location: "carried by Maren" },
      ],
    });
    const output = builder.buildSenseUserPrompt(ctx, "inventory");
    expect(output).toContain("[ITEMS]");
    expect(output).toContain("[ITEM: a coin]");
    expect(output).toContain("CARRIED");
    expect(output).not.toContain("POSITION: carried by");
  });

  it("omits placedAt from sense prompt state too", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Maren",
      characterBriefs: [{ name: "Maren", brief: "Tall." }],
      roomItemBriefs: [
        {
          short: "a lantern",
          brief: "A lantern.",
          state: { placedAt: 99999, lit: false },
          location: "in room",
        },
      ],
    });
    const output = builder.buildSenseUserPrompt(ctx, "look at lantern");
    expect(output).not.toContain("placedAt");
    expect(output).toContain("lit=false");
  });
});

// ---------------------------------------------------------------------------
// ENVIRONMENT block — zone name and brief
// ---------------------------------------------------------------------------

describe("buildRoomUserPrompt — ENVIRONMENT block", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);
  });

  it("renders [ENVIRONMENT] without zone name when none is provided", () => {
    const output = builder.buildRoomUserPrompt(minimalCtx(), "look");
    expect(output).toContain("[ENVIRONMENT]");
    expect(output).not.toContain("[ENVIRONMENT:");
  });

  it("renders [ENVIRONMENT: zoneName] when zone name is provided", () => {
    const ctx = minimalCtx({ zoneName: "Alpine Monastery" });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("[ENVIRONMENT: Alpine Monastery]");
  });

  it("includes zone brief content when provided", () => {
    const ctx = minimalCtx({
      zoneName: "Alpine Monastery",
      zoneBrief: "High-elevation alpine zone. Cold winters, mild summers.",
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("High-elevation alpine zone.");
    expect(output).toContain("Cold winters, mild summers.");
  });

  it("brief appears before STATE line in the ENVIRONMENT block", () => {
    const ctx = minimalCtx({
      zoneName: "Alpine Monastery",
      zoneBrief: "High-elevation alpine zone.",
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    const briefIdx = output.indexOf("High-elevation alpine zone.");
    const stateIdx = output.indexOf("STATE:");
    expect(briefIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeGreaterThan(briefIdx);
  });

  it("STATE line is always present regardless of zone", () => {
    const output = builder.buildRoomUserPrompt(minimalCtx(), "look");
    expect(output).toContain("STATE:");
    expect(output).toContain("time=morning");
  });

  it("multi-line zone brief renders each line indented", () => {
    const ctx = minimalCtx({
      zoneName: "Test Zone",
      zoneBrief: "First paragraph line.\n\nSecond paragraph line.",
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("  First paragraph line.");
    expect(output).toContain("  Second paragraph line.");
  });

  it("sense prompt also renders zone name and brief in ENVIRONMENT block", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Aria",
      characterBriefs: [{ name: "Aria", brief: "Tall woman." }],
      zoneName: "Alpine Monastery",
      zoneBrief: "High-elevation alpine zone.",
    });
    const output = builder.buildSenseUserPrompt(ctx, "look around");
    expect(output).toContain("[ENVIRONMENT: Alpine Monastery]");
    expect(output).toContain("High-elevation alpine zone.");
  });
});
