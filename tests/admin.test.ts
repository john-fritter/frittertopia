import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { World } from "../src/engine/World.js";
import { Parser } from "../src/engine/Parser.js";
import { registerComponents } from "../src/game/components.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";
import { GameServer } from "../src/server/Server.js";
import { createAccountTable } from "../src/server/auth.js";

const TEST_PASSWORD = "openthegate";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  createAccountTable(db);
  return db;
}

// Complete new-player auth (username → new acct prompt → password → confirm → welcome msg)
async function loginNew(
  client: {
    waitForMessage: () => Promise<string>;
    send: (m: string) => void;
  },
  username: string
): Promise<string> {
  await client.waitForMessage();
  client.send(username);
  await client.waitForMessage();
  client.send(TEST_PASSWORD);
  await client.waitForMessage();
  client.send(TEST_PASSWORD);
  return client.waitForMessage();
}

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

  it("@help lists all admin commands", async () => {
    const result = await resolver.resolve({ verb: "@help" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("@players");
    expect(plain).toContain("@time");
    expect(plain).toContain("@weather");
    expect(plain).toContain("@temperature");
    expect(plain).toContain("@pressure");
    expect(plain).toContain("@sysinfo");
    expect(plain).toContain("@prompt");
    expect(plain).toContain("@llm");
  });

  it("@players lists players with online/offline status", async () => {
    const result = await resolver.resolve({ verb: "@players" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Players");
    expect(plain).toContain("Admin");
    expect(plain).toContain("Normal");
    expect(plain).toContain("online");
    expect(plain).toContain("offline");
  });

  it("@players shows room name for located players", async () => {
    const result = await resolver.resolve({ verb: "@players" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("The Courtyard");
  });

  it("@sysinfo shows system stats", async () => {
    const result = await resolver.resolve({ verb: "@sysinfo" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("ticks");
    expect(plain).toContain("uptime");
    expect(plain).toContain("entities");
    expect(plain).toContain("online");
    expect(plain).toContain("time");
    expect(plain).toContain("llm debug");
  });

  it("@time with no arg shows current bracket", async () => {
    const result = await resolver.resolve({ verb: "@time" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Time:");
    expect(plain).toMatch(/\d{2}:\d{2}/);
  });

  it("@time HH:MM sets debug time and returns bracket", async () => {
    const { setDebugTime, getDebugTime } = await import("../src/game/solar.js");
    try {
      const result = await resolver.resolve(
        { verb: "@time", target: "12:00" },
        adminId
      );
      const plain = stripAnsi(result.toPlayer);
      expect(plain).toContain("12:00");
      // Returns some valid bracket name
      expect(plain).toMatch(/dawn|morning|midday|afternoon|dusk|evening|night|deep_night/);
      // Debug time is set
      expect(getDebugTime()).not.toBeNull();
    } finally {
      setDebugTime(null);
    }
  });

  it("@time clear resets debug time", async () => {
    const { setDebugTime, getDebugTime } = await import("../src/game/solar.js");
    setDebugTime(new Date("2026-01-01T12:00:00Z"));
    try {
      const result = await resolver.resolve(
        { verb: "@time", target: "clear" },
        adminId
      );
      const plain = stripAnsi(result.toPlayer);
      expect(plain).toContain("cleared");
      expect(getDebugTime()).toBeNull();
    } finally {
      setDebugTime(null);
    }
  });

  it("@time with invalid input shows usage", async () => {
    const result = await resolver.resolve(
      { verb: "@time", target: "teatime" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("Usage:");
  });

  it("@time help shows bracket list", async () => {
    const result = await resolver.resolve(
      { verb: "@time", target: "help" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("@time");
    expect(plain).toContain("deep_night");
    expect(plain).toContain("HH:MM");
    expect(plain).toContain("reset");
  });

  it("@weather help shows states", async () => {
    const result = await resolver.resolve(
      { verb: "@weather", target: "help" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("@weather");
    expect(plain).toContain("clear");
    expect(plain).toContain("storm");
    expect(plain).toContain("reset");
  });

  it("@players help shows usage", async () => {
    const result = await resolver.resolve(
      { verb: "@players", target: "help" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("@players");
    expect(plain).toContain("online");
  });

  it("@prompt shows message when no prompt sent yet", async () => {
    const result = await resolver.resolve({ verb: "@prompt" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("No LLM prompt");
  });

  it("@llm shows current debug mode state", async () => {
    const result = await resolver.resolve({ verb: "@llm" }, adminId);
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("LLM debug mode");
    expect(plain).toContain("off");
  });

  it("@llm on enables debug mode", async () => {
    const result = await resolver.resolve(
      { verb: "@llm", target: "on" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("on");
    expect(world.description.debugMode).toBe(true);
    // clean up
    world.description.setDebugMode(false);
  });

  it("@llm off disables debug mode", async () => {
    world.description.setDebugMode(true);
    const result = await resolver.resolve(
      { verb: "@llm", target: "off" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    expect(plain).toContain("off");
    expect(world.description.debugMode).toBe(false);
  });

  it("@inspect renders multiline strings unescaped", async () => {
    const roomId = world.getEntityByKey("starting.room")!;
    world.addComponent(roomId, "RoomBrief", {
      brief: "Line one.\nLine two.\nLine three.",
    });
    const result = await resolver.resolve(
      { verb: "@inspect", target: "starting.room" },
      adminId
    );
    const plain = stripAnsi(result.toPlayer);
    // Should contain actual newlines rendered as separate lines, not \\n
    expect(plain).toContain("Line one.");
    expect(plain).toContain("Line two.");
    expect(plain).not.toContain("\\n");
  });

  it("non-admin denied for all new admin commands", async () => {
    const newCmds = ["@players", "@time", "@sysinfo", "@prompt", "@llm"];
    for (const verb of newCmds) {
      const result = await resolver.resolve({ verb }, normalId);
      expect(result.toPlayer).toBe("You don't have permission to do that.");
    }
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
    server = new GameServer(world, setupDb());
    server.start(0);
    port = server.getPort()!;

    const client = await connectClient(port);
    await loginNew(client, "john"); // lowercase, env has "John"

    const entityId = world.getEntityByKey("player.john")!;
    const admin = world.getComponent(entityId, "Admin");
    expect(admin).toBeDefined();

    await client.close();
  });

  it("does not grant admin to non-matching player", async () => {
    process.env["ADMIN_PLAYERS"] = "John";
    world = setupWorld();
    server = new GameServer(world, setupDb());
    server.start(0);
    port = server.getPort()!;

    const client = await connectClient(port);
    await loginNew(client, "Maren");

    const entityId = world.getEntityByKey("player.maren")!;
    const admin = world.getComponent(entityId, "Admin");
    expect(admin).toBeUndefined();

    await client.close();
  });

  it("grants admin to first player when ADMIN_PLAYERS is not set", async () => {
    delete process.env["ADMIN_PLAYERS"];
    world = setupWorld();
    const db = setupDb();
    server = new GameServer(world, db);
    server.start(0);
    port = server.getPort()!;

    const client1 = await connectClient(port);
    await loginNew(client1, "First");

    const firstId = world.getEntityByKey("player.first")!;
    expect(world.getComponent(firstId, "Admin")).toBeDefined();

    // Second player should NOT get admin
    const client2 = await connectClient(port);
    await loginNew(client2, "Second");

    const secondId = world.getEntityByKey("player.second")!;
    expect(world.getComponent(secondId, "Admin")).toBeUndefined();

    await client1.close();
    await client2.close();
  });
});
