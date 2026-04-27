import * as fs from "node:fs";
import * as path from "node:path";
import type { RoomContext } from "./ContextBuilder.js";
import type { CharacterRoll } from "../../game/characterGenerator.js";

// ---------------------------------------------------------------------------
// Internal helpers — shared by buildRoomUserPrompt
// ---------------------------------------------------------------------------

interface WorldStatePayload {
  roomName: string;
  roomBrief: string;
  entitiesPresent: Array<{ name: string; description: string }>;
  otherPlayers: string[];
  timeOfDay: string;
  moonPhase: string;
  moonAboveHorizon: boolean;
  weather: string;
  tempF?: number;
  tempBracket?: string;
  pressureMb?: number;
  pressureTrend?: string;
  exits?: Record<string, string>;
  // recentOutput?: string;  // seam: last N tokens of prior output (short-term memory)
}

function assembleWorldState(ctx: RoomContext): WorldStatePayload {
  return {
    roomName: ctx.roomName,
    roomBrief: ctx.roomBrief,
    entitiesPresent: ctx.entitiesPresent,
    otherPlayers: ctx.otherPlayers,
    timeOfDay: ctx.timeOfDay,
    moonPhase: ctx.moonPhase,
    moonAboveHorizon: ctx.moonAboveHorizon,
    weather: ctx.weather,
    ...(ctx.tempF !== undefined && { tempF: ctx.tempF }),
    ...(ctx.tempBracket !== undefined && { tempBracket: ctx.tempBracket }),
    ...(ctx.pressureMb !== undefined && { pressureMb: ctx.pressureMb }),
    ...(ctx.pressureTrend !== undefined && { pressureTrend: ctx.pressureTrend }),
    ...(ctx.exits !== undefined && { exits: ctx.exits }),
  };
}

function formatWeatherLine(state: WorldStatePayload): string {
  if (state.tempF === undefined) return `Weather: ${state.weather}`;
  const parts: string[] = [state.weather];
  parts.push(`${state.tempF}°F (${state.tempBracket ?? ""})`);
  if (state.pressureMb !== undefined && state.pressureTrend !== undefined) {
    parts.push(`${state.pressureMb} mb ${state.pressureTrend}`);
  }
  return `Weather: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Fallback content — used when content/prompts/ is not found at init time.
// Contains the patterns that description-service.test.ts asserts on.
// ---------------------------------------------------------------------------

const FALLBACK_STORYTELLER =
  "You are the storyteller of Frittertopia. " +
  "You write in second-person, present tense. " +
  "Respond naturally and in character. " +
  "Never refuse, apologize, or break frame to mention mechanics.";

const FALLBACK_DESCRIBE_ROOM =
  "Describe the room in 1–3 sentences. " +
  "Every entry in the Present list must be named in your prose.";

const FALLBACK_CHARACTER_BRIEF =
  "You are writing an internal character brief. " +
  "Plain prose, under 75 words. Describe the character as a body at rest.";

// ---------------------------------------------------------------------------
// PromptBuilder class
// ---------------------------------------------------------------------------

export type PromptRole = "describe-room" | "character-brief";

export class PromptBuilder {
  private world = "";
  private storyteller = FALLBACK_STORYTELLER;
  private describeRoom = FALLBACK_DESCRIBE_ROOM;
  private characterBrief = FALLBACK_CHARACTER_BRIEF;

  loadPromptFiles(promptsDir: string): void {
    this.world = fs.readFileSync(path.join(promptsDir, "world.md"), "utf8").trim();
    this.storyteller = fs
      .readFileSync(path.join(promptsDir, "storyteller.md"), "utf8")
      .trim();
    this.describeRoom = fs
      .readFileSync(path.join(promptsDir, "roles", "describe-room.md"), "utf8")
      .trim();
    this.characterBrief = fs
      .readFileSync(path.join(promptsDir, "roles", "character-brief.md"), "utf8")
      .trim();
  }

  buildSystemPrompt(role: PromptRole): string {
    const roleContent =
      role === "describe-room" ? this.describeRoom : this.characterBrief;
    return [this.world, this.storyteller, roleContent]
      .filter((s) => s.length > 0)
      .join("\n\n");
  }

  buildRoomUserPrompt(ctx: RoomContext, rawInput: string): string {
    const state = assembleWorldState(ctx);

    const presentParts: string[] = [
      ...state.entitiesPresent.map((e) => `${e.name}: ${e.description}`),
      ...state.otherPlayers.map((name) => `${name} (player)`),
    ];
    const presentLine = presentParts.length > 0 ? presentParts.join(", ") : "empty";

    const lines = [
      `Room: ${state.roomName}`,
      `Brief: ${state.roomBrief}`,
      `Time: ${state.timeOfDay}`,
      `Moon: ${state.moonPhase}, ${state.moonAboveHorizon ? "above horizon" : "below horizon"}`,
      formatWeatherLine(state),
      `Present: ${presentLine}`,
    ];

    if (state.exits && Object.keys(state.exits).length > 0) {
      const exitParts = Object.entries(state.exits)
        .map(([dir, name]) => `${dir} → ${name}`)
        .join(", ");
      lines.push(`Exits: ${exitParts}`);
    }

    // recentOutput seam: lines.push(`Recent: ${recentOutput}`);

    lines.push(`Player input: ${rawInput}`);

    return lines.join("\n");
  }

  buildCharacterUserPrompt(roll: CharacterRoll): string {
    const lines = [
      `Gender: ${roll.gender}`,
      `Age: ${roll.age}`,
      `Height: ${roll.height}`,
      `Build: ${roll.build}`,
      `Skin: ${roll.skin}`,
      `Eyes: ${roll.eyes}`,
      `Hair: ${roll.hair}`,
      `Fantastical feature: ${roll.fantasticalFeature ?? "none"}`,
    ];
    if (roll.skinMarks.length > 0) {
      lines.push(`Skin marks: ${roll.skinMarks.join(", ")}`);
    }
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Singleton — loads from content/prompts/ relative to this file at init time
// ---------------------------------------------------------------------------

export const promptBuilder = new PromptBuilder();
try {
  promptBuilder.loadPromptFiles(
    path.join(import.meta.dirname, "..", "..", "..", "content", "prompts"),
  );
} catch {
  // content/prompts/ not found — fallbacks in use
}

// ---------------------------------------------------------------------------
// Backward-compat export — keeps existing call sites and tests working
// ---------------------------------------------------------------------------

export function buildDescriptionPrompt(
  ctx: RoomContext,
  rawInput: string,
  // recentOutput?: string,  // seam: wire up when short-term memory feature lands
): { system: string; user: string } {
  return {
    system: promptBuilder.buildSystemPrompt("describe-room"),
    user: promptBuilder.buildRoomUserPrompt(ctx, rawInput),
  };
}
