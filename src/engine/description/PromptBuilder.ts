import * as fs from "node:fs";
import * as path from "node:path";
import type { RoomContext, ItemBriefEntry } from "./ContextBuilder.js";
import type { CharacterRoll } from "../../game/characterGenerator.js";

// ---------------------------------------------------------------------------
// Internal helpers
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
  zoneName?: string;
  zoneBrief?: string;
  exits?: Record<string, string>;
  characterBriefs?: { name: string; brief: string }[];
  roomItemBriefs?: ItemBriefEntry[];
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
    ...(ctx.zoneName !== undefined && { zoneName: ctx.zoneName }),
    ...(ctx.zoneBrief !== undefined && { zoneBrief: ctx.zoneBrief }),
    ...(ctx.exits !== undefined && { exits: ctx.exits }),
    ...((ctx.characterBriefs?.length ?? 0) > 0 && { characterBriefs: ctx.characterBriefs }),
    ...((ctx.roomItemBriefs?.length ?? 0) > 0 && { roomItemBriefs: ctx.roomItemBriefs }),
  };
}

function formatEnvironmentState(state: WorldStatePayload): string {
  const parts: string[] = [
    `time=${state.timeOfDay}`,
    `moon=${state.moonPhase} (${state.moonAboveHorizon ? "above horizon" : "below horizon"})`,
    `weather=${state.weather}`,
  ];
  if (state.tempF !== undefined) {
    parts.push(`temp=${state.tempF}°F (${state.tempBracket ?? ""})`);
  }
  if (state.pressureMb !== undefined && state.pressureTrend !== undefined) {
    parts.push(`pressure=${state.pressureMb} mb ${state.pressureTrend}`);
  }
  return `STATE: ${parts.join(", ")}`;
}

function formatItemBlock(item: ItemBriefEntry, indent: string): string {
  const lines = [
    `${indent}[ITEM: ${item.short}] {`,
    `${indent}  ${item.brief}`,
  ];
  if (item.state) {
    const stateStr = Object.entries(item.state)
      .filter(([k]) => k !== "placedAt")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    if (stateStr) lines.push(`${indent}  STATE: ${stateStr}`);
  }
  if (item.location.startsWith("carried by")) {
    lines.push(`${indent}  CARRIED`);
  } else {
    lines.push(`${indent}  POSITION: ${item.location}`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function buildEnvironmentBlock(state: WorldStatePayload): string {
  const header = state.zoneName ? `[ENVIRONMENT: ${state.zoneName}]` : "[ENVIRONMENT]";
  const lines = [`${header} {`];
  if (state.zoneBrief) {
    for (const line of state.zoneBrief.trimEnd().split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`  ${formatEnvironmentState(state)}`);
  lines.push("}");
  return lines.join("\n");
}

function buildRoomBlock(state: WorldStatePayload): string {
  const presentParts: string[] = [
    ...state.entitiesPresent.map((e) => `${e.name}: ${e.description}`),
    ...state.otherPlayers.map((name) => `${name} (player)`),
  ];
  const presentLine = presentParts.length > 0 ? presentParts.join(", ") : "empty";

  const lines = [
    `[ROOM: ${state.roomName}] {`,
    `  ${state.roomBrief}`,
    `  present: ${presentLine}`,
  ];
  if (state.exits && Object.keys(state.exits).length > 0) {
    const exitParts = Object.entries(state.exits)
      .map(([dir, name]) => `${dir} → ${name}`)
      .join(", ");
    lines.push(`  exits: ${exitParts}`);
  }
  lines.push("}");
  return lines.join("\n");
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
  "Describe the room as the player perceives it right now, in 1–3 sentences. " +
  "Use the room brief in [ROOM] as ground truth. " +
  "Every entity in the present field must be named in your prose.";

const FALLBACK_BRIEF_GENERATOR =
  "You are a brief generator for Frittertopia. " +
  "Create internal continuity records used by other AI calls. " +
  "Write structured, concise, neutral records. Do not invent facts.";

const FALLBACK_CHARACTER_BRIEF =
  "You are writing an internal character brief. " +
  "Plain prose, under 75 words. Describe the character as a body at rest.";

const FALLBACK_ROOM_BRIEF =
  "Create a physical continuity record for a room. " +
  "Extract facts from the source prose. No invented details. " +
  "Named features use [feature name] { ... } blocks. " +
  "REVEAL: detail — condition for conditional facts only when the source establishes them.";

const FALLBACK_DESCRIBE =
  "Respond to the player's sense input. Describe what is perceived. " +
  "Use only what is given in the context blocks. Do not invent facts.";

// ---------------------------------------------------------------------------
// PromptBuilder class
// ---------------------------------------------------------------------------

export type PromptRole = "describe-room" | "describe" | "character-brief" | "room-brief";

export class PromptBuilder {
  private world = "";
  private storyteller = FALLBACK_STORYTELLER;
  private briefGenerator = FALLBACK_BRIEF_GENERATOR;
  private describeRoom = FALLBACK_DESCRIBE_ROOM;
  private describe = FALLBACK_DESCRIBE;
  private characterBrief = FALLBACK_CHARACTER_BRIEF;
  private roomBrief = FALLBACK_ROOM_BRIEF;

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
    this.roomBrief = fs
      .readFileSync(path.join(promptsDir, "roles", "room-brief.md"), "utf8")
      .trim();
  }

  buildSystemPrompt(role: PromptRole, includingStoryteller: boolean = true): string {
    let roleContent: string;
    if (role === "describe-room") roleContent = this.describeRoom;
    else if (role === "describe") roleContent = this.describe;
    else if (role === "room-brief") roleContent = this.roomBrief;
    else roleContent = this.characterBrief;
    const middleLayer = includingStoryteller ? this.storyteller : this.briefGenerator;
    return [this.world, middleLayer, roleContent]
      .filter((s) => s.length > 0)
      .join("\n\n");
  }

  buildRoomBriefUserPrompt(roomName: string, prose: string): string {
    return `Room name: ${roomName}\n\nSource:\n${prose}`;
  }

  buildRoomUserPrompt(ctx: RoomContext, rawInput: string): string {
    const state = assembleWorldState(ctx);
    const blocks: string[] = [];

    // [ROOM] block
    blocks.push(buildRoomBlock(state));

    // [ENVIRONMENT] block — zone name and brief when available, live state always
    blocks.push(buildEnvironmentBlock(state));

    // [CURRENT PLAYER] block
    const currentName = ctx.currentPlayerName;
    const selfBrief = currentName
      ? (state.characterBriefs ?? []).find((b) => b.name === currentName)
      : undefined;
    if (currentName && selfBrief) {
      blocks.push(`[CURRENT PLAYER: ${currentName}] {\n  ${selfBrief.brief}\n}`);
    }

    // [CHARACTERS] block — other players who have briefs
    const otherBriefs = (state.characterBriefs ?? []).filter(
      (b) => b.name !== currentName,
    );
    if (otherBriefs.length > 0) {
      const charLines = ["[CHARACTERS] {"];
      for (const b of otherBriefs) {
        charLines.push(`  [PLAYER: ${b.name}] {`);
        charLines.push(`    ${b.brief}`);
        charLines.push(`  }`);
      }
      charLines.push("}");
      blocks.push(charLines.join("\n"));
    }

    // [ITEMS] block — room items only
    if (state.roomItemBriefs && state.roomItemBriefs.length > 0) {
      const itemLines = ["[ITEMS] {"];
      for (const item of state.roomItemBriefs) {
        itemLines.push(formatItemBlock(item, "  "));
      }
      itemLines.push("}");
      blocks.push(itemLines.join("\n"));
    }

    // [INPUT]
    blocks.push(`[INPUT] { ${rawInput} }`);

    // recentOutput seam: blocks.push(`[RECENT] { ${recentOutput} }`);

    return blocks.join("\n");
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

    const blocks: string[] = [];

    // [ROOM] block
    blocks.push(buildRoomBlock(state));

    // [ENVIRONMENT] block — zone name and brief when available, live state always
    blocks.push(buildEnvironmentBlock(state));

    // [CURRENT PLAYER] block
    const selfBriefText = selfBrief?.brief ?? "(no brief on file)";
    const referenceRule =
      `REFERENCE RULE: "I", "me", "my", "myself", "self", and unqualified body-part references ` +
      `(hands, legs, face, body, eyes, etc.) refer only to the current player: ${currentName}. ` +
      `If the player intends to inspect another character they will name that character explicitly.`;
    blocks.push(
      `[CURRENT PLAYER: ${currentName}] {\n  ${selfBriefText}\n  ${referenceRule}\n}`,
    );

    // [CHARACTERS] block — other players who have briefs
    if (otherBriefs.length > 0) {
      const charLines = ["[CHARACTERS] {"];
      for (const b of otherBriefs) {
        charLines.push(`  [PLAYER: ${b.name}] {`);
        charLines.push(`    ${b.brief}`);
        charLines.push(`  }`);
      }
      charLines.push("}");
      blocks.push(charLines.join("\n"));
    }

    // [TARGET] block
    if (targetBrief) {
      blocks.push(`[TARGET: ${targetBrief.name}] {\n  ${targetBrief.brief}\n}`);
    }

    // [ITEMS] block — room items + inventory items combined
    const allItems = [
      ...(ctx.roomItemBriefs ?? []),
      ...(ctx.inventoryItemBriefs ?? []),
    ];
    if (allItems.length > 0) {
      const itemLines = ["[ITEMS] {"];
      for (const item of allItems) {
        itemLines.push(formatItemBlock(item, "  "));
      }
      itemLines.push("}");
      blocks.push(itemLines.join("\n"));
    }

    // [INPUT]
    blocks.push(`[INPUT] { ${rawInput} }`);

    return blocks.join("\n");
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
