import { describe, it, expect, beforeEach } from "vitest";
import { World } from "../src/engine/World.js";
import { Parser } from "../src/engine/Parser.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("Help system", () => {
  let world: World;
  let parser: Parser;
  let resolver: ActionResolver;
  let playerId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    const room = world.createEntity("room.a");
    world.addComponent(room, "Room", { name: "Test Room" });
    world.addComponent(room, "Description", {
      short: "a test room",
      long: "A plain test room.",
    });
    world.addComponent(room, "Exits", { exits: {} });

    playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "test-session",
    });
    world.addComponent(playerId, "Position", { roomId: room });
    world.addComponent(playerId, "VisitedRooms", { rooms: [room] });

    parser = new Parser();
    resolver = new ActionResolver(world, parser);
  });

  it("help with no target returns overview with all registered verbs", async () => {
    const result = await resolver.resolve({ verb: "help" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("Available Commands");
    expect(plain).toContain("Movement");
    expect(plain).toContain("move");
    expect(plain).toContain("Interaction");
    expect(plain).toContain("look");
    expect(plain).toContain("Communication");
    expect(plain).toContain("say");
    expect(plain).toContain("System");
    expect(plain).toContain("help");
    expect(plain).toContain("Type 'help <command>' for details.");
  });

  it("help <known-verb> returns description and usage", async () => {
    const result = await resolver.resolve(
      { verb: "help", target: "look" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("look");
    expect(plain).toContain(
      "Look around the room or examine something specific"
    );
    expect(plain).toContain("Usage:");
    expect(plain).toContain("look, look <target>, l");
  });

  it("help <category> returns all verbs in that category", async () => {
    const result = await resolver.resolve(
      { verb: "help", target: "interaction" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("Interaction");
    expect(plain).toContain("look");
    expect(plain).toContain(
      "Look around the room or examine something specific"
    );
    expect(plain).toContain("Usage:");
  });

  it("help <unknown> returns friendly unknown message", async () => {
    const result = await resolver.resolve(
      { verb: "help", target: "dance" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("Nothing known about 'dance'");
    expect(plain).toContain("Type 'help' for a list of commands.");
  });

  it("? alias resolves the same as help", async () => {
    const intent = parser.parse("?");
    expect(intent.verb).toBe("help");

    const result = await resolver.resolve(intent, playerId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Available Commands");
  });

  it("commands alias resolves the same as help", () => {
    const intent = parser.parse("commands");
    expect(intent.verb).toBe("help");
  });

  it("? with a target resolves as help <target>", () => {
    const intent = parser.parse("? look");
    expect(intent.verb).toBe("help");
    expect(intent.target).toBe("look");
  });

  it("verbs without metadata do not appear in help output", async () => {
    // Register a verb with no metadata (like a hidden admin command)
    parser.registerVerb("smite", { aliases: ["sm"] });

    const result = await resolver.resolve({ verb: "help" }, playerId);
    const plain = stripAnsi(result.toPlayer);

    expect(plain).not.toContain("smite");
  });

  it("help for a verb shows correct detail format", async () => {
    const result = await resolver.resolve(
      { verb: "help", target: "say" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("say");
    expect(plain).toContain("Say something out loud");
    expect(plain).toContain("Usage:");
  });

  it("help for move shows movement details", async () => {
    const result = await resolver.resolve(
      { verb: "help", target: "move" },
      playerId
    );
    const plain = stripAnsi(result.toPlayer);

    expect(plain).toContain("move");
    expect(plain).toContain("Move in a direction");
    expect(plain).toContain("north, south, east, west, up, down");
  });
});
