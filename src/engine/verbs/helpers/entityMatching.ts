import type { World } from "../../World.js";

export function resolveTarget(world: World, target: string, playerId: string): string | undefined {
  const lowerTarget = target.toLowerCase();

  // Check by entity key first
  const byKey = world.getEntityByKey(target);
  if (byKey) return byKey;

  // Check players by name
  const playerIds = world.getEntitiesWithComponent("Player");
  for (const id of playerIds) {
    const player = world.getComponent(id, "Player") as { name: string };
    if (player.name.toLowerCase() === lowerTarget) {
      return id;
    }
  }

  // Check entities in the admin's room
  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (position) {
    const entitiesInRoom = world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      const pos = world.getComponent(id, "Position") as { roomId: string };
      if (pos.roomId !== position.roomId) continue;

      const desc = world.getComponent(id, "Description") as
        | { short: string }
        | undefined;
      if (desc && desc.short.toLowerCase().includes(lowerTarget)) {
        return id;
      }
    }
  }

  return undefined;
}

export function getVisitedRooms(world: World, playerId: string): Set<string> {
  const visited = world.getComponent(playerId, "VisitedRooms") as
    | { rooms: string[] }
    | undefined;
  return new Set(visited?.rooms ?? []);
}

export function markVisited(world: World, playerId: string, roomId: string): void {
  const visited = world.getComponent(playerId, "VisitedRooms") as
    | { rooms: string[] }
    | undefined;
  if (visited) {
    if (!visited.rooms.includes(roomId)) {
      world.setComponent(playerId, "VisitedRooms", {
        rooms: [...visited.rooms, roomId],
      });
    }
  } else {
    world.setComponent(playerId, "VisitedRooms", { rooms: [roomId] });
  }
}
