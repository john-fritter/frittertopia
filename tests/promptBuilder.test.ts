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

  describe("buildSystemPrompt('character-brief')", () => {
    it("contains world context", () => {
      expect(builder.buildSystemPrompt("character-brief")).toContain("monastery");
    });

    it("contains storyteller voice", () => {
      expect(builder.buildSystemPrompt("character-brief")).toContain(
        "been here a long time",
      );
    });

    it("contains character-brief role instructions", () => {
      // unique phrase from roles/character-brief.md
      expect(builder.buildSystemPrompt("character-brief")).toContain(
        "physical continuity record",
      );
    });

    it("does not contain describe-room role instructions", () => {
      // unique phrase from roles/describe-room.md must be absent
      expect(builder.buildSystemPrompt("character-brief")).not.toContain(
        "Present list",
      );
    });
  });

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
  });

  describe("world.md additions", () => {
    it("contains the bodies/difference line in describe-room", () => {
      expect(builder.buildSystemPrompt("describe-room")).toContain(
        "Do not treat visible difference as proof of nature, origin, morality, or destiny",
      );
    });

    it("contains the bodies/difference line in character-brief", () => {
      expect(builder.buildSystemPrompt("character-brief")).toContain(
        "Do not treat visible difference as proof of nature, origin, morality, or destiny",
      );
    });
  });

  describe("storyteller.md additions", () => {
    it("contains the character-brief-as-continuity-record line in describe-room", () => {
      expect(builder.buildSystemPrompt("describe-room")).toContain(
        "Use character briefs as continuity records, not scripts",
      );
    });

    it("contains the character-brief-as-continuity-record line in character-brief", () => {
      expect(builder.buildSystemPrompt("character-brief")).toContain(
        "Use character briefs as continuity records, not scripts",
      );
    });

    it("contains the appearance inference prohibition in both prompts", () => {
      const phrase =
        "Do not infer personality, backstory, social role, health, morality, species, ancestry, or destiny from appearance";
      expect(builder.buildSystemPrompt("describe-room")).toContain(phrase);
      expect(builder.buildSystemPrompt("character-brief")).toContain(phrase);
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
      const brief = builder.buildSystemPrompt("character-brief");
      expect(room).not.toBe(brief);
    });
  });
});
