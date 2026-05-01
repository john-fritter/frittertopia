import type { World } from "../World.js";
import type { ActionResult } from "../ActionResolver.js";
import { formatBold, formatDim, formatSystem, formatYellow } from "../../server/format.js";

const CARRY_LIMIT = 6;

function findItemInRoom(world: World, target: string, roomId: string): string | undefined {
  const lower = target.toLowerCase();
  for (const id of world.getEntitiesWithComponents(["Item", "Position"])) {
    const pos = world.getComponent(id, "Position") as { roomId: string };
    if (pos.roomId !== roomId) continue;
    const desc = world.getComponent(id, "Description") as { short: string } | undefined;
    if (desc && desc.short.toLowerCase().includes(lower)) return id;
  }
  return undefined;
}

function findItemInInventory(world: World, target: string, itemIds: string[]): string | undefined {
  const lower = target.toLowerCase();
  for (const itemId of itemIds) {
    const desc = world.getComponent(itemId, "Description") as { short: string } | undefined;
    if (desc && desc.short.toLowerCase().includes(lower)) return itemId;
  }
  return undefined;
}

export function handleTake(
  world: World,
  target: string | undefined,
  playerId: string
): ActionResult {
  if (!target) return { toPlayer: "Take what?" };

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  const itemId = findItemInRoom(world, target, position.roomId);
  if (!itemId) return { toPlayer: "You don't see that here." };

  const item = world.getComponent(itemId, "Item") as
    | { carryable: boolean }
    | undefined;
  if (!item?.carryable) return { toPlayer: "You can't take that." };

  const inv = world.getComponent(playerId, "Inventory") as
    | { itemIds: string[] }
    | undefined;
  const currentItems = inv?.itemIds ?? [];
  if (currentItems.length >= CARRY_LIMIT) {
    return { toPlayer: "You're carrying too much to take anything else." };
  }

  world.removeComponent(itemId, "Position");

  // Clear decay timer so it doesn't count down while carried
  const state = world.getComponent(itemId, "ItemState") as
    | Record<string, unknown>
    | undefined;
  if (state !== undefined && "placedAt" in state) {
    const { placedAt: _removed, ...rest } = state;
    world.setComponent(itemId, "ItemState", rest);
  }

  world.setComponent(playerId, "Inventory", { itemIds: [...currentItems, itemId] });

  const desc = world.getComponent(itemId, "Description") as
    | { short: string }
    | undefined;
  return { toPlayer: formatSystem(`You take ${desc?.short ?? "it"}.`) };
}

export function handleDrop(
  world: World,
  target: string | undefined,
  playerId: string
): ActionResult {
  if (!target) return { toPlayer: "Drop what?" };

  const inv = world.getComponent(playerId, "Inventory") as
    | { itemIds: string[] }
    | undefined;
  if (!inv || inv.itemIds.length === 0) {
    return { toPlayer: "You aren't carrying anything." };
  }

  const itemId = findItemInInventory(world, target, inv.itemIds);
  if (!itemId) return { toPlayer: "You aren't carrying that." };

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  if (!position) return { toPlayer: "You aren't anywhere." };

  world.setComponent(playerId, "Inventory", {
    itemIds: inv.itemIds.filter((id) => id !== itemId),
  });
  world.setComponent(itemId, "Position", { roomId: position.roomId });

  // Start decay clock for template items
  if (world.getComponent(itemId, "ItemTemplate")) {
    const state = world.getComponent(itemId, "ItemState") as
      | Record<string, unknown>
      | undefined;
    world.setComponent(itemId, "ItemState", {
      ...(state ?? {}),
      placedAt: Date.now(),
    });
  }

  const desc = world.getComponent(itemId, "Description") as
    | { short: string }
    | undefined;
  return { toPlayer: formatSystem(`You drop ${desc?.short ?? "it"}.`) };
}

export function handleInventory(world: World, playerId: string): ActionResult {
  const inv = world.getComponent(playerId, "Inventory") as
    | { itemIds: string[] }
    | undefined;
  if (!inv || inv.itemIds.length === 0) {
    return { toPlayer: formatDim("You aren't carrying anything.") };
  }

  const lines: string[] = [formatBold("You are carrying:")];
  for (const itemId of inv.itemIds) {
    const desc = world.getComponent(itemId, "Description") as
      | { short: string }
      | undefined;
    lines.push(`  ${formatYellow(desc?.short ?? "something")}`);
  }
  return { toPlayer: lines.join("\n") };
}
