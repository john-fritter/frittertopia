import { describe, it, expect, beforeEach, vi } from "vitest";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";
import { Parser } from "../src/engine/Parser.js";

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

// ---------------------------------------------------------------------------
// Sensory verbs — listen, smell, touch, taste
// ---------------------------------------------------------------------------

describe("Sensory verbs", () => {
  let world: World;
  let resolver: ActionResolver;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    roomId = world.createEntity("room.sensory");
    world.addComponent(roomId, "Room", { name: "The Herb Garden" });
    world.addComponent(roomId, "Description", { short: "an herb garden" });
    world.addComponent(roomId, "RoomBrief", { brief: "Rosemary and sage crowd the narrow beds." });

    const herb = world.createEntity("garden.rosemary");
    world.addComponent(herb, "Position", { roomId });
    world.addComponent(herb, "Description", { short: "a rosemary sprig" });
    world.addComponent(herb, "Presence", { description: "A sprig of rosemary rests on the bench." });

    playerId = world.createEntity();
    world.addComponent(playerId, "Player", { name: "Tester", sessionId: "s1" });
    world.addComponent(playerId, "Position", { roomId });
    world.addComponent(playerId, "VisitedRooms", { rooms: [roomId] });

    resolver = new ActionResolver(world);
  });

  // --- bare listen ---

  it("bare listen returns a room-level description without error", async () => {
    const result = await resolver.resolve({ verb: "listen" }, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
    expect(result.toPlayer).not.toBe("Touch what?");
    expect(result.toPlayer).not.toContain("You're not going to taste");
  });

  // --- bare smell ---

  it("bare smell returns a room-level description without error", async () => {
    const result = await resolver.resolve({ verb: "smell" }, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
  });

  // --- bare touch — deterministic refusal, no LLM ---

  it("bare touch returns 'Touch what?' and does not call the LLM", async () => {
    const generateMock = vi.spyOn(world.llm, "generate");
    const result = await resolver.resolve({ verb: "touch" }, playerId);
    expect(result.toPlayer).toBe("Touch what?");
    expect(generateMock).not.toHaveBeenCalled();
  });

  // --- bare taste — deterministic refusal, no LLM ---

  it("bare taste returns the room-taste refusal and does not call the LLM", async () => {
    const generateMock = vi.spyOn(world.llm, "generate");
    const result = await resolver.resolve({ verb: "taste" }, playerId);
    expect(result.toPlayer).toBe("You're not going to taste the room.");
    expect(generateMock).not.toHaveBeenCalled();
  });

  // --- targeted verbs with entity match ---

  it("listen to <target> with entity match falls back to presence text on LLM failure", async () => {
    const result = await resolver.resolve({ verb: "listen", target: "rosemary" }, playerId);
    // No LLM key in tests — falls back to presence or short
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
  });

  it("smell <target> with entity match falls back to presence text on LLM failure", async () => {
    const result = await resolver.resolve({ verb: "smell", target: "rosemary" }, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
  });

  it("touch <target> with entity match falls back to presence text on LLM failure", async () => {
    const result = await resolver.resolve({ verb: "touch", target: "rosemary" }, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
  });

  it("taste <target> with entity match falls back to presence text on LLM failure", async () => {
    const result = await resolver.resolve({ verb: "taste", target: "rosemary" }, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
  });

  it("listen to <target> no match returns atmospheric fallback", async () => {
    const result = await resolver.resolve({ verb: "listen", target: "dragon" }, playerId);
    expect(result.toPlayer).toBe("You don't see anything notable.");
  });

  // --- Parser 'to' stripping for listen ---

  it("'listen to rosemary' strips the 'to' preposition and matches entity", async () => {
    // Parsed as verb=listen, target=rosemary (not "to rosemary")
    // Falls back to presence text since no LLM
    const result = await resolver.resolve({ verb: "listen", target: "rosemary" }, playerId);
    // Should NOT return the no-match fallback
    expect(result.toPlayer).not.toBe("You don't see anything notable.");
  });

  // --- sense is passed to the system prompt ---

  it("listen to <target> includes 'listen' command in user prompt", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "You hear rustling." });

    await resolver.resolve({ verb: "listen", target: "rosemary" }, playerId);

    const userPrompt = generateMock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("Command: listen");
  });

  it("touch <target> includes 'touch' command in user prompt", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Rough and resinous." });

    await resolver.resolve({ verb: "touch", target: "rosemary" }, playerId);

    const userPrompt = generateMock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("Command: touch");
  });

  it("taste <target> includes 'taste' command in user prompt", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Piney and bitter." });

    await resolver.resolve({ verb: "taste", target: "rosemary" }, playerId);

    const userPrompt = generateMock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("Command: taste");
  });

  // --- sniff alias for smell (via parser) ---

  it("'sniff' alias routes to smell via the parser", async () => {
    const parser = new Parser();
    const r = new ActionResolver(world, parser);
    const intent = parser.parse("sniff");
    const result = await r.resolve(intent, playerId);
    expect(typeof result.toPlayer).toBe("string");
    expect(result.toPlayer.length).toBeGreaterThan(0);
    expect(result.toPlayer).not.toBe("I don't understand that.");
  });

  // --- feel alias for touch (via parser) ---

  it("'feel' alias routes to touch, bare gives 'Touch what?'", async () => {
    const parser = new Parser();
    const r = new ActionResolver(world, parser);
    const intent = parser.parse("feel");
    const result = await r.resolve(intent, playerId);
    expect(result.toPlayer).toBe("Touch what?");
  });
});
