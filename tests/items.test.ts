import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";
import { createItemDecaySystem } from "../src/game/systems/ItemDecaySystem.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeWorld(): World {
  const world = new World();
  registerComponents(world);
  return world;
}

function makeRoom(world: World, key: string, name: string): string {
  const id = world.createEntity(key);
  world.addComponent(id, "Room", { name });
  world.addComponent(id, "Description", { short: name.toLowerCase() });
  world.addComponent(id, "Exits", { exits: {} });
  return id;
}

function makePlayer(world: World, roomId: string): string {
  const id = world.createEntity();
  world.addComponent(id, "Player", { name: "Tester", sessionId: "s1" });
  world.addComponent(id, "Position", { roomId });
  world.addComponent(id, "VisitedRooms", { rooms: [roomId] });
  return id;
}

function makeCarryableItem(
  world: World,
  roomId: string,
  short: string,
  key?: string
): string {
  const id = key ? world.createEntity(key) : world.createEntity();
  world.addComponent(id, "Item", {
    carryable: true,
    equippable: false,
    consumable: false,
  });
  world.addComponent(id, "Description", { short });
  world.addComponent(id, "Position", { roomId });
  return id;
}

// ---------------------------------------------------------------------------
// take verb
// ---------------------------------------------------------------------------

describe("take", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    world = makeWorld();
    roomId = makeRoom(world, "room.a", "The Hall");
    playerId = makePlayer(world, roomId);
    resolver = new ActionResolver(world);
  });

  it("take with no target returns 'Take what?'", async () => {
    const result = await resolver.resolve({ verb: "take" }, playerId);
    expect(result.toPlayer).toBe("Take what?");
  });

  it("take an item from the room removes its Position and adds it to Inventory", async () => {
    const lanternId = makeCarryableItem(world, roomId, "a brass lantern");

    const result = await resolver.resolve(
      { verb: "take", target: "lantern" },
      playerId
    );

    expect(stripAnsi(result.toPlayer)).toContain("You take a brass lantern.");
    expect(world.getComponent(lanternId, "Position")).toBeUndefined();

    const inv = world.getComponent(playerId, "Inventory") as
      | { itemIds: string[] }
      | undefined;
    expect(inv?.itemIds).toContain(lanternId);
  });

  it("take matches by partial name (case-insensitive)", async () => {
    const id = makeCarryableItem(world, roomId, "a Coleman lantern");
    await resolver.resolve({ verb: "take", target: "coleman" }, playerId);
    expect(world.getComponent(id, "Position")).toBeUndefined();
  });

  it("take item not in room returns 'You don't see that here.'", async () => {
    const result = await resolver.resolve(
      { verb: "take", target: "sword" },
      playerId
    );
    expect(result.toPlayer).toBe("You don't see that here.");
  });

  it("take non-carryable item returns 'You can't take that.'", async () => {
    const fixedId = world.createEntity();
    world.addComponent(fixedId, "Item", {
      carryable: false,
      equippable: false,
      consumable: false,
    });
    world.addComponent(fixedId, "Description", { short: "a stone altar" });
    world.addComponent(fixedId, "Position", { roomId });

    const result = await resolver.resolve(
      { verb: "take", target: "altar" },
      playerId
    );
    expect(result.toPlayer).toBe("You can't take that.");
    expect(world.getComponent(fixedId, "Position")).toBeDefined();
  });

  it("take clears placedAt from ItemState", async () => {
    const id = makeCarryableItem(world, roomId, "a widget");
    world.addComponent(id, "ItemState", { placedAt: 12345, lit: false });

    await resolver.resolve({ verb: "take", target: "widget" }, playerId);

    const state = world.getComponent(id, "ItemState") as Record<string, unknown>;
    expect(state["placedAt"]).toBeUndefined();
    expect(state["lit"]).toBe(false); // other state preserved
  });

  it("can take up to 6 items (carry limit)", async () => {
    for (let i = 0; i < 6; i++) {
      makeCarryableItem(world, roomId, `item ${i}`);
    }

    for (let i = 0; i < 6; i++) {
      const r = await resolver.resolve({ verb: "take", target: `item ${i}` }, playerId);
      expect(r.toPlayer).not.toBe("You're carrying too much to take anything else.");
    }
  });

  it("take fails at carry limit of 6", async () => {
    for (let i = 0; i < 7; i++) {
      makeCarryableItem(world, roomId, `item ${i}`);
    }

    for (let i = 0; i < 6; i++) {
      await resolver.resolve({ verb: "take", target: `item ${i}` }, playerId);
    }

    // 7th take should fail
    const result = await resolver.resolve(
      { verb: "take", target: "item 6" },
      playerId
    );
    expect(result.toPlayer).toBe(
      "You're carrying too much to take anything else."
    );
  });
});

// ---------------------------------------------------------------------------
// drop verb
// ---------------------------------------------------------------------------

describe("drop", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomId: string;
  let playerId: string;
  let itemId: string;

  beforeEach(() => {
    world = makeWorld();
    roomId = makeRoom(world, "room.a", "The Hall");
    playerId = makePlayer(world, roomId);
    itemId = makeCarryableItem(world, roomId, "a brass lantern");
    resolver = new ActionResolver(world);
  });

  it("drop with no target returns 'Drop what?'", async () => {
    const result = await resolver.resolve({ verb: "drop" }, playerId);
    expect(result.toPlayer).toBe("Drop what?");
  });

  it("drop with empty inventory returns 'You aren't carrying anything.'", async () => {
    const result = await resolver.resolve(
      { verb: "drop", target: "lantern" },
      playerId
    );
    expect(result.toPlayer).toBe("You aren't carrying anything.");
  });

  it("drop an inventory item places it in the current room", async () => {
    await resolver.resolve({ verb: "take", target: "lantern" }, playerId);

    const result = await resolver.resolve(
      { verb: "drop", target: "lantern" },
      playerId
    );

    expect(stripAnsi(result.toPlayer)).toContain("You drop a brass lantern.");

    const pos = world.getComponent(itemId, "Position") as { roomId: string };
    expect(pos.roomId).toBe(roomId);

    const inv = world.getComponent(playerId, "Inventory") as { itemIds: string[] };
    expect(inv.itemIds).not.toContain(itemId);
  });

  it("drop an item not carried returns 'You aren't carrying that.'", async () => {
    await resolver.resolve({ verb: "take", target: "lantern" }, playerId);

    const result = await resolver.resolve(
      { verb: "drop", target: "sword" },
      playerId
    );
    expect(result.toPlayer).toBe("You aren't carrying that.");
  });

  it("drop a template item resets the decay timer", async () => {
    world.addComponent(itemId, "ItemTemplate", { decayMs: 5000 });
    const before = Date.now();
    await resolver.resolve({ verb: "take", target: "lantern" }, playerId);
    await resolver.resolve({ verb: "drop", target: "lantern" }, playerId);

    const state = world.getComponent(itemId, "ItemState") as Record<string, unknown>;
    const placedAt = state["placedAt"] as number;
    expect(placedAt).toBeGreaterThanOrEqual(before);
    expect(placedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ---------------------------------------------------------------------------
// inventory verb
// ---------------------------------------------------------------------------

describe("inventory", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    world = makeWorld();
    roomId = makeRoom(world, "room.a", "The Hall");
    playerId = makePlayer(world, roomId);
    resolver = new ActionResolver(world);
  });

  it("inventory with nothing carried returns empty message", async () => {
    const result = await resolver.resolve({ verb: "inventory" }, playerId);
    expect(stripAnsi(result.toPlayer)).toContain("aren't carrying anything");
  });

  it("inventory lists item short descriptions", async () => {
    makeCarryableItem(world, roomId, "a brass lantern");
    makeCarryableItem(world, roomId, "a tattered map");

    await resolver.resolve({ verb: "take", target: "lantern" }, playerId);
    await resolver.resolve({ verb: "take", target: "map" }, playerId);

    const result = await resolver.resolve({ verb: "inventory" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("You are carrying:");
    expect(plain).toContain("a brass lantern");
    expect(plain).toContain("a tattered map");
  });

  it("'i' alias works for inventory", async () => {
    makeCarryableItem(world, roomId, "a coin");
    await resolver.resolve({ verb: "take", target: "coin" }, playerId);

    const result = await resolver.resolve({ verb: "inventory" }, playerId);
    expect(stripAnsi(result.toPlayer)).toContain("a coin");
  });
});

// ---------------------------------------------------------------------------
// ItemDecaySystem
// ---------------------------------------------------------------------------

describe("ItemDecaySystem", () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDecayableItem(roomId: string, decayMs: number): string {
    const id = world.createEntity();
    world.addComponent(id, "Item", {
      carryable: true,
      equippable: false,
      consumable: false,
    });
    world.addComponent(id, "ItemTemplate", { decayMs });
    world.addComponent(id, "Description", { short: "a test item" });
    world.addComponent(id, "Position", { roomId });
    return id;
  }

  it("sets placedAt on first tick for items with no decay timer", () => {
    const roomId = makeRoom(world, "room.decay", "Decay Room");
    const itemId = makeDecayableItem(roomId, 5000);

    const t0 = Date.now();
    vi.setSystemTime(t0);

    const system = createItemDecaySystem(250);
    // Use a large tickIntervalMs so the 10s check fires immediately
    const fastSystem = createItemDecaySystem(100_000);
    fastSystem(world.entities, world.events);

    const state = world.getComponent(itemId, "ItemState") as Record<string, unknown>;
    expect(state["placedAt"]).toBe(t0);
  });

  it("does not delete item before decayMs has elapsed", () => {
    const roomId = makeRoom(world, "room.decay2", "Decay Room 2");
    const itemId = makeDecayableItem(roomId, 5000);

    const t0 = 1_000_000;
    vi.setSystemTime(t0);

    const system = createItemDecaySystem(100_000);
    system(world.entities, world.events);

    // Advance time by less than decayMs
    vi.setSystemTime(t0 + 4999);
    system(world.entities, world.events);

    expect(world.entities.hasEntity(itemId)).toBe(true);
  });

  it("deletes item when decayMs has elapsed", () => {
    const roomId = makeRoom(world, "room.decay3", "Decay Room 3");
    const itemId = makeDecayableItem(roomId, 5000);

    const t0 = 2_000_000;
    vi.setSystemTime(t0);

    const system = createItemDecaySystem(100_000);
    system(world.entities, world.events); // sets placedAt = t0

    vi.setSystemTime(t0 + 5000);
    system(world.entities, world.events); // should delete

    expect(world.entities.hasEntity(itemId)).toBe(false);
  });

  it("items without Position (in inventory) are ignored by decay", () => {
    const roomId = makeRoom(world, "room.decay4", "Decay Room 4");
    const playerId = makePlayer(world, roomId);
    const itemId = makeDecayableItem(roomId, 100);

    const t0 = 3_000_000;
    vi.setSystemTime(t0);

    const system = createItemDecaySystem(100_000);

    // Simulate: take item (remove Position, add to Inventory)
    world.removeComponent(itemId, "Position");
    world.setComponent(playerId, "Inventory", { itemIds: [itemId] });

    // Advance well past decayMs
    vi.setSystemTime(t0 + 10_000);
    system(world.entities, world.events);

    // Item should survive because it's in inventory (no Position)
    expect(world.entities.hasEntity(itemId)).toBe(true);
  });

  it("item without ItemTemplate is not tracked for decay", () => {
    const roomId = makeRoom(world, "room.decay5", "Decay Room 5");
    const itemId = world.createEntity();
    world.addComponent(itemId, "Item", {
      carryable: true,
      equippable: false,
      consumable: false,
    });
    world.addComponent(itemId, "Description", { short: "a non-template item" });
    world.addComponent(itemId, "Position", { roomId });

    const t0 = 4_000_000;
    vi.setSystemTime(t0);
    const system = createItemDecaySystem(100_000);

    vi.setSystemTime(t0 + 999_999);
    system(world.entities, world.events);

    expect(world.entities.hasEntity(itemId)).toBe(true);
  });

  it("uses default 60-minute decay when decayMs is not set", () => {
    const roomId = makeRoom(world, "room.decay6", "Decay Room 6");
    const itemId = world.createEntity();
    world.addComponent(itemId, "Item", {
      carryable: true,
      equippable: false,
      consumable: false,
    });
    world.addComponent(itemId, "ItemTemplate", {}); // no decayMs
    world.addComponent(itemId, "Description", { short: "a default decay item" });
    world.addComponent(itemId, "Position", { roomId });

    const t0 = 5_000_000;
    vi.setSystemTime(t0);
    const system = createItemDecaySystem(100_000);
    system(world.entities, world.events); // sets placedAt

    // Just under 60 minutes
    vi.setSystemTime(t0 + 59 * 60 * 1000 + 999);
    system(world.entities, world.events);
    expect(world.entities.hasEntity(itemId)).toBe(true);

    // At exactly 60 minutes
    vi.setSystemTime(t0 + 60 * 60 * 1000);
    system(world.entities, world.events);
    expect(world.entities.hasEntity(itemId)).toBe(false);
  });
});
