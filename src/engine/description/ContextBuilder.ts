import type { World } from "../World.js";

export interface RoomContext {
  roomName: string;
  /** Full brief text sent to the LLM. Uses RoomBrief.brief if present, otherwise Description.short. */
  roomBrief: string;
  /** Short description, always available — used for fallback rendering. */
  roomShort: string;
  /** Items and NPCs in the room that have a Presence component. */
  entitiesPresent: { name: string; description: string }[];
  /** Names of other players currently in the room. */
  otherPlayers: string[];
  isFirstVisit: boolean;
  /** TODO: read from TimeOfDay singleton entity when wired up. */
  timeOfDay: string;
  /** TODO: read from weather system when implemented. */
  weather: string;
  /** Mechanical exits: direction → target room name. */
  exits?: Record<string, string>;
}

export class ContextBuilder {
  constructor(private world: World) {}

  buildContext(roomId: string, playerId: string): RoomContext {
    const room = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    const roomName = room?.name ?? "Unknown Room";

    const description = this.world.getComponent(roomId, "Description") as
      | { short: string }
      | undefined;
    const roomShort = description?.short ?? "";

    const roomBriefComp = this.world.getComponent(roomId, "RoomBrief") as
      | { brief: string }
      | undefined;
    const roomBrief = roomBriefComp?.brief ?? roomShort;

    const inRoom = this.world
      .getEntitiesWithComponent("Position")
      .filter((id) => {
        const pos = this.world.getComponent(id, "Position") as
          | { roomId: string }
          | undefined;
        return pos?.roomId === roomId && id !== playerId;
      });

    const entitiesPresent: { name: string; description: string }[] = [];
    const otherPlayers: string[] = [];

    for (const id of inRoom) {
      const player = this.world.getComponent(id, "Player") as
        | { name: string }
        | undefined;
      if (player) {
        otherPlayers.push(player.name);
        continue;
      }
      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        const desc = this.world.getComponent(id, "Description") as
          | { short: string }
          | undefined;
        entitiesPresent.push({
          name: desc?.short ?? "something",
          description: presence.description,
        });
      }
    }

    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    const isFirstVisit = !visited?.rooms.includes(roomId);

    const exitsComp = this.world.getComponent(roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;
    let exits: Record<string, string> | undefined;
    if (exitsComp) {
      exits = {};
      for (const [direction, targetId] of Object.entries(exitsComp.exits)) {
        const targetRoom = this.world.getComponent(targetId, "Room") as
          | { name: string }
          | undefined;
        exits[direction] = targetRoom?.name ?? targetId;
      }
    }

    return {
      roomName,
      roomBrief,
      roomShort,
      entitiesPresent,
      otherPlayers,
      isFirstVisit,
      timeOfDay: "day",
      weather: "clear",
      exits,
    };
  }
}
