import type { RoomContext } from "./ContextBuilder.js";

// ---------------------------------------------------------------------------
// Shared context-assembly helper
// Each prompt kind calls this to produce a structured world/sim state payload.
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
// Description kind
// ---------------------------------------------------------------------------

const DESCRIPTION_SYSTEM = (
  "You are the narrator of a text adventure in the literary tradition of " +
  "atmospheric, sparse MUDs. Write second-person present-tense responses of " +
  "1–3 sentences: concrete, alive to texture, never precious. Use the room " +
  "context as ground truth. Respond to whatever the player typed — if what " +
  "they describe is absent, implausible, or strange, answer naturally and in " +
  "character. Never refuse, apologize, or mention game mechanics.\n\n" +
  "Every item and player in the Present list must be named somewhere in your " +
  "prose, using the exact spelling from that list. Weave them naturally into " +
  "the sentence — no special markup or brackets. Do not invent entries that " +
  "aren't in the list."
);

export function buildDescriptionPrompt(
  ctx: RoomContext,
  rawInput: string,
  // recentOutput?: string,  // seam: wire up when short-term memory feature lands
): { system: string; user: string } {
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

  return { system: DESCRIPTION_SYSTEM, user: lines.join("\n") };
}
