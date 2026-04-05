import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import { World } from "../src/engine/World.js";
import { Parser } from "../src/engine/Parser.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";
import { GameServer } from "../src/server/Server.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function setupWorld(): World {
  const world = new World();
  registerComponents(world);

  world.registerEvent(
    "sequence_beat",
    z.object({ playerId: z.string(), text: z.string() })
  );
  world.registerEvent(
    "sequence_complete",
    z.object({ playerId: z.string(), roomId: z.string() })
  );
  world.registerEvent(
    "player_destroyed",
    z.object({ playerId: z.string() })
  );

  const roomA = world.createEntity("starting.room");
  world.addComponent(roomA, "Room", { name: "The Courtyard" });
  world.addComponent(roomA, "Description", { short: "a courtyard" });

  const roomB = world.createEntity("room.garden");
  world.addComponent(roomB, "Room", { name: "The Garden" });
  world.addComponent(roomB, "Description", { short: "a garden" });

  world.addComponent(roomA, "Exits", { exits: { south: roomB } });
  world.addComponent(roomB, "Exits", { exits: { north: roomA } });

  // Add an item in the courtyard
  const broom = world.createEntity("monastery.broom");
  world.addComponent(broom, "Position", { roomId: roomA });
  world.addComponent(broom, "Description", { short: "an old broom" });
  world.addComponent(broom, "Presence", {
    description: "An old broom leans against the wall.",
  });

  return world;
}

// --- Unit tests (no server, direct ActionResolver) ---

describe("Admin commands (unit)", () => {
  let world: World;
  let parser: Parser;
  let resolver: ActionResolver;
  let adminId: string;
  let normalId: string;

  beforeEach(() => {
    world = setupWorld();
    parser = new Parser();
    resolver = new ActionResolver(world, parser);

    const startingRoom = world.getEntityByKey("starting.room")!;

    adminId = world.createEntity("player.admin");
    world.addComponent(adminId, "Player", {
      name: "Admin",
      sessionId: "admin-session",
    });
    world.addComponent(adminId, "Position", { roomId: startingRoom });
    world.addComponent(adminId, "VisitedRooms", { rooms: [startingRoom] });
    world.addComponent(adminId, "Admin", { level: 1 });

    normalId = world.createEntity("player.normal");
    world.addComponent(normalId, "Player", {
      name: "Normal",
      sessionId: "normal-session",
    });
    world.addComponent(normalId, "Position", { roomId: startingRoom });
    world.addComponent(normalId, "VisitedRooms", { rooms: [startingRoom] });
  });

  it("non-admin gets flat denial for admin commands", async () => {
    const result = await resolver.resolve({ verb: "@help" }, normalId);
    expect(result.toPlayer).toBe("You don't have permission to do that.");
  });

  it("denial message does not mention admin or reveal command exists", async () => {
    const commands = ["@destroy", "@inspect", "@teleport", "@help"];
    for (const verb of commands) {
      const result = await resolver.resolve({ verb }, normalId);
      const text = result.toPlayer.toLowerCase();
      expect(text).not.toContain("admin");
      expect(text).not.toContain("command");
    }
  });

  it("admin commands do not appear in regular help output", async () => {
    const result = await resolver.resolve({ verb: "help" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).not.toContain("@destroy");
    expect(plain).not.toContain("@inspect");
    expect(plain).not.toContain("@teleport");
    expect(plain).not.toContain("@help");
  });

  it("@help shows admin command list to admins", async () => {
    const result = await resolver.resolve({ verb: "@help" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Admin Commands");
    expect(plain).toContain("@destroy");
    expect(plain).toContain("@inspect");
    expect(plain).toContain("@teleport");
    expect(plain).toContain("@help");
  });

  it("@help shows denial to non-admins", async () => {
    const result = await resolver.resolve({ verb: "@help" }, normalId);
    expect(result.toPlayer).toBe("You don't have permission to do that.");
  });

  it("@destroy removes entity", async () => {
    const targetId = world.createEntity("player.target");
    world.addComponent(targetId, "Player", {
      name: "Target",
      sessionId: "",
    });
    world.addComponent(targetId, "Position", {
      roomId: world.getEntityByKey("starting.room")!,
    });

    const result = await resolver.resolve(
      { verb: "@destroy", target: "target" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Destroyed player: Target");

    // Entity should be gone
    expect(world.getEntityByKey("player.target")).toBeUndefined();
    expect(world.entities.hasEntity(targetId)).toBe(false);
  });

  it("@destroy prevents self-destruction", async () => {
    const result = await resolver.resolve(
      { verb: "@destroy", target: "admin" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("You can't destroy yourself.");
  });

  it("@destroy reports not found for unknown player", async () => {
    const result = await resolver.resolve(
      { verb: "@destroy", target: "nobody" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("No player found: nobody");
  });

  it("@inspect shows component data for a valid target", async () => {
    const result = await resolver.resolve(
      { verb: "@inspect", target: "normal" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("[Inspecting: normal]");
    expect(plain).toContain("Player");
    expect(plain).toContain("name");
    expect(plain).toContain("Normal");
    expect(plain).toContain("Position");
  });

  it("@inspect works with entity string keys", async () => {
    const result = await resolver.resolve(
      { verb: "@inspect", target: "monastery.broom" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("[Inspecting: monastery.broom]");
    expect(plain).toContain("monastery.broom");
    expect(plain).toContain("Description");
    expect(plain).toContain("Presence");
  });

  it("@inspect reports not found for unknown target", async () => {
    const result = await resolver.resolve(
      { verb: "@inspect", target: "nonexistent" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Nothing found: nonexistent");
  });

  it("@teleport moves admin to target room", async () => {
    const result = await resolver.resolve(
      { verb: "@teleport", target: "room.garden" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("The Garden");
    // DescriptionService fallback (no LLM in tests)
    expect(plain).toContain("the garden");

    const pos = world.getComponent(adminId, "Position") as { roomId: string };
    expect(pos.roomId).toBe(world.getEntityByKey("room.garden"));
  });

  it("@teleport shows vanish/appear messages", async () => {
    const result = await resolver.resolve(
      { verb: "@teleport", target: "room.garden" },
      adminId
    );

    // Departure message to old room
    expect(result.toRoom).toBeDefined();
    expect(stripAnsi(result.toRoom!.text)).toContain("Admin vanishes.");
    expect(result.toRoom!.excludePlayer).toBe(adminId);

    // Arrival message to new room
    expect(result.toOtherRoom).toBeDefined();
    expect(stripAnsi(result.toOtherRoom!.text)).toContain("Admin appears.");
  });

  it("@teleport reports not found for unknown room", async () => {
    const result = await resolver.resolve(
      { verb: "@teleport", target: "nonexistent.room" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("No room found: nonexistent.room");
  });

  it("parser handles @-prefixed verbs correctly", () => {
    const intent = parser.parse("@destroy someone");
    expect(intent.verb).toBe("@destroy");
    expect(intent.target).toBe("someone");
  });
});

// --- Integration tests (with server, WebSocket) ---

interface Client {
  ws: WebSocket;
  messages: string[];
  waitForMessage: () => Promise<string>;
  send: (msg: string) => void;
  close: () => Promise<void>;
}

function connectClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages: string[] = [];
    const waiters: Array<(msg: string) => void> = [];

    ws.on("message", (data) => {
      const msg = data.toString();
      if (waiters.length > 0) {
        waiters.shift()!(msg);
      } else {
        messages.push(msg);
      }
    });

    ws.on("open", () => {
      resolve({
        ws,
        messages,
        waitForMessage: () =>
          new Promise<string>((res) => {
            if (messages.length > 0) {
              res(messages.shift()!);
            } else {
              waiters.push(res);
            }
          }),
        send: (msg: string) => ws.send(msg),
        close: () =>
          new Promise<void>((r) => {
            if (ws.readyState === WebSocket.CLOSED) {
              r();
            } else {
              ws.on("close", () => r());
              ws.close();
            }
          }),
      });
    });

    ws.on("error", reject);
  });
}

describe("Admin identification via ADMIN_PLAYERS", () => {
  let world: World;
  let server: GameServer;
  let port: number;

  afterEach(() => {
    server.stop();
    delete process.env["ADMIN_PLAYERS"];
  });

  it("grants admin to player matching ADMIN_PLAYERS (case-insensitive)", async () => {
    process.env["ADMIN_PLAYERS"] = "John,TestBot";
    world = setupWorld();
    server = new GameServer(world);
    server.start(0);
    port = server.getPort()!;

    const client = await connectClient(port);
    await client.waitForMessage(); // "What is your name?"
    client.send("john"); // lowercase, env has "John"
    await client.waitForMessage();

    const entityId = world.getEntityByKey("player.john")!;
    const admin = world.getComponent(entityId, "Admin");
    expect(admin).toBeDefined();

    await client.close();
  });

  it("does not grant admin to non-matching player", async () => {
    process.env["ADMIN_PLAYERS"] = "John";
    world = setupWorld();
    server = new GameServer(world);
    server.start(0);
    port = server.getPort()!;

    const client = await connectClient(port);
    await client.waitForMessage();
    client.send("Maren");
    await client.waitForMessage();

    const entityId = world.getEntityByKey("player.maren")!;
    const admin = world.getComponent(entityId, "Admin");
    expect(admin).toBeUndefined();

    await client.close();
  });

  it("grants admin to first player when ADMIN_PLAYERS is not set", async () => {
    delete process.env["ADMIN_PLAYERS"];
    world = setupWorld();
    server = new GameServer(world);
    server.start(0);
    port = server.getPort()!;

    const client1 = await connectClient(port);
    await client1.waitForMessage();
    client1.send("First");
    await client1.waitForMessage();

    const firstId = world.getEntityByKey("player.first")!;
    expect(world.getComponent(firstId, "Admin")).toBeDefined();

    // Second player should NOT get admin
    const client2 = await connectClient(port);
    await client2.waitForMessage();
    client2.send("Second");
    await client2.waitForMessage();

    const secondId = world.getEntityByKey("player.second")!;
    expect(world.getComponent(secondId, "Admin")).toBeUndefined();

    await client1.close();
    await client2.close();
  });
});
