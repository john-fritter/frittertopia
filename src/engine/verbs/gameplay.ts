import type { World } from "../World.js";
import type { ActionResult } from "../ActionResolver.js";
import type { Parser, VerbHelpData } from "../Parser.js";
import {
  formatRoomView,
  formatWhere,
  formatSelfSay,
  formatSay,
  formatArrival,
  formatDeparture,
  formatBold,
  formatCyan,
  formatDim,
  abbreviateDirection,
  sortDirections,
  type RoomFooter,
  type WhereBody,
} from "../../server/format.js";
import { computeTempBracket } from "../../game/weather.js";
import { getVisitedRooms, markVisited } from "./helpers/entityMatching.js";

export const CATEGORY_ORDER = ["movement", "interaction", "senses", "communication", "system"];
export const CATEGORY_NAMES: Record<string, string> = {
  movement: "Movement",
  interaction: "Interaction",
  senses: "Senses",
  communication: "Communication",
  system: "System",
};

export function formatPromptBlock(p: { system: string; user: string; context: string }): string {
  const bar = formatDim("─".repeat(50));
  const lines = [
    formatBold("Last LLM Prompt") + formatDim(`  [${p.context}]`),
    bar,
    formatBold("SYSTEM"),
    "",
    p.system,
    "",
    formatBold("USER"),
    "",
    p.user,
    bar,
  ];
  return lines.join("\n");
}

export async function handleMove(
  world: World,
  direction: string | undefined,
  playerId: string
): Promise<ActionResult> {
  if (!direction) return { toPlayer: "Go where?" };

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  const exits = world.getComponent(position.roomId, "Exits") as
    | { exits: Record<string, string> }
    | undefined;
  if (!exits || !(direction in exits.exits)) {
    return { toPlayer: "You can't go that way." };
  }

  const newRoomId = exits.exits[direction]!;
  const oldRoomId = position.roomId;

  const player = world.getComponent(playerId, "Player") as
    | { name: string; sessionId: string }
    | undefined;
  const playerName = player?.name ?? "Someone";

  // Move the player
  world.setComponent(playerId, "Position", { roomId: newRoomId });

  // Build the look output BEFORE marking visited (first visit gets long desc)
  const lookOutput = await composeLook(world, newRoomId, playerId);

  // Now mark the new room as visited
  markVisited(world, playerId, newRoomId);

  return {
    toPlayer: lookOutput,
    toRoom: {
      roomId: oldRoomId,
      text: formatDeparture(playerName, direction),
      excludePlayer: playerId,
    },
    toOtherRoom: {
      roomId: newRoomId,
      text: formatArrival(playerName),
    },
  };
}

export async function handleLook(
  world: World,
  rawInput: string,
  target: string | undefined,
  playerId: string
): Promise<ActionResult> {
  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  if (!target) {
    // Explicit bare look always shows long description
    return { toPlayer: await composeLook(world, position.roomId, playerId, true, rawInput) };
  }

  const description = await world.description.describe(position.roomId, playerId, rawInput);
  const footer = buildFooter(world, position.roomId);
  let output = formatRoomView({ prose: description, footer });
  if (world.description.debugMode && world.description.lastPrompt) {
    output += "\n\n" + formatPromptBlock(world.description.lastPrompt);
  }
  return { toPlayer: output };
}

export async function handleSense(
  world: World,
  rawInput: string,
  target: string | undefined,
  playerId: string,
  sense: "listen" | "smell" | "touch" | "taste"
): Promise<ActionResult> {
  if (!target && sense === "touch") return { toPlayer: "Touch what?" };
  if (!target && sense === "taste") return { toPlayer: "You're not going to taste the room." };

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  const text = await world.description.describe(position.roomId, playerId, rawInput);
  const footer = buildFooter(world, position.roomId);
  return { toPlayer: formatRoomView({ prose: text, footer }) };
}

export function handleWhere(world: World, playerId: string): ActionResult {
  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  const roomId = position.roomId;
  const room = world.getComponent(roomId, "Room") as { name: string } | undefined;
  const desc = world.getComponent(roomId, "Description") as
    | { short: string }
    | undefined;
  const exitsComp = world.getComponent(roomId, "Exits") as
    | { exits: Record<string, string> }
    | undefined;

  const visitedRooms = getVisitedRooms(world, playerId);

  const exits: Array<{ direction: string; roomName?: string }> = [];
  if (exitsComp) {
    for (const [direction, targetRoomId] of Object.entries(exitsComp.exits)) {
      const entry: { direction: string; roomName?: string } = { direction };
      if (visitedRooms.has(targetRoomId)) {
        const targetRoom = world.getComponent(targetRoomId, "Room") as
          | { name: string }
          | undefined;
        if (targetRoom) entry.roomName = targetRoom.name;
      }
      exits.push(entry);
    }
  }

  const players: string[] = [];
  const items: string[] = [];

  for (const id of world.getEntitiesWithComponent("Position")) {
    if (id === playerId) continue;
    if (id === roomId) continue;
    const pos = world.getComponent(id, "Position") as { roomId: string };
    if (pos.roomId !== roomId) continue;

    const otherPlayer = world.getComponent(id, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    if (otherPlayer && otherPlayer.sessionId) {
      players.push(otherPlayer.name);
      continue;
    }

    const presence = world.getComponent(id, "Presence") as
      | { description: string }
      | undefined;
    if (presence) {
      const entDesc = world.getComponent(id, "Description") as
        | { short: string }
        | undefined;
      items.push(entDesc?.short ?? presence.description);
    }
  }

  const body: WhereBody = {
    roomName: room?.name ?? "Unknown Room",
    shortDescription: desc?.short ?? "You see nothing special.",
    exits,
    players,
    items,
    footer: buildFooter(world, roomId),
  };

  return { toPlayer: formatWhere(body) };
}

export function handleSay(
  world: World,
  message: string | undefined,
  playerId: string
): ActionResult {
  if (!message) return { toPlayer: "Say what?" };

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  const player = world.getComponent(playerId, "Player") as
    | { name: string; sessionId: string }
    | undefined;
  const playerName = player?.name ?? "Someone";

  return {
    toPlayer: formatSelfSay(message),
    toRoom: {
      roomId: position.roomId,
      text: formatSay(playerName, message),
      excludePlayer: playerId,
    },
  };
}

export function handleHelp(parser: Parser, target: string | undefined): ActionResult {
  const helpData = parser.getHelpData();

  if (!target) {
    return { toPlayer: formatHelpOverview(helpData) };
  }

  // Check if target matches a verb or alias
  const verb = helpData.find(
    (v) => v.verb === target || v.aliases.includes(target)
  );
  if (verb) {
    return { toPlayer: formatHelpDetail(verb) };
  }

  // Check if target matches a category
  const categoryVerbs = helpData.filter((v) => v.category === target);
  if (categoryVerbs.length > 0) {
    return {
      toPlayer: formatHelpCategory(target, categoryVerbs),
    };
  }

  return {
    toPlayer: formatDim(
      `Nothing known about '${target}'. Type 'help' for a list of commands.`
    ),
  };
}

export async function composeLook(
  world: World,
  roomId: string,
  playerId: string,
  forceLong = false,
  rawInput = "look"
): Promise<string> {
  const desc = world.getComponent(roomId, "Description") as
    | { short: string }
    | undefined;

  const visitedRooms = getVisitedRooms(world, playerId);
  const hasVisited = visitedRooms.has(roomId);

  // First visit or explicit look → AI description; revisit → short
  let description: string;
  if (forceLong || !hasVisited) {
    description = await world.description.describe(roomId, playerId, rawInput);
  } else {
    description = desc?.short ?? "You see nothing special.";
  }

  const footer = buildFooter(world, roomId);
  let output = formatRoomView({ prose: description, footer });
  if (world.description.debugMode && world.description.lastPrompt) {
    output += "\n\n" + formatPromptBlock(world.description.lastPrompt);
  }
  return output;
}

export function buildFooter(world: World, roomId: string): RoomFooter {
  const room = world.getComponent(roomId, "Room") as
    | { name: string }
    | undefined;
  const exitsComp = world.getComponent(roomId, "Exits") as
    | { exits: Record<string, string> }
    | undefined;

  const rawDirs = exitsComp ? Object.keys(exitsComp.exits) : [];
  const directions = sortDirections(rawDirs.map(abbreviateDirection));

  let timeBracket = "day";
  const timeEntityId = world.getEntityByKey("world.time");
  if (timeEntityId) {
    const tod = world.getComponent(timeEntityId, "TimeOfDay") as
      | { bracket: string }
      | undefined;
    if (tod) timeBracket = tod.bracket;
  }

  let weather = "indoor";
  let tempBracket = "warm";
  const weatherZoneRef = world.getComponent(roomId, "WeatherZoneRef") as
    | { zoneId: string }
    | undefined;
  if (weatherZoneRef) {
    const ws = world.getComponent(weatherZoneRef.zoneId, "WeatherState") as
      | { tempC: number; precipState: string }
      | undefined;
    if (ws) {
      weather = ws.precipState;
      tempBracket = computeTempBracket(ws.tempC);
    }
  }

  return {
    roomName: room?.name ?? "Unknown Room",
    directions,
    timeBracket,
    tempBracket,
    weather,
  };
}

export function formatHelpOverview(helpData: VerbHelpData[]): string {
  const DESC_COL = 38;
  const lines: string[] = [];

  lines.push(formatBold("Available Commands"));
  lines.push(formatDim("─".repeat(18)));

  for (const cat of CATEGORY_ORDER) {
    const verbs = helpData.filter((v) => v.category === cat);
    if (verbs.length === 0) continue;

    lines.push("");
    lines.push(formatBold(CATEGORY_NAMES[cat] ?? cat));

    for (const verb of verbs) {
      const visiblePrefix = verb.verb.length + 3; // "  " + verb + " "
      const dotsNeeded = Math.max(3, DESC_COL - visiblePrefix - 3);
      const dots = ".".repeat(dotsNeeded);
      lines.push(
        `  ${formatCyan(verb.verb)} ${formatDim(dots)}   ${verb.description}`
      );
    }
  }

  lines.push("");
  lines.push(formatDim("Type 'help <command>' for details."));

  return lines.join("\n");
}

export function formatHelpDetail(verb: VerbHelpData): string {
  const lines: string[] = [];
  lines.push(formatBold(verb.verb));
  lines.push(formatDim("─".repeat(verb.verb.length)));
  lines.push(verb.description + ".");
  lines.push("");
  lines.push(`Usage: ${formatCyan(verb.usage)}`);
  return lines.join("\n");
}

export function formatHelpCategory(
  category: string,
  verbs: VerbHelpData[]
): string {
  const lines: string[] = [];
  lines.push(formatBold(CATEGORY_NAMES[category] ?? category));
  lines.push(formatDim("─".repeat((CATEGORY_NAMES[category] ?? category).length)));

  for (const verb of verbs) {
    lines.push("");
    lines.push(`  ${formatCyan(verb.verb)} — ${verb.description}`);
    lines.push(`  Usage: ${formatCyan(verb.usage)}`);
  }

  return lines.join("\n");
}
