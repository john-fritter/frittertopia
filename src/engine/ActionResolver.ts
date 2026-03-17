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
  type RoomData,
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

    // Admin commands — no metadata so they don't appear in help
    this.parser.registerVerb("@destroy");
    this.parser.registerVerb("@inspect");
    this.parser.registerVerb("@teleport");
    this.parser.registerVerb("@help");
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
      case "@destroy":
        return this.adminGate(playerId, () =>
          this.handleAdminDestroy(intent.target, playerId)
        );
      case "@inspect":
        return this.adminGate(playerId, () =>
          this.handleAdminInspect(intent.target, playerId)
        );
      case "@teleport":
        return this.adminGate(playerId, () =>
          this.handleAdminTeleport(intent.target, playerId)
        );
      case "@help":
        return this.adminGate(playerId, () => this.handleAdminHelp());
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

    const roomData: RoomData = {
      name: room?.name ?? "Unknown Room",
      description,
      exits: exitList,
    };
    if (items.length > 0) roomData.items = items;
    if (players.length > 0) roomData.players = players;

    return formatRoom(roomData);
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

  private isAdmin(playerId: string): boolean {
    return this.world.getComponent(playerId, "Admin") !== undefined;
  }

  private adminGate(
    playerId: string,
    handler: () => ActionResult
  ): ActionResult {
    if (!this.isAdmin(playerId)) {
      return { toPlayer: "You don't have permission to do that." };
    }
    return handler();
  }

  private handleAdminDestroy(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    if (!target) return { toPlayer: formatDim("Usage: @destroy <player>") };

    // Find player by name (case-insensitive)
    const playerIds = this.world.getEntitiesWithComponent("Player");
    let targetId: string | undefined;
    let targetName: string | undefined;

    for (const id of playerIds) {
      const player = this.world.getComponent(id, "Player") as {
        name: string;
        sessionId: string;
      };
      if (player.name.toLowerCase() === target.toLowerCase()) {
        targetId = id;
        targetName = player.name;
        break;
      }
    }

    if (!targetId || !targetName) {
      return { toPlayer: formatDim(`No player found: ${target}`) };
    }

    if (targetId === playerId) {
      return { toPlayer: formatDim("You can't destroy yourself.") };
    }

    // Emit event so Server can disconnect the session
    this.world.emit("player_destroyed", { playerId: targetId });

    // Remove the entity from the world
    this.world.deleteEntity(targetId);

    return { toPlayer: formatDim(`Destroyed player: ${targetName}`) };
  }

  private handleAdminInspect(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    if (!target) return { toPlayer: formatDim("Usage: @inspect <target>") };

    const entityId = this.resolveTarget(target, playerId);
    if (!entityId) {
      return { toPlayer: formatDim(`Nothing found: ${target}`) };
    }

    const key = this.world.entities.getKeyForEntity(entityId);
    const components = this.world.entities.getComponentsForEntity(entityId);

    const lines: string[] = [];
    const label = key ? `${key} / id: ${entityId}` : `id: ${entityId}`;
    lines.push(formatBold(`[Inspecting: ${target}]`) + `  (${label})`);
    lines.push(formatDim("─".repeat(24)));

    for (const [typeName, data] of components) {
      lines.push("");
      lines.push(formatBold(typeName));
      for (const [field, value] of Object.entries(data)) {
        lines.push(`  ${formatCyan(field)}: ${JSON.stringify(value)}`);
      }
    }

    return { toPlayer: lines.join("\n") };
  }

  private handleAdminTeleport(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    if (!target) return { toPlayer: formatDim("Usage: @teleport <room-id>") };

    const roomId = this.world.getEntityByKey(target);
    if (!roomId) {
      return { toPlayer: formatDim(`No room found: ${target}`) };
    }

    // Verify it's actually a room
    const room = this.world.getComponent(roomId, "Room");
    if (!room) {
      return { toPlayer: formatDim(`No room found: ${target}`) };
    }

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    const oldRoomId = position?.roomId;

    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    const playerName = player?.name ?? "Someone";

    // Move the player
    this.world.setComponent(playerId, "Position", { roomId });
    this.markVisited(playerId, roomId);

    const lookOutput = this.composeLook(roomId, playerId, true);

    const result: ActionResult = { toPlayer: lookOutput };

    if (oldRoomId) {
      result.toRoom = {
        roomId: oldRoomId,
        text: formatDim(`${playerName} vanishes.`),
        excludePlayer: playerId,
      };
    }

    result.toOtherRoom = {
      roomId,
      text: formatDim(`${playerName} appears.`),
    };

    return result;
  }

  private handleAdminHelp(): ActionResult {
    const DESC_COL = 38;
    const lines: string[] = [];

    lines.push(formatBold("Admin Commands"));
    lines.push(formatDim("─".repeat(14)));

    const commands = [
      { name: "@destroy <player>", desc: "Remove a player and their data" },
      { name: "@inspect <target>", desc: "Show all component data for an entity" },
      { name: "@teleport <room-id>", desc: "Move to any room" },
      { name: "@help", desc: "Show this list" },
    ];

    lines.push("");
    for (const cmd of commands) {
      const visiblePrefix = cmd.name.length + 3;
      const dotsNeeded = Math.max(3, DESC_COL - visiblePrefix - 3);
      const dots = ".".repeat(dotsNeeded);
      lines.push(
        `  ${formatCyan(cmd.name)} ${formatDim(dots)}   ${cmd.desc}`
      );
    }

    return { toPlayer: lines.join("\n") };
  }

  private resolveTarget(target: string, playerId: string): string | undefined {
    const lowerTarget = target.toLowerCase();

    // Check by entity key first
    const byKey = this.world.getEntityByKey(target);
    if (byKey) return byKey;

    // Check players by name
    const playerIds = this.world.getEntitiesWithComponent("Player");
    for (const id of playerIds) {
      const player = this.world.getComponent(id, "Player") as {
        name: string;
      };
      if (player.name.toLowerCase() === lowerTarget) {
        return id;
      }
    }

    // Check entities in the admin's room
    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (position) {
      const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
      for (const id of entitiesInRoom) {
        const pos = this.world.getComponent(id, "Position") as {
          roomId: string;
        };
        if (pos.roomId !== position.roomId) continue;

        const desc = this.world.getComponent(id, "Description") as
          | { short: string; long: string }
          | undefined;
        if (desc && desc.short.toLowerCase().includes(lowerTarget)) {
          return id;
        }
      }
    }

    return undefined;
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
