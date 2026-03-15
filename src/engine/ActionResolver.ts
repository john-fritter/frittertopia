import type { Intent } from "./Parser.js";
import type { World } from "./World.js";
import {
  formatRoom,
  formatSelfSay,
  formatSay,
  formatArrival,
  formatDeparture,
  type RoomExit,
} from "../server/format.js";

export interface ActionResult {
  toPlayer: string;
  toRoom?: { roomId: string; text: string; excludePlayer?: string };
  toOtherRoom?: { roomId: string; text: string };
}

export class ActionResolver {
  constructor(private world: World) {}

  resolve(intent: Intent, playerId: string): ActionResult {
    switch (intent.verb) {
      case "move":
        return this.handleMove(intent.target, playerId);
      case "look":
        return this.handleLook(intent.target, playerId);
      case "say":
        return this.handleSay(intent.target, playerId);
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
