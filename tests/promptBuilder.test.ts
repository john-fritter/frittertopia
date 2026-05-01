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
      expect(builder.buildSystemPrompt("describe-room")).toContain("Present list");
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
        "Present list",
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
      expect(builder.buildSystemPrompt("describe")).not.toContain("Present list");
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

  // Requirement: world.md contains the body-difference line
  describe("world.md content", () => {
    it("contains the basic biology / body-difference line", () => {
      const phrase = "Do not treat visible difference as proof of nature, origin, morality, or destiny";
      expect(builder.buildSystemPrompt("describe-room")).toContain(phrase);
      expect(builder.buildSystemPrompt("character-brief", false)).toContain(phrase);
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

  it("omits item block when no room items have ItemBrief", () => {
    const output = builder.buildRoomUserPrompt(minimalCtx(), "look");
    expect(output).not.toContain("Item details:");
  });

  it("includes item details block when room items have ItemBrief", () => {
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
    expect(output).toContain("Item details:");
    expect(output).toContain("a Coleman lantern (in room)");
    expect(output).toContain("A battered lantern, fuel sloshing inside.");
    expect(output).toContain("lit=false");
    expect(output).toContain("oil=full");
  });

  it("omits state line when item has no state", () => {
    const ctx = minimalCtx({
      roomItemBriefs: [
        { short: "a coin", brief: "A gold coin.", location: "in room" },
      ],
    });
    const output = builder.buildRoomUserPrompt(ctx, "look");
    expect(output).toContain("a coin (in room)");
    expect(output).not.toContain("State:");
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
    expect(output).not.toContain("Item details:");
    expect(output).not.toContain("a gold coin");
  });
});

describe("buildSenseUserPrompt — item briefs", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);
  });

  it("omits item block when no items have briefs", () => {
    const ctx = minimalCtx({
      currentPlayerName: "Maren",
      characterBriefs: [{ name: "Maren", brief: "Tall, dark-haired." }],
    });
    const output = builder.buildSenseUserPrompt(ctx, "look");
    expect(output).not.toContain("ITEM DETAILS:");
  });

  it("includes room items and inventory items together", () => {
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
    expect(output).toContain("ITEM DETAILS:");
    expect(output).toContain("<<<");
    expect(output).toContain(">>>");
    expect(output).toContain("a Coleman lantern (in room)");
    expect(output).toContain("a gold coin (carried by Maren)");
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
    expect(output).toContain("ITEM DETAILS:");
    expect(output).toContain("a coin (carried by Maren)");
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
