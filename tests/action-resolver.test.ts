import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod/v4";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";

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
    world.addComponent(roomA, "Description", {
      short: "a stone hall",
      long: "A wide hall of grey stone, cold and echoing.",
    });

    roomB = world.createEntity("room.b");
    world.addComponent(roomB, "Room", { name: "The Garden" });
    world.addComponent(roomB, "Description", {
      short: "a walled garden",
      long: "A small garden enclosed by crumbling walls. Weeds push through the gravel.",
    });

    world.addComponent(roomA, "Exits", { exits: { north: roomB } });
    world.addComponent(roomB, "Exits", { exits: { south: roomA } });

    // Add a presence entity in roomA
    const chair = world.createEntity();
    world.addComponent(chair, "Position", { roomId: roomA });
    world.addComponent(chair, "Description", {
      short: "a wooden chair",
      long: "A heavy oak chair, scarred with knife marks.",
    });
    world.addComponent(chair, "Presence", {
      description: "A wooden chair sits in the corner.",
    });

    // Create the player in roomA
    playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "test-session",
    });
    world.addComponent(playerId, "Position", { roomId: roomA });

    resolver = new ActionResolver(world);
  });

  it("look at current room produces correct output", () => {
    const result = resolver.resolve({ verb: "look" }, playerId);
    const lines = result.toPlayer.split("\n");

    expect(lines[0]).toBe("The Stone Hall");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("A wide hall of grey stone, cold and echoing.");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("Exits: north");
    expect(lines[5]).toBe("A wooden chair sits in the corner.");
  });

  it("move through a valid exit changes position and returns new room look", () => {
    const result = resolver.resolve(
      { verb: "move", target: "north" },
      playerId
    );

    // Player moved to roomB
    const pos = world.getComponent(playerId, "Position") as { roomId: string };
    expect(pos.roomId).toBe(roomB);

    // Output is the look for roomB
    expect(result.toPlayer).toContain("The Garden");
    expect(result.toPlayer).toContain("Weeds push through the gravel.");
    expect(result.toPlayer).toContain("Exits: south");

    // Room messages
    expect(result.toRoom).toEqual({
      roomId: roomA,
      text: "Tester leaves to the north.",
      excludePlayer: playerId,
    });
    expect(result.toOtherRoom).toEqual({
      roomId: roomB,
      text: "Tester arrives.",
    });
  });

  it("move through invalid exit returns error", () => {
    const result = resolver.resolve(
      { verb: "move", target: "west" },
      playerId
    );
    expect(result.toPlayer).toBe("You can't go that way.");
    expect(result.toRoom).toBeUndefined();
  });

  it("look at a specific entity in the room returns its long description", () => {
    const result = resolver.resolve(
      { verb: "look", target: "chair" },
      playerId
    );
    expect(result.toPlayer).toBe(
      "A heavy oak chair, scarred with knife marks."
    );
  });

  it("look at something not in the room returns not-found message", () => {
    const result = resolver.resolve(
      { verb: "look", target: "dragon" },
      playerId
    );
    expect(result.toPlayer).toBe("You don't see that here.");
  });

  it("say produces correct output for speaker and others", () => {
    // Add a second player in the same room
    const otherPlayer = world.createEntity();
    world.addComponent(otherPlayer, "Player", {
      name: "Other",
      sessionId: "other-session",
    });
    world.addComponent(otherPlayer, "Position", { roomId: roomA });

    const result = resolver.resolve(
      { verb: "say", target: "hello everyone" },
      playerId
    );

    expect(result.toPlayer).toBe('You say, "hello everyone"');
    expect(result.toRoom).toEqual({
      roomId: roomA,
      text: 'Tester says, "hello everyone"',
      excludePlayer: playerId,
    });
  });

  it("unrecognized verb returns error", () => {
    const result = resolver.resolve({ verb: "dance" }, playerId);
    expect(result.toPlayer).toBe("I don't understand that.");
  });

  it("other players appear in look output", () => {
    const otherPlayer = world.createEntity();
    world.addComponent(otherPlayer, "Player", {
      name: "Aldric",
      sessionId: "other-session",
    });
    world.addComponent(otherPlayer, "Position", { roomId: roomA });

    const result = resolver.resolve({ verb: "look" }, playerId);
    expect(result.toPlayer).toContain("Aldric is here.");
  });
});
