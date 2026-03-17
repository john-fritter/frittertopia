import type { Intent, VerbHelpData } from "./Parser.js";
import { Parser } from "./Parser.js";
import type { World } from "./World.js";
import {
  formatRoom,
  formatSelfSay,
  formatSay,
  formatArrival,
  formatDeparture,
  formatSystem,
  formatBold,
  formatCyan,
  formatDim,
  type RoomExit,
} from "../server/format.js";

export interface ActionResult {
  toPlayer: string;
  toRoom?: { roomId: string; text: string; excludePlayer?: string };
  toOtherRoom?: { roomId: string; text: string };
}

const CATEGORY_ORDER = ["movement", "interaction", "communication", "system"];
const CATEGORY_NAMES: Record<string, string> = {
  movement: "Movement",
  interaction: "Interaction",
  communication: "Communication",
  system: "System",
};

export class ActionResolver {
  private parser: Parser;

  constructor(private world: World, parser?: Parser) {
    this.parser = parser ?? new Parser();
    this.registerVerbs();
  }

  private registerVerbs(): void {
    this.parser.registerVerb("move", {
      aliases: ["go"],
      description: "Move in a direction",
      usage: "north, south, east, west, up, down, go <direction>",
      category: "movement",
    });
    this.parser.registerVerb("look", {
      aliases: ["l"],
      description: "Look around the room or examine something specific",
      usage: "look, look <target>, l",
      category: "interaction",
    });
    this.parser.registerVerb("say", {
      aliases: ["'"],
      description: "Say something out loud",
      usage: "say <message>, '<message>",
      category: "communication",
    });
    this.parser.registerVerb("help", {
      aliases: ["?", "commands"],
      description: "Learn about available commands",
      usage: "help, help <command>, help <category>",
      category: "system",
    });
  }

  resolve(intent: Intent, playerId: string): ActionResult {
    const sequence = this.world.getComponent(playerId, "Sequence") as
      | { deflectMessage: string }
      | undefined;
    if (sequence) {
      return { toPlayer: formatSystem(sequence.deflectMessage) };
    }

    switch (intent.verb) {
      case "move":
        return this.handleMove(intent.target, playerId);
      case "look":
        return this.handleLook(intent.target, playerId);
      case "say":
        return this.handleSay(intent.target, playerId);
      case "help":
        return this.handleHelp(intent.target);
      default:
        return { toPlayer: "I don't understand that." };
    }
  }

  private handleMove(
    direction: string | undefined,
    playerId: string
  ): ActionResult {
    if (!direction) return { toPlayer: "Go where?" };

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    const exits = this.world.getComponent(position.roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;
    if (!exits || !(direction in exits.exits)) {
      return { toPlayer: "You can't go that way." };
    }

    const newRoomId = exits.exits[direction]!;
    const oldRoomId = position.roomId;

    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    const playerName = player?.name ?? "Someone";

    // Move the player
    this.world.setComponent(playerId, "Position", { roomId: newRoomId });

    // Build the look output BEFORE marking visited (first visit gets long desc)
    const lookOutput = this.composeLook(newRoomId, playerId);

    // Now mark the new room as visited
    this.markVisited(playerId, newRoomId);

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

  private handleLook(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    if (!target) {
      // Explicit look always shows long description
      return { toPlayer: this.composeLook(position.roomId, playerId, true) };
    }

    return { toPlayer: this.lookAtTarget(target, position.roomId) };
  }

  private handleSay(
    message: string | undefined,
    playerId: string
  ): ActionResult {
    if (!message) return { toPlayer: "Say what?" };

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    const player = this.world.getComponent(playerId, "Player") as
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

  composeLook(roomId: string, playerId: string, forceLong = false): string {
    const room = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    const desc = this.world.getComponent(roomId, "Description") as
      | { short: string; long: string }
      | undefined;
    const exits = this.world.getComponent(roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;

    const visitedRooms = this.getVisitedRooms(playerId);
    const hasVisited = visitedRooms.has(roomId);

    // First visit or explicit look → long description
    const description =
      forceLong || !hasVisited
        ? (desc?.long ?? "You see nothing special.")
        : (desc?.short ?? "You see nothing special.");

    // Build exits with room names for visited rooms only
    const exitList: RoomExit[] = [];
    if (exits) {
      for (const [direction, targetRoomId] of Object.entries(exits.exits)) {
        const exit: RoomExit = { direction };
        if (visitedRooms.has(targetRoomId)) {
          const targetRoom = this.world.getComponent(targetRoomId, "Room") as
            | { name: string }
            | undefined;
          if (targetRoom) {
            exit.roomName = targetRoom.name;
          }
        }
        exitList.push(exit);
      }
    }

    // Collect items and players in the room
    const items: string[] = [];
    const players: string[] = [];

    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      if (id === playerId) continue;
      if (id === roomId) continue;
      const pos = this.world.getComponent(id, "Position") as {
        roomId: string;
      };
      if (pos.roomId !== roomId) continue;

      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        items.push(presence.description);
        continue;
      }

      const otherPlayer = this.world.getComponent(id, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (otherPlayer && otherPlayer.sessionId) {
        players.push(otherPlayer.name);
      }
    }

    return formatRoom({
      name: room?.name ?? "Unknown Room",
      description,
      items: items.length > 0 ? items : undefined,
      players: players.length > 0 ? players : undefined,
      exits: exitList,
    });
  }

  private handleHelp(target: string | undefined): ActionResult {
    const helpData = this.parser.getHelpData();

    if (!target) {
      return { toPlayer: this.formatHelpOverview(helpData) };
    }

    // Check if target matches a verb or alias
    const verb = helpData.find(
      (v) => v.verb === target || v.aliases.includes(target)
    );
    if (verb) {
      return { toPlayer: this.formatHelpDetail(verb) };
    }

    // Check if target matches a category
    const categoryVerbs = helpData.filter((v) => v.category === target);
    if (categoryVerbs.length > 0) {
      return {
        toPlayer: this.formatHelpCategory(target, categoryVerbs),
      };
    }

    return {
      toPlayer: formatDim(
        `Nothing known about '${target}'. Type 'help' for a list of commands.`
      ),
    };
  }

  private formatHelpOverview(helpData: VerbHelpData[]): string {
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

  private formatHelpDetail(verb: VerbHelpData): string {
    const lines: string[] = [];
    lines.push(formatBold(verb.verb));
    lines.push(formatDim("─".repeat(verb.verb.length)));
    lines.push(verb.description + ".");
    lines.push("");
    lines.push(`Usage: ${formatCyan(verb.usage)}`);
    return lines.join("\n");
  }

  private formatHelpCategory(
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

  private lookAtTarget(target: string, roomId: string): string {
    const lowerTarget = target.toLowerCase();

    // Check entities in the room
    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      const pos = this.world.getComponent(id, "Position") as {
        roomId: string;
      };
      if (pos.roomId !== roomId) continue;

      const desc = this.world.getComponent(id, "Description") as
        | { short: string; long: string }
        | undefined;
      if (desc && desc.short.toLowerCase().includes(lowerTarget)) {
        return desc.long;
      }
    }

    // Also check the room itself (by Room name)
    const roomComp = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    if (roomComp && roomComp.name.toLowerCase().includes(lowerTarget)) {
      const roomDesc = this.world.getComponent(roomId, "Description") as
        | { short: string; long: string }
        | undefined;
      if (roomDesc) return roomDesc.long;
    }

    return "You don't see that here.";
  }

  private getVisitedRooms(playerId: string): Set<string> {
    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    return new Set(visited?.rooms ?? []);
  }

  private markVisited(playerId: string, roomId: string): void {
    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    if (visited) {
      if (!visited.rooms.includes(roomId)) {
        this.world.setComponent(playerId, "VisitedRooms", {
          rooms: [...visited.rooms, roomId],
        });
      }
    } else {
      this.world.setComponent(playerId, "VisitedRooms", { rooms: [roomId] });
    }
  }
}
