import { describe, it, expect, beforeEach } from "vitest";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("where command", () => {
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
    world.addComponent(roomA, "Description", { short: "A wide hall of grey stone." });

    roomB = world.createEntity("room.b");
    world.addComponent(roomB, "Room", { name: "The Garden" });
    world.addComponent(roomB, "Description", { short: "A walled garden." });

    world.addComponent(roomA, "Exits", { exits: { north: roomB, east: "room.missing" } });
    world.addComponent(roomB, "Exits", { exits: { south: roomA } });

    playerId = world.createEntity();
    world.addComponent(playerId, "Player", { name: "Tester", sessionId: "s1" });
    world.addComponent(playerId, "Position", { roomId: roomA });
    world.addComponent(playerId, "VisitedRooms", { rooms: [roomA] });

    resolver = new ActionResolver(world);
  });

  it("shows short description, exits, and footer", async () => {
    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("The Stone Hall");
    expect(plain).toContain("A wide hall of grey stone.");
    expect(plain).toContain("Exits:");
    // Footer direction abbreviation
    expect(plain).toMatch(/N\s+E/);
    // Indoor footer
    expect(plain).toContain("indoor");
  });

  it("hides exit room names for unvisited rooms", async () => {
    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Exits: north");
    expect(plain).not.toContain("(The Garden)");
  });

  it("shows exit room names after visiting", async () => {
    world.setComponent(playerId, "VisitedRooms", { rooms: [roomA, roomB] });
    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("north (The Garden)");
  });

  it("omits Players and Items lines when room is empty", async () => {
    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).not.toContain("Players:");
    expect(plain).not.toContain("Items:");
  });

  it("lists other players under Players:", async () => {
    const aldric = world.createEntity();
    world.addComponent(aldric, "Player", { name: "Aldric", sessionId: "s2" });
    world.addComponent(aldric, "Position", { roomId: roomA });

    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Players: Aldric");
  });

  it("lists items by short description under Items:", async () => {
    const broom = world.createEntity();
    world.addComponent(broom, "Position", { roomId: roomA });
    world.addComponent(broom, "Description", { short: "broom" });
    world.addComponent(broom, "Presence", { description: "A broom leans against the wall." });

    const result = await resolver.resolve({ verb: "where" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Items: broom");
  });

  it("does not call the LLM", async () => {
    let called = false;
    const originalGenerate = world.llm.generate.bind(world.llm);
    world.llm.generate = async (...args) => {
      called = true;
      return originalGenerate(...args);
    };

    await resolver.resolve({ verb: "where" }, playerId);
    expect(called).toBe(false);
  });

  it("returns error when player has no position", async () => {
    const orphan = world.createEntity();
    world.addComponent(orphan, "Player", { name: "Orphan", sessionId: "s3" });
    const result = await resolver.resolve({ verb: "where" }, orphan);
    expect(result.toPlayer).toBe("You aren't anywhere.");
  });

  it("appears in help output under senses", async () => {
    const result = await resolver.resolve({ verb: "help" }, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("where");
  });
});
