import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { GameServer } from "../src/server/Server.js";
import { ContextBuilder } from "../src/engine/description/ContextBuilder.js";
import { createAccountTable } from "../src/server/auth.js";

const TEST_PASSWORD = "openthegate";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// World / server helpers
// ---------------------------------------------------------------------------

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
  world.registerEvent("player_destroyed", z.object({ playerId: z.string() }));

  const roomId = world.createEntity("starting.room");
  world.addComponent(roomId, "Room", { name: "The Courtyard" });
  world.addComponent(roomId, "Description", { short: "a courtyard" });

  return world;
}

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  createAccountTable(db);
  return db;
}

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
          new Promise<void>((res) => {
            if (ws.readyState === WebSocket.CLOSED) {
              res();
            } else {
              ws.on("close", () => res());
              ws.close();
            }
          }),
      });
    });

    ws.on("error", reject);
  });
}

// Auth through password confirmation; returns the gender prompt message.
async function loginNewUntilGenderPrompt(
  client: Client,
  username: string
): Promise<string> {
  await client.waitForMessage(); // "By what name are you known?"
  client.send(username);
  await client.waitForMessage(); // "No one answers to that name..."
  client.send(TEST_PASSWORD);
  await client.waitForMessage(); // "Speak it once more..."
  client.send(TEST_PASSWORD);
  return client.waitForMessage(); // gender prompt
}

// Full new-player login including gender step; returns the welcome message.
async function loginNew(
  client: Client,
  username: string,
  gender = "female"
): Promise<string> {
  await loginNewUntilGenderPrompt(client, username);
  client.send(gender);
  return client.waitForMessage(); // welcome message
}

// ---------------------------------------------------------------------------
// Server integration tests
// ---------------------------------------------------------------------------

describe("character creation — server integration", () => {
  let world: World;
  let db: Database.Database;
  let server: GameServer;
  let port: number;

  beforeEach(() => {
    world = setupWorld();
    db = setupDb();
    // No sequence template → players go straight to room after gender input
    server = new GameServer(world, db, "starting.room", "sequence.none");
    server.start(0);
    port = server.getPort()!;
  });

  afterEach(() => {
    server.stop();
  });

  it("new player receives gender prompt before welcome message", async () => {
    const client = await connectClient(port);
    const genderPrompt = stripAnsi(
      await loginNewUntilGenderPrompt(client, "Aria")
    );
    expect(genderPrompt).toContain("take shape in this world");
    await client.close();
  });

  it("gender prompt appears before any room description", async () => {
    const client = await connectClient(port);
    const genderPrompt = stripAnsi(
      await loginNewUntilGenderPrompt(client, "Aria")
    );
    // Room name should not appear until after character creation
    expect(genderPrompt).not.toContain("The Courtyard");
    expect(genderPrompt).not.toContain("Welcome");
    await client.close();
  });

  it("explicit gender is stored in CharacterRoll", async () => {
    const client = await connectClient(port);
    await loginNew(client, "Aria", "nonbinary");

    const entityId = world.getEntityByKey("player.aria")!;
    const roll = world.getComponent(entityId, "CharacterRoll") as {
      gender: string;
    };
    expect(roll.gender).toBe("nonbinary");
    await client.close();
  });

  it("empty gender input assigns a random valid gender", async () => {
    const client = await connectClient(port);
    await loginNewUntilGenderPrompt(client, "Aria");
    client.send(""); // press enter — let the world decide
    await client.waitForMessage(); // welcome

    const entityId = world.getEntityByKey("player.aria")!;
    const roll = world.getComponent(entityId, "CharacterRoll") as {
      gender: string;
    };
    expect(["male", "female"]).toContain(roll.gender);
    await client.close();
  });

  it("CharacterRoll component is stored on the player entity", async () => {
    const client = await connectClient(port);
    await loginNew(client, "Aria", "female");

    const entityId = world.getEntityByKey("player.aria")!;
    const roll = world.getComponent(entityId, "CharacterRoll") as Record<
      string,
      unknown
    >;
    expect(roll).toBeDefined();
    expect(typeof roll["gender"]).toBe("string");
    expect(typeof roll["age"]).toBe("string");
    expect(typeof roll["height"]).toBe("string");
    expect(typeof roll["build"]).toBe("string");
    expect(Array.isArray(roll["skinMarks"])).toBe(true);
    await client.close();
  });

  it("CharacterBrief component is stored on the player entity", async () => {
    const client = await connectClient(port);
    await loginNew(client, "Aria", "female");

    const entityId = world.getEntityByKey("player.aria")!;
    const brief = world.getComponent(entityId, "CharacterBrief") as {
      brief: string;
    };
    expect(brief).toBeDefined();
    expect(typeof brief.brief).toBe("string");
    expect(brief.brief.length).toBeGreaterThan(0);
    await client.close();
  });

  it("returning player skips gender prompt and goes straight to welcome back", async () => {
    // First session: complete character creation
    const client1 = await connectClient(port);
    await loginNew(client1, "Aria", "female");
    await client1.close();
    await new Promise((r) => setTimeout(r, 50));

    // Second session: should receive welcome back immediately, no gender prompt
    const client2 = await connectClient(port);
    await client2.waitForMessage(); // "By what name are you known?"
    client2.send("Aria");
    await client2.waitForMessage(); // "The name is known. Speak the word:"
    client2.send(TEST_PASSWORD);
    const response = stripAnsi(await client2.waitForMessage());

    expect(response).toContain("Welcome back, Aria.");
    expect(response).not.toContain("take shape in this world");
    await client2.close();
  });

  it("welcome message is sent after character creation, not before", async () => {
    const client = await connectClient(port);
    await loginNewUntilGenderPrompt(client, "Aria");
    client.send("female");
    const welcome = stripAnsi(await client.waitForMessage());

    expect(welcome).toContain("Welcome, Aria.");
    expect(welcome).toContain("The Courtyard");
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// ContextBuilder unit tests
// ---------------------------------------------------------------------------

describe("ContextBuilder — character briefs", () => {
  let world: World;
  let builder: ContextBuilder;
  let roomId: string;

  beforeEach(() => {
    world = new World();
    registerComponents(world);

    roomId = world.createEntity("room.test");
    world.addComponent(roomId, "Room", { name: "Test Room" });
    world.addComponent(roomId, "Description", { short: "a test room" });

    builder = new ContextBuilder(world);
  });

  function addPlayer(name: string, brief?: string): string {
    const id = world.createEntity();
    world.addComponent(id, "Player", { name, sessionId: "s-" + name });
    world.addComponent(id, "Position", { roomId });
    world.addComponent(id, "VisitedRooms", { rooms: [] });
    if (brief !== undefined) {
      world.addComponent(id, "CharacterBrief", { brief });
    }
    return id;
  }

  it("characterBriefs is empty when no entities have CharacterBrief components", () => {
    const playerId = addPlayer("Solo");
    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toEqual([]);
  });

  it("includes the current player's own brief", () => {
    const playerId = addPlayer("Aria", "Tall woman, auburn hair.");
    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toHaveLength(1);
    expect(ctx.characterBriefs[0]).toEqual({
      name: "Aria",
      brief: "Tall woman, auburn hair.",
    });
  });

  it("omits the current player from characterBriefs when they have no brief", () => {
    const playerId = addPlayer("Aria"); // no brief
    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toEqual([]);
  });

  it("includes briefs for other players present in the room", () => {
    const playerId = addPlayer("Aria"); // no brief
    addPlayer("Pell", "Short man, grey eyes.");

    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toHaveLength(1);
    expect(ctx.characterBriefs[0]).toEqual({
      name: "Pell",
      brief: "Short man, grey eyes.",
    });
  });

  it("includes briefs for multiple players in the room", () => {
    const playerId = addPlayer("Aria", "Tall woman, auburn hair.");
    addPlayer("Pell", "Short man, grey eyes.");
    addPlayer("Rue", "Young person, freckles.");

    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toHaveLength(3);

    const names = ctx.characterBriefs.map((b) => b.name);
    expect(names).toContain("Aria");
    expect(names).toContain("Pell");
    expect(names).toContain("Rue");
  });

  it("excludes players with no CharacterBrief from characterBriefs", () => {
    const playerId = addPlayer("Aria", "Tall woman, auburn hair.");
    addPlayer("Ghost"); // no brief

    const ctx = builder.buildContext(roomId, playerId);
    expect(ctx.characterBriefs).toHaveLength(1);
    expect(ctx.characterBriefs[0]!.name).toBe("Aria");
  });

  it("includes the current player's brief alongside other players' briefs", () => {
    const playerId = addPlayer("Aria", "Tall woman, auburn hair.");
    addPlayer("Pell", "Short man, grey eyes.");

    const ctx = builder.buildContext(roomId, playerId);
    const names = ctx.characterBriefs.map((b) => b.name);
    expect(names).toContain("Aria");
    expect(names).toContain("Pell");
  });
});
