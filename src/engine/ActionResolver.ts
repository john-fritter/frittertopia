import type { Intent } from "./Parser.js";
import type { World } from "./World.js";

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

    // Build the look output for the new room
    const lookOutput = this.composeLook(newRoomId, playerId);

    return {
      toPlayer: lookOutput,
      toRoom: {
        roomId: oldRoomId,
        text: `${playerName} leaves to the ${direction}.`,
        excludePlayer: playerId,
      },
      toOtherRoom: {
        roomId: newRoomId,
        text: `${playerName} arrives.`,
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
      return { toPlayer: this.composeLook(position.roomId, playerId) };
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
      toPlayer: `You say, "${message}"`,
      toRoom: {
        roomId: position.roomId,
        text: `${playerName} says, "${message}"`,
        excludePlayer: playerId,
      },
    };
  }

  composeLook(roomId: string, playerId: string): string {
    const room = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    const desc = this.world.getComponent(roomId, "Description") as
      | { short: string; long: string }
      | undefined;
    const exits = this.world.getComponent(roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;

    const lines: string[] = [];

    lines.push(room?.name ?? "Unknown Room");
    lines.push("");
    lines.push(desc?.long ?? "You see nothing special.");
    lines.push("");

    if (exits && Object.keys(exits.exits).length > 0) {
      lines.push("Exits: " + Object.keys(exits.exits).join(", "));
    } else {
      lines.push("Exits: none");
    }

    // Presences in the room (other entities with Position matching this room + Presence)
    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      if (id === playerId) continue;
      if (id === roomId) continue;
      const pos = this.world.getComponent(id, "Position") as { roomId: string };
      if (pos.roomId !== roomId) continue;

      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        lines.push(presence.description);
        continue;
      }

      // Other players show as "[Name] is here."
      const otherPlayer = this.world.getComponent(id, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (otherPlayer) {
        lines.push(`${otherPlayer.name} is here.`);
      }
    }

    return lines.join("\n");
  }

  private lookAtTarget(target: string, roomId: string): string {
    const lowerTarget = target.toLowerCase();

    // Check entities in the room
    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      const pos = this.world.getComponent(id, "Position") as { roomId: string };
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
}
