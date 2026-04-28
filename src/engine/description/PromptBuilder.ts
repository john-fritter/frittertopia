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
  characterBriefs?: { name: string; brief: string }[];
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
    ...((ctx.characterBriefs?.length ?? 0) > 0 && { characterBriefs: ctx.characterBriefs }),
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

const FALLBACK_BRIEF_GENERATOR =
  "You are a brief generator for Frittertopia. " +
  "Create internal continuity records used by other AI calls. " +
  "Write structured, concise, neutral records. Do not invent facts.";

const FALLBACK_CHARACTER_BRIEF =
  "You are writing an internal character brief. " +
  "Plain prose, under 75 words. Describe the character as a body at rest.";

const FALLBACK_DESCRIBE =
  "Respond to the player's sense input. Describe what is perceived. " +
  "Use only what is given. Do not invent facts not present in the context.";

// ---------------------------------------------------------------------------
// PromptBuilder class
// ---------------------------------------------------------------------------

export type PromptRole = "describe-room" | "describe" | "character-brief";

export class PromptBuilder {
  private world = "";
  private storyteller = FALLBACK_STORYTELLER;
  private briefGenerator = FALLBACK_BRIEF_GENERATOR;
  private describeRoom = FALLBACK_DESCRIBE_ROOM;
  private describe = FALLBACK_DESCRIBE;
  private characterBrief = FALLBACK_CHARACTER_BRIEF;

  loadPromptFiles(promptsDir: string): void {
    this.world = fs.readFileSync(path.join(promptsDir, "world.md"), "utf8").trim();
    this.storyteller = fs
      .readFileSync(path.join(promptsDir, "storyteller.md"), "utf8")
      .trim();
    this.briefGenerator = fs
      .readFileSync(path.join(promptsDir, "roles", "brief-generator.md"), "utf8")
      .trim();
    this.describeRoom = fs
      .readFileSync(path.join(promptsDir, "roles", "describe-room.md"), "utf8")
      .trim();
    this.describe = fs
      .readFileSync(path.join(promptsDir, "roles", "describe.md"), "utf8")
      .trim();
    this.characterBrief = fs
      .readFileSync(path.join(promptsDir, "roles", "character-brief.md"), "utf8")
      .trim();
  }

  buildSystemPrompt(role: PromptRole, includingStoryteller: boolean = true): string {
    let roleContent: string;
    if (role === "describe-room") roleContent = this.describeRoom;
    else if (role === "describe") roleContent = this.describe;
    else roleContent = this.characterBrief;
    const middleLayer = includingStoryteller ? this.storyteller : this.briefGenerator;
    return [this.world, middleLayer, roleContent]
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

    if (state.characterBriefs && state.characterBriefs.length > 0) {
      const briefLines = state.characterBriefs
        .map((b) => `- ${b.name}: ${b.brief}`)
        .join("\n");
      lines.push(`Character details:\n${briefLines}`);
    }

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

  buildSenseUserPrompt(
    ctx: RoomContext,
    rawInput: string,
    targetBrief?: { name: string; brief: string },
  ): string {
    const currentName = ctx.currentPlayerName ?? "unknown";
    const selfBrief = ctx.characterBriefs?.find((b) => b.name === currentName);
    const otherBriefs = (ctx.characterBriefs ?? []).filter((b) => b.name !== currentName);
    const state = assembleWorldState(ctx);

    const lines: string[] = [];

    // ── Current player ─────────────────────────────────────────────────────────
    lines.push(`CURRENT PLAYER: ${currentName}`);
    lines.push("");
    lines.push("CURRENT PLAYER BRIEF:");
    lines.push("<<<");
    lines.push(selfBrief?.brief ?? "(no brief on file)");
    lines.push(">>>");
    lines.push("");
    lines.push("REFERENCE RULE:");
    lines.push(
      `"I", "me", "my", "myself", "self", and unqualified body-part references ` +
        `(hands, legs, face, body, eyes, etc.) refer only to the current player: ${currentName}. ` +
        `If the player intends to inspect another character they will name that character explicitly.`,
    );

    // ── Other present players ───────────────────────────────────────────────────
    if (otherBriefs.length > 0) {
      lines.push("");
      lines.push("OTHER PRESENT PLAYERS:");
      for (const b of otherBriefs) {
        lines.push("");
        lines.push(`PLAYER: ${b.name}`);
        lines.push("BRIEF:");
        lines.push("<<<");
        lines.push(b.brief);
        lines.push(">>>");
      }
    }

    // ── Target ─────────────────────────────────────────────────────────────────
    if (targetBrief) {
      lines.push("");
      lines.push(`TARGET: ${targetBrief.name}`);
      lines.push("TARGET BRIEF:");
      lines.push("<<<");
      lines.push(targetBrief.brief);
      lines.push(">>>");
    }

    // ── Room context ────────────────────────────────────────────────────────────
    const presentParts: string[] = [
      ...state.entitiesPresent.map((e) => `${e.name}: ${e.description}`),
      ...state.otherPlayers.map((name) => `${name} (player)`),
    ];
    const presentLine = presentParts.length > 0 ? presentParts.join(", ") : "empty";

    lines.push("");
    lines.push(`Room: ${state.roomName}`);
    lines.push(`Brief: ${state.roomBrief}`);
    lines.push(`Time: ${state.timeOfDay}`);
    lines.push(`Moon: ${state.moonPhase}, ${state.moonAboveHorizon ? "above horizon" : "below horizon"}`);
    lines.push(formatWeatherLine(state));
    lines.push(`Present: ${presentLine}`);

    if (state.exits && Object.keys(state.exits).length > 0) {
      const exitParts = Object.entries(state.exits)
        .map(([dir, name]) => `${dir} → ${name}`)
        .join(", ");
      lines.push(`Exits: ${exitParts}`);
    }

    lines.push(`Player input: ${rawInput}`);

    return lines.join("\n");
  }

  buildCharacterUserPrompt(roll: CharacterRoll): string {
    const bullets = [
      `- Gender: ${roll.gender}`,
      `- Age: ${roll.age}`,
      `- Height: ${roll.height}`,
      `- Build: ${roll.build}`,
      `- Skin: ${roll.skin}`,
      `- Eyes: ${roll.eyes}`,
      `- Hair: ${roll.hair}`,
      `- Fantastical feature: ${roll.fantasticalFeature ?? "none"}`,
    ];
    if (roll.skinMarks.length > 0) {
      bullets.push(`- Skin marks: ${roll.skinMarks.join(", ")}`);
    }
    return bullets.join("\n");
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
