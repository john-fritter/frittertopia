import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { GameServer } from "../src/server/Server.js";
import { createAccountTable } from "../src/server/auth.js";

const TEST_PASSWORD = "openthegate";

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

// Complete the new-player auth flow and return the final welcome message.
async function loginNew(client: Client, username: string): Promise<string> {
  await client.waitForMessage(); // "By what name are you known?"
  client.send(username);
  await client.waitForMessage(); // "No one answers to that name..."
  client.send(TEST_PASSWORD);
  await client.waitForMessage(); // "Speak it once more..."
  client.send(TEST_PASSWORD);
  return client.waitForMessage(); // welcome message
}

// Complete the returning-player auth flow and return the final welcome message.
async function loginReturning(
  client: Client,
  username: string
): Promise<string> {
  await client.waitForMessage(); // "By what name are you known?"
  client.send(username);
  await client.waitForMessage(); // "The name is known. Speak the word:"
  client.send(TEST_PASSWORD);
  return client.waitForMessage(); // welcome back message
}

describe("GameServer", () => {
  let world: World;
  let db: Database.Database;
  let server: GameServer;
  let port: number;

  beforeEach(() => {
    world = setupWorld();
    db = setupDb();
    server = new GameServer(world, db);
    server.start(0); // random port
    port = server.getPort()!;
  });

  afterEach(() => {
    server.stop();
  });

  describe("username validation", () => {
    it("rejects names shorter than 2 characters", async () => {
      const client = await connectClient(port);
      await client.waitForMessage(); // "By what name are you known?"
      client.send("A");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("2\u201320 characters");
      expect(response).toContain("By what name are you known?");
      await client.close();
    });

    it("rejects names longer than 20 characters", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Abcdefghijklmnopqrstu"); // 21 chars
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("2\u201320 characters");
      await client.close();
    });

    it("rejects names with numbers", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Player1");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("only letters");
      await client.close();
    });

    it("rejects names with spaces", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("My Name");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("only letters");
      await client.close();
    });

    it("rejects names with special characters", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Player!");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("only letters");
      await client.close();
    });

    it("accepts valid names and offers account creation", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Maren");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("No one answers to that name");
      await client.close();
    });
  });

  describe("new player creation", () => {
    it("creates account and player entity on first login", async () => {
      const client = await connectClient(port);
      const response = stripAnsi(await loginNew(client, "Aldric"));
      expect(response).toContain("Welcome, Aldric.");

      const entityId = world.getEntityByKey("player.aldric");
      expect(entityId).toBeDefined();
      await client.close();
    });

    it("creates entity with key player.<lowercased-name>", async () => {
      const client = await connectClient(port);
      await loginNew(client, "Aldric");

      const entityId = world.getEntityByKey("player.aldric");
      expect(entityId).toBeDefined();
      await client.close();
    });

    it("gives new player correct starting components", async () => {
      const client = await connectClient(port);
      await loginNew(client, "Aldric");

      const entityId = world.getEntityByKey("player.aldric")!;
      const player = world.getComponent(entityId, "Player") as {
        name: string;
        sessionId: string;
      };
      expect(player.name).toBe("Aldric");
      expect(player.sessionId).toBeTruthy();

      const position = world.getComponent(entityId, "Position") as {
        roomId: string;
      };
      const startingRoom = world.getEntityByKey("starting.room")!;
      expect(position.roomId).toBe(startingRoom);

      const visited = world.getComponent(entityId, "VisitedRooms") as {
        rooms: string[];
      };
      expect(visited.rooms).toContain(startingRoom);

      await client.close();
    });

    it("shows room description on first connect", async () => {
      const client = await connectClient(port);
      const response = stripAnsi(await loginNew(client, "Aldric"));
      expect(response).toContain("Welcome, Aldric.");
      expect(response).toContain("The Courtyard");
      expect(response).toContain("the courtyard"); // DescriptionService fallback text
      await client.close();
    });
  });

  describe("returning player", () => {
    it("reattaches to existing entity without creating a new one", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");

      const entityId = world.getEntityByKey("player.maren")!;
      expect(entityId).toBeDefined();

      const garden = world.getEntityByKey("room.garden")!;
      world.setComponent(entityId, "Position", { roomId: garden });

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      const response = stripAnsi(await loginReturning(client2, "Maren"));

      expect(response).toContain("Welcome back, Maren.");
      expect(response).toContain("The Garden");

      const entityId2 = world.getEntityByKey("player.maren")!;
      expect(entityId2).toBe(entityId);

      await client2.close();
    });

    it("preserves position across sessions", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");

      const entityId = world.getEntityByKey("player.maren")!;
      const garden = world.getEntityByKey("room.garden")!;
      world.setComponent(entityId, "Position", { roomId: garden });

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const pos = world.getComponent(entityId, "Position") as {
        roomId: string;
      };
      expect(pos.roomId).toBe(garden);

      const client2 = await connectClient(port);
      const response = stripAnsi(await loginReturning(client2, "Maren"));
      expect(response).toContain("The Garden");

      await client2.close();
    });

    it("preserves original name casing", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");
      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      // Reconnect with different casing — account lookup is case-insensitive
      const client2 = await connectClient(port);
      const response = stripAnsi(await loginReturning(client2, "maren"));
      expect(response).toContain("Welcome back, Maren.");

      await client2.close();
    });
  });

  describe("case insensitivity", () => {
    it("Maren and maren map to the same entity", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");

      const entityId = world.getEntityByKey("player.maren")!;
      expect(entityId).toBeDefined();

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      await loginReturning(client2, "maren");

      const entityId2 = world.getEntityByKey("player.maren")!;
      expect(entityId2).toBe(entityId);

      await client2.close();
    });
  });

  describe("duplicate session rejection", () => {
    it("rejects connection when character is already being played", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Aldric");

      const client2 = await connectClient(port);
      await client2.waitForMessage(); // prompt
      client2.send("Aldric");
      const response = stripAnsi(await client2.waitForMessage());
      expect(response).toContain("already awake somewhere else");

      await client1.close();
      await client2.close();
    });

    it("allows reconnection after first session disconnects", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Aldric");

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      const response = stripAnsi(await loginReturning(client2, "Aldric"));
      expect(response).toContain("Welcome back, Aldric.");

      await client2.close();
    });
  });

  describe("password auth", () => {
    it("rejects wrong password and allows retry", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");
      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      await client2.waitForMessage(); // prompt
      client2.send("Maren");
      await client2.waitForMessage(); // "The name is known. Speak the word:"
      client2.send("wrongpassword");
      const response = stripAnsi(await client2.waitForMessage());
      expect(response).toContain("don't match");

      await client2.close();
    });

    it("closes connection after too many wrong attempts", async () => {
      const client1 = await connectClient(port);
      await loginNew(client1, "Maren");
      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("Maren");
      await client2.waitForMessage(); // password prompt

      // Three wrong attempts
      client2.send("wrong");
      await client2.waitForMessage();
      client2.send("wrong");
      await client2.waitForMessage();
      client2.send("wrong");
      const finalMsg = stripAnsi(await client2.waitForMessage());
      expect(finalMsg).toContain("fog does not part");

      await client2.close();
    });

    it("rejects mismatched password confirmation and re-prompts", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("NewPerson");
      await client.waitForMessage(); // new account prompt
      client.send("firstword");
      await client.waitForMessage(); // confirm prompt
      client.send("differentword");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("did not match");

      await client.close();
    });
  });

  describe("disconnect behavior", () => {
    it("entity stays in world after disconnect", async () => {
      const client = await connectClient(port);
      await loginNew(client, "Aldric");

      const entityId = world.getEntityByKey("player.aldric")!;
      expect(world.entities.hasEntity(entityId)).toBe(true);

      await client.close();
      await new Promise((r) => setTimeout(r, 50));

      expect(world.entities.hasEntity(entityId)).toBe(true);
      expect(world.getEntityByKey("player.aldric")).toBe(entityId);
    });

    it("player components persist after disconnect", async () => {
      const client = await connectClient(port);
      await loginNew(client, "Aldric");

      const entityId = world.getEntityByKey("player.aldric")!;
      await client.close();
      await new Promise((r) => setTimeout(r, 50));

      const player = world.getComponent(entityId, "Player") as {
        name: string;
        sessionId: string;
      };
      expect(player.name).toBe("Aldric");
      expect(player.sessionId).toBe(""); // cleared on disconnect

      const position = world.getComponent(entityId, "Position");
      expect(position).toBeDefined();

      const visited = world.getComponent(entityId, "VisitedRooms");
      expect(visited).toBeDefined();
    });

    it("disconnected player does not appear in room listings", async () => {
      const startingRoom = world.getEntityByKey("starting.room")!;
      const offlinePlayer = world.createEntity("player.ghost");
      world.addComponent(offlinePlayer, "Player", {
        name: "Ghost",
        sessionId: "",
      });
      world.addComponent(offlinePlayer, "Position", { roomId: startingRoom });
      world.addComponent(offlinePlayer, "VisitedRooms", {
        rooms: [startingRoom],
      });

      const client = await connectClient(port);
      const response = stripAnsi(await loginNew(client, "Aldric"));
      expect(response).not.toContain("Ghost");

      await client.close();
    });
  });
});
