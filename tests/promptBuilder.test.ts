import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { PromptBuilder } from "../src/engine/description/PromptBuilder.js";

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
