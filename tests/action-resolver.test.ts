import { describe, it, expect, beforeEach } from "vitest";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("ActionResolver", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomA: string;
  let roomB: string;
  let playerId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    roomA = world.createEntity("room.a");
    world.addComponent(roomA, "Room", { name: "The Stone Hall" });
    world.addComponent(roomA, "Description", { short: "a stone hall" });

    roomB = world.createEntity("room.b");
    world.addComponent(roomB, "Room", { name: "The Garden" });
    world.addComponent(roomB, "Description", { short: "a walled garden" });

    world.addComponent(roomA, "Exits", { exits: { north: roomB } });
    world.addComponent(roomB, "Exits", { exits: { south: roomA } });

    // Add a presence entity in roomA
    const chair = world.createEntity();
    world.addComponent(chair, "Position", { roomId: roomA });
    world.addComponent(chair, "Description", { short: "a wooden chair" });
    world.addComponent(chair, "Presence", {
      description: "A wooden chair sits in the corner.",
    });

    // Create the player in roomA with visited rooms
    playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "test-session",
    });
    world.addComponent(playerId, "Position", { roomId: roomA });
    world.addComponent(playerId, "VisitedRooms", { rooms: [roomA] });

    resolver = new ActionResolver(world);
  });

  it("look at current room produces correct output", async () => {
    const result = await resolver.resolve({ verb: "look" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("The Stone Hall");
    // DescriptionService fallback (no LLM in tests)
    expect(plain).toContain("the stone hall");
    expect(plain).toContain("A wooden chair sits in the corner.");
    expect(plain).toContain("north");
  });

  it("move through a valid exit changes position and returns new room look", async () => {
    const result = await resolver.resolve(
      { verb: "move", target: "north" },
      playerId
    );

    // Player moved to roomB
    const pos = world.getComponent(playerId, "Position") as { roomId: string };
    expect(pos.roomId).toBe(roomB);

    // Output is the look for roomB
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("The Garden");
    // DescriptionService fallback (no LLM in tests)
    expect(plain).toContain("the garden");
    expect(plain).toContain("south");

    // Room messages contain ANSI codes
    expect(result.toRoom).toBeDefined();
    expect(stripAnsi(result.toRoom!.text)).toContain("Tester");
    expect(stripAnsi(result.toRoom!.text)).toContain("leaves to the north");
    expect(result.toRoom!.roomId).toBe(roomA);
    expect(result.toRoom!.excludePlayer).toBe(playerId);

    expect(result.toOtherRoom).toBeDefined();
    expect(stripAnsi(result.toOtherRoom!.text)).toContain("Tester");
    expect(stripAnsi(result.toOtherRoom!.text)).toContain("arrives");
    expect(result.toOtherRoom!.roomId).toBe(roomB);
  });

  it("move through invalid exit returns error", async () => {
    const result = await resolver.resolve(
      { verb: "move", target: "west" },
      playerId
    );
    expect(result.toPlayer).toBe("You can't go that way.");
    expect(result.toRoom).toBeUndefined();
  });

  it("look at matched entity uses presence text as fallback (no LLM)", async () => {
    // The chair in roomA has Presence: "A wooden chair sits in the corner."
    const result = await resolver.resolve(
      { verb: "look", target: "chair" },
      playerId
    );
    expect(result.toPlayer).toBe("A wooden chair sits in the corner.");
  });

  it("look at unknown target returns atmospheric fallback (no LLM)", async () => {
    const result = await resolver.resolve(
      { verb: "look", target: "dragon" },
      playerId
    );
    expect(result.toPlayer).toBe("You don't see anything notable.");
  });

  it("say produces correct output for speaker and others", async () => {
    const otherPlayer = world.createEntity();
    world.addComponent(otherPlayer, "Player", {
      name: "Other",
      sessionId: "other-session",
    });
    world.addComponent(otherPlayer, "Position", { roomId: roomA });

    const result = await resolver.resolve(
      { verb: "say", target: "hello everyone" },
      playerId
    );

    expect(stripAnsi(result.toPlayer)).toBe('You say, "hello everyone"');
    expect(stripAnsi(result.toRoom!.text)).toBe(
      'Tester says, "hello everyone"'
    );
    expect(result.toRoom!.roomId).toBe(roomA);
    expect(result.toRoom!.excludePlayer).toBe(playerId);
  });

  it("unrecognized verb returns error", async () => {
    const result = await resolver.resolve({ verb: "dance" }, playerId);
    expect(result.toPlayer).toBe("I don't understand that.");
  });

  it("other players appear in look output", async () => {
    const otherPlayer = world.createEntity();
    world.addComponent(otherPlayer, "Player", {
      name: "Aldric",
      sessionId: "other-session",
    });
    world.addComponent(otherPlayer, "Position", { roomId: roomA });

    const result = await resolver.resolve({ verb: "look" }, playerId);
    expect(stripAnsi(result.toPlayer)).toContain("Aldric");
    expect(stripAnsi(result.toPlayer)).toContain("is here");
  });
});

describe("VisitedRooms behavior", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomA: string;
  let roomB: string;
  let playerId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    roomA = world.createEntity("room.a");
    world.addComponent(roomA, "Room", { name: "The Stone Hall" });
    world.addComponent(roomA, "Description", { short: "a stone hall" });

    roomB = world.createEntity("room.b");
    world.addComponent(roomB, "Room", { name: "The Garden" });
    world.addComponent(roomB, "Description", { short: "a walled garden" });

    world.addComponent(roomA, "Exits", { exits: { north: roomB } });
    world.addComponent(roomB, "Exits", { exits: { south: roomA } });

    playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "test-session",
    });
    world.addComponent(playerId, "Position", { roomId: roomA });
    world.addComponent(playerId, "VisitedRooms", { rooms: [roomA] });

    resolver = new ActionResolver(world);
  });

  it("first visit to a room shows description", async () => {
    const result = await resolver.resolve(
      { verb: "move", target: "north" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("The Garden");
    // DescriptionService fallback (no LLM in tests)
    expect(plain).toContain("the garden");
  });

  it("revisit shows short description", async () => {
    world.setComponent(playerId, "VisitedRooms", {
      rooms: [roomA, roomB],
    });

    const result = await resolver.resolve(
      { verb: "move", target: "north" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("a walled garden");
  });

  it("explicit look shows description", async () => {
    const result = await resolver.resolve({ verb: "look" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("The Stone Hall");
    // DescriptionService fallback (no LLM in tests)
    expect(plain).toContain("the stone hall");
  });

  it("moving to a room adds it to visited rooms", async () => {
    await resolver.resolve({ verb: "move", target: "north" }, playerId);

    const visited = world.getComponent(playerId, "VisitedRooms") as {
      rooms: string[];
    };
    expect(visited.rooms).toContain(roomB);
  });

  it("exit room names shown only for visited rooms", async () => {
    // Player is in roomA, roomB is not visited
    const result = await resolver.resolve({ verb: "look" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    // roomB exit should show bare direction, no room name
    expect(plain).toContain("north");
    expect(plain).not.toContain("The Garden");
  });

  it("exit room names shown for visited rooms", async () => {
    // Mark roomB as visited
    world.setComponent(playerId, "VisitedRooms", {
      rooms: [roomA, roomB],
    });

    const result = await resolver.resolve({ verb: "look" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    // roomB exit should show room name
    expect(plain).toContain("north");
    expect(plain).toContain("The Garden");
  });
});

describe("Entity matching for targeted look", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomId: string;
  let playerId: string;
  let itemId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    roomId = world.createEntity("room.test");
    world.addComponent(roomId, "Room", { name: "The Test Room" });
    world.addComponent(roomId, "Description", { short: "a test room" });
    world.addComponent(roomId, "Exits", { exits: {} });

    // Item: "a wild rosemary bush" with key "monastery.rosemary-bush"
    itemId = world.createEntity("monastery.rosemary-bush");
    world.addComponent(itemId, "Position", { roomId });
    world.addComponent(itemId, "Description", { short: "a wild rosemary bush" });
    world.addComponent(itemId, "Presence", { description: "A vast rosemary bush sprawls across the path." });

    playerId = world.createEntity();
    world.addComponent(playerId, "Player", { name: "Tester", sessionId: "s1" });
    world.addComponent(playerId, "Position", { roomId });
    world.addComponent(playerId, "VisitedRooms", { rooms: [roomId] });

    resolver = new ActionResolver(world);
  });

  it("matches entity by Description.short substring", async () => {
    const result = await resolver.resolve({ verb: "look", target: "rosemary" }, playerId);
    // With no LLM, falls back to presence text of matched entity
    expect(result.toPlayer).toBe("A vast rosemary bush sprawls across the path.");
  });

  it("matches entity by entity key leaf", async () => {
    const result = await resolver.resolve({ verb: "look", target: "rosemary bush" }, playerId);
    expect(result.toPlayer).toBe("A vast rosemary bush sprawls across the path.");
  });

  it("strips articles before matching", async () => {
    const result = await resolver.resolve({ verb: "look", target: "the rosemary bush" }, playerId);
    expect(result.toPlayer).toBe("A vast rosemary bush sprawls across the path.");
  });

  it("matching is case-insensitive", async () => {
    const result = await resolver.resolve({ verb: "look", target: "ROSEMARY" }, playerId);
    expect(result.toPlayer).toBe("A vast rosemary bush sprawls across the path.");
  });

  it("matches another player by name", async () => {
    const otherId = world.createEntity();
    world.addComponent(otherId, "Player", { name: "Alice", sessionId: "s2" });
    world.addComponent(otherId, "Position", { roomId });

    const result = await resolver.resolve({ verb: "look", target: "alice" }, playerId);
    // Entity match found (Player), no presence → fallback uses playerName
    expect(result.toPlayer).toBe("Alice");
  });

  it("no match returns atmospheric fallback", async () => {
    const result = await resolver.resolve({ verb: "look", target: "dragon" }, playerId);
    expect(result.toPlayer).toBe("You don't see anything notable.");
  });

  it("does not match entities in other rooms", async () => {
    const otherRoom = world.createEntity("room.other");
    world.addComponent(otherRoom, "Room", { name: "Other Room" });
    const farItem = world.createEntity();
    world.addComponent(farItem, "Position", { roomId: otherRoom });
    world.addComponent(farItem, "Description", { short: "a golden crown" });
    world.addComponent(farItem, "Presence", { description: "A crown sits on a pedestal." });

    const result = await resolver.resolve({ verb: "look", target: "crown" }, playerId);
    expect(result.toPlayer).toBe("You don't see anything notable.");
  });
});
