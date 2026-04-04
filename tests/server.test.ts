import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
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

  return world;
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

describe("GameServer", () => {
  let world: World;
  let server: GameServer;
  let port: number;

  beforeEach(() => {
    world = setupWorld();
    server = new GameServer(world);
    server.start(0); // random port
    port = server.getPort()!;
  });

  afterEach(() => {
    server.stop();
  });

  describe("name validation", () => {
    it("rejects names shorter than 2 characters", async () => {
      const client = await connectClient(port);
      await client.waitForMessage(); // "What is your name?"
      client.send("A");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("2\u201320 characters");
      expect(response).toContain("What is your name?");
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

    it("accepts valid names", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Maren");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("Welcome, Maren.");
      await client.close();
    });
  });

  describe("new player creation", () => {
    it("creates entity with key player.<lowercased-name>", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Aldric");
      await client.waitForMessage();

      const entityId = world.getEntityByKey("player.aldric");
      expect(entityId).toBeDefined();
      await client.close();
    });

    it("gives new player correct starting components", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Aldric");
      await client.waitForMessage();

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
      await client.waitForMessage();
      client.send("Aldric");
      const response = stripAnsi(await client.waitForMessage());
      expect(response).toContain("Welcome, Aldric.");
      expect(response).toContain("The Courtyard");
      expect(response).toContain("a courtyard");
      await client.close();
    });
  });

  describe("returning player", () => {
    it("reattaches to existing entity without creating a new one", async () => {
      // First session
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Maren");
      await client1.waitForMessage();

      const entityId = world.getEntityByKey("player.maren")!;
      expect(entityId).toBeDefined();

      // Move player to the garden
      const garden = world.getEntityByKey("room.garden")!;
      world.setComponent(entityId, "Position", { roomId: garden });

      // Disconnect
      await client1.close();

      // Allow disconnect handler to run
      await new Promise((r) => setTimeout(r, 50));

      // Second session — same name
      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("Maren");
      const response = stripAnsi(await client2.waitForMessage());

      // Should welcome back, not create new
      expect(response).toContain("Welcome back, Maren.");
      expect(response).toContain("The Garden");

      // Same entity ID
      const entityId2 = world.getEntityByKey("player.maren")!;
      expect(entityId2).toBe(entityId);

      await client2.close();
    });

    it("preserves position across sessions", async () => {
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Maren");
      await client1.waitForMessage();

      const entityId = world.getEntityByKey("player.maren")!;
      const garden = world.getEntityByKey("room.garden")!;
      world.setComponent(entityId, "Position", { roomId: garden });

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      // Verify position is still in the garden
      const pos = world.getComponent(entityId, "Position") as {
        roomId: string;
      };
      expect(pos.roomId).toBe(garden);

      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("Maren");
      const response = stripAnsi(await client2.waitForMessage());
      expect(response).toContain("The Garden");

      await client2.close();
    });

    it("preserves original name casing", async () => {
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Maren");
      await client1.waitForMessage();
      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      // Reconnect with different casing
      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("maren");
      const response = stripAnsi(await client2.waitForMessage());

      // Should show original casing
      expect(response).toContain("Welcome back, Maren.");

      await client2.close();
    });
  });

  describe("case insensitivity", () => {
    it("Maren and maren map to the same entity", async () => {
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Maren");
      await client1.waitForMessage();

      const entityId = world.getEntityByKey("player.maren")!;
      expect(entityId).toBeDefined();

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("maren");
      await client2.waitForMessage();

      const entityId2 = world.getEntityByKey("player.maren")!;
      expect(entityId2).toBe(entityId);

      await client2.close();
    });
  });

  describe("duplicate session rejection", () => {
    it("rejects connection when character is already being played", async () => {
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Aldric");
      await client1.waitForMessage();

      // Second client tries same name while first is still connected
      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("Aldric");
      const response = stripAnsi(await client2.waitForMessage());
      expect(response).toContain("already being played");

      await client1.close();
      await client2.close();
    });

    it("allows reconnection after first session disconnects", async () => {
      const client1 = await connectClient(port);
      await client1.waitForMessage();
      client1.send("Aldric");
      await client1.waitForMessage();

      await client1.close();
      await new Promise((r) => setTimeout(r, 50));

      // Now the name should be available again
      const client2 = await connectClient(port);
      await client2.waitForMessage();
      client2.send("Aldric");
      const response = stripAnsi(await client2.waitForMessage());
      expect(response).toContain("Welcome back, Aldric.");

      await client2.close();
    });
  });

  describe("disconnect behavior", () => {
    it("entity stays in world after disconnect", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Aldric");
      await client.waitForMessage();

      const entityId = world.getEntityByKey("player.aldric")!;
      expect(world.entities.hasEntity(entityId)).toBe(true);

      await client.close();
      await new Promise((r) => setTimeout(r, 50));

      // Entity should still exist
      expect(world.entities.hasEntity(entityId)).toBe(true);
      expect(world.getEntityByKey("player.aldric")).toBe(entityId);
    });

    it("player components persist after disconnect", async () => {
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Aldric");
      await client.waitForMessage();

      const entityId = world.getEntityByKey("player.aldric")!;
      await client.close();
      await new Promise((r) => setTimeout(r, 50));

      // All components should still be present
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
      // Create an offline player entity in the starting room
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

      // Connect a new player and check room listing
      const client = await connectClient(port);
      await client.waitForMessage();
      client.send("Aldric");
      const response = stripAnsi(await client.waitForMessage());

      // Ghost should NOT appear in the room
      expect(response).not.toContain("Ghost");

      await client.close();
    });
  });
});
