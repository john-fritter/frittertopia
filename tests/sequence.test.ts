import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import { WebSocket } from "ws";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { createSequenceSystem } from "../src/game/systems/SequenceSystem.js";
import { ActionResolver } from "../src/engine/ActionResolver.js";
import { loadContentFromString } from "../src/engine/ContentLoader.js";
import { GameServer } from "../src/server/Server.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const TICK = 250;

function makeSequenceWorld(): World {
  const world = new World({ tickInterval: TICK });
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

  world.addSystem(createSequenceSystem(TICK));
  return world;
}

describe("SequenceSystem", () => {
  let world: World;

  beforeEach(() => {
    world = makeSequenceWorld();
  });

  it("advances beats on correct timing", () => {
    const room = world.createEntity("test.room");
    world.addComponent(room, "Room", { name: "Test Room" });
    world.addComponent(room, "Description", {
      short: "a room",
      long: "A test room.",
    });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Sequence", {
      beats: [
        { text: "First", delay: 500 },
        { text: "Second", delay: 500 },
      ],
      currentBeat: 0,
      elapsed: 0,
      onComplete: { placeInRoom: "test.room" },
      deflectMessage: "Wait.",
    });

    const beats: Array<{ playerId: string; text: string }> = [];
    world.onEvent("sequence_beat", (payload) => {
      beats.push(payload as { playerId: string; text: string });
    });

    // Tick 1: elapsed 250, no beat yet
    world.tick();
    expect(beats).toHaveLength(0);

    // Tick 2: elapsed 500, first beat fires
    world.tick();
    expect(beats).toHaveLength(1);
    expect(beats[0]!.text).toBe("First");

    // Tick 3: elapsed 250, no beat
    world.tick();
    expect(beats).toHaveLength(1);

    // Tick 4: elapsed 500, second beat fires
    world.tick();
    expect(beats).toHaveLength(2);
    expect(beats[1]!.text).toBe("Second");
  });

  it("removes Sequence component after last beat", () => {
    const room = world.createEntity("test.room");
    world.addComponent(room, "Room", { name: "Test Room" });
    world.addComponent(room, "Description", {
      short: "a room",
      long: "A test room.",
    });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Sequence", {
      beats: [{ text: "Only beat", delay: 250 }],
      currentBeat: 0,
      elapsed: 0,
      onComplete: { placeInRoom: "test.room" },
      deflectMessage: "Wait.",
    });

    world.tick(); // fires beat, sequence completes

    expect(world.getComponent(playerId, "Sequence")).toBeUndefined();
  });

  it("places player in room on completion via onComplete.placeInRoom", () => {
    const room = world.createEntity("test.room");
    world.addComponent(room, "Room", { name: "Test Room" });
    world.addComponent(room, "Description", {
      short: "a room",
      long: "A test room.",
    });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Sequence", {
      beats: [{ text: "Done", delay: 250 }],
      currentBeat: 0,
      elapsed: 0,
      onComplete: { placeInRoom: "test.room" },
      deflectMessage: "Wait.",
    });

    const completions: Array<{ playerId: string; roomId: string }> = [];
    world.onEvent("sequence_complete", (payload) => {
      completions.push(payload as { playerId: string; roomId: string });
    });

    world.tick();

    // Player should now have Position
    const pos = world.getComponent(playerId, "Position") as { roomId: string };
    expect(pos.roomId).toBe(room);

    // VisitedRooms should be set
    const visited = world.getComponent(playerId, "VisitedRooms") as {
      rooms: string[];
    };
    expect(visited.rooms).toContain(room);

    // sequence_complete event should have fired
    expect(completions).toHaveLength(1);
    expect(completions[0]!.roomId).toBe(room);
  });

  it("first beat delay creates initial silence", () => {
    const room = world.createEntity("test.room");
    world.addComponent(room, "Room", { name: "Test Room" });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Sequence", {
      beats: [{ text: "Delayed", delay: 1000 }],
      currentBeat: 0,
      elapsed: 0,
      onComplete: {},
      deflectMessage: "Wait.",
    });

    const beats: string[] = [];
    world.onEvent("sequence_beat", (payload) => {
      beats.push((payload as { text: string }).text);
    });

    // 3 ticks = 750ms, should still be silent
    world.tick();
    world.tick();
    world.tick();
    expect(beats).toHaveLength(0);

    // 4th tick = 1000ms, beat fires
    world.tick();
    expect(beats).toHaveLength(1);
    expect(beats[0]).toBe("Delayed");
  });
});

describe("Input deflection during sequences", () => {
  it("player with Sequence gets deflect message instead of normal commands", () => {
    const world = new World();
    registerComponents(world);

    const room = world.createEntity("room.a");
    world.addComponent(room, "Room", { name: "A Room" });
    world.addComponent(room, "Description", {
      short: "a room",
      long: "A room.",
    });
    world.addComponent(room, "Exits", { exits: {} });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Position", { roomId: room });
    world.addComponent(playerId, "Sequence", {
      beats: [{ text: "fog", delay: 5000 }],
      currentBeat: 0,
      elapsed: 0,
      onComplete: {},
      deflectMessage: "The fog is too thick.",
    });

    const resolver = new ActionResolver(world);

    // Try look
    const lookResult = resolver.resolve({ verb: "look" }, playerId);
    expect(stripAnsi(lookResult.toPlayer)).toBe("The fog is too thick.");
    expect(lookResult.toRoom).toBeUndefined();

    // Try move
    const moveResult = resolver.resolve(
      { verb: "move", target: "north" },
      playerId
    );
    expect(stripAnsi(moveResult.toPlayer)).toBe("The fog is too thick.");

    // Try say
    const sayResult = resolver.resolve(
      { verb: "say", target: "hello" },
      playerId
    );
    expect(stripAnsi(sayResult.toPlayer)).toBe("The fog is too thick.");
  });

  it("deflection stops after sequence is removed", () => {
    const world = new World();
    registerComponents(world);

    const room = world.createEntity("room.a");
    world.addComponent(room, "Room", { name: "A Room" });
    world.addComponent(room, "Description", {
      short: "a room",
      long: "A room.",
    });
    world.addComponent(room, "Exits", { exits: {} });

    const playerId = world.createEntity();
    world.addComponent(playerId, "Player", {
      name: "Tester",
      sessionId: "s1",
    });
    world.addComponent(playerId, "Position", { roomId: room });
    world.addComponent(playerId, "VisitedRooms", { rooms: [room] });
    world.addComponent(playerId, "Sequence", {
      beats: [{ text: "fog", delay: 5000 }],
      currentBeat: 0,
      elapsed: 0,
      onComplete: {},
      deflectMessage: "The fog is too thick.",
    });

    const resolver = new ActionResolver(world);

    // Deflected while sequence is active
    let result = resolver.resolve({ verb: "look" }, playerId);
    expect(stripAnsi(result.toPlayer)).toBe("The fog is too thick.");

    // Remove sequence
    world.removeComponent(playerId, "Sequence");

    // Now look works normally
    result = resolver.resolve({ verb: "look" }, playerId);
    expect(stripAnsi(result.toPlayer)).toContain("A Room");
  });
});

describe("Fog arrival YAML loading", () => {
  it("loads sequence template with all fields from YAML", () => {
    const world = new World();
    registerComponents(world);

    // Need a starting room for the ref in onComplete.placeInRoom
    // (placeInRoom is a plain string key, not a resolved ref)
    const room = world.createEntity("starting.room");
    world.addComponent(room, "Room", { name: "The Courtyard" });

    const yaml = `
entities:
  - key: sequence.fog-arrival
    components:
      Sequence:
        beats:
          - delay: 1500
            text: "Grey fog."
          - delay: 3000
            text: "Ground beneath you."
        onComplete:
          placeInRoom: starting.room
        deflectMessage: "The fog is too thick."
        currentBeat: 0
        elapsed: 0
`;

    loadContentFromString(yaml, world, "test-sequence.yaml");

    const templateId = world.getEntityByKey("sequence.fog-arrival");
    expect(templateId).toBeDefined();

    const seq = world.getComponent(templateId!, "Sequence") as Record<
      string,
      unknown
    >;
    expect(seq).toBeDefined();

    const beats = seq.beats as Array<{ text: string; delay: number }>;
    expect(beats).toHaveLength(2);
    expect(beats[0]!.delay).toBe(1500);
    expect(beats[0]!.text).toBe("Grey fog.");
    expect(beats[1]!.delay).toBe(3000);

    const onComplete = seq.onComplete as { placeInRoom?: string };
    expect(onComplete.placeInRoom).toBe("starting.room");

    expect(seq.deflectMessage).toBe("The fog is too thick.");
    expect(seq.currentBeat).toBe(0);
    expect(seq.elapsed).toBe(0);
  });

  it("loads the actual fog-arrival.yaml content file", async () => {
    const world = new World();
    registerComponents(world);

    // Create the starting room so content can reference it
    world.createEntity("starting.room");

    const fs = await import("node:fs");
    const path = await import("node:path");
    const yamlPath = path.join(
      import.meta.dirname,
      "..",
      "content",
      "sequences",
      "fog-arrival.yaml"
    );
    const yamlText = fs.readFileSync(yamlPath, "utf-8");
    loadContentFromString(yamlText, world, yamlPath);

    const templateId = world.getEntityByKey("sequence.fog-arrival");
    expect(templateId).toBeDefined();

    const seq = world.getComponent(templateId!, "Sequence") as Record<
      string,
      unknown
    >;
    const beats = seq.beats as Array<{ text: string; delay: number }>;
    expect(beats.length).toBeGreaterThanOrEqual(4);
    expect((seq.onComplete as { placeInRoom: string }).placeInRoom).toBe(
      "starting.room"
    );
    expect(typeof seq.deflectMessage).toBe("string");
  });
});

// Integration tests using WebSocket connections
describe("GameServer sequence integration", () => {
  let world: World;
  let server: GameServer;
  let port: number;

  interface Client {
    ws: WebSocket;
    messages: string[];
    waitForMessage: (timeoutMs?: number) => Promise<string>;
    send: (msg: string) => void;
    close: () => Promise<void>;
  }

  function connectClient(p: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${p}`);
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
          waitForMessage: (timeoutMs = 5000) =>
            new Promise<string>((res, rej) => {
              if (messages.length > 0) {
                res(messages.shift()!);
                return;
              }
              const timer = setTimeout(
                () => rej(new Error("waitForMessage timed out")),
                timeoutMs
              );
              waiters.push((msg) => {
                clearTimeout(timer);
                res(msg);
              });
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

  function setupWorldWithSequenceTemplate(): World {
    const w = makeSequenceWorld();

    const roomA = w.createEntity("starting.room");
    w.addComponent(roomA, "Room", { name: "The Courtyard" });
    w.addComponent(roomA, "Description", { short: "a courtyard" });
    w.addComponent(roomA, "Exits", { exits: {} });

    // Create the sequence template entity
    w.createEntity("sequence.fog-arrival");
    w.addComponent(
      w.getEntityByKey("sequence.fog-arrival")!,
      "Sequence",
      {
        beats: [
          { text: "Grey fog.", delay: 250 },
          { text: "Ground beneath you.", delay: 250 },
        ],
        currentBeat: 0,
        elapsed: 0,
        onComplete: { placeInRoom: "starting.room" },
        deflectMessage: "The fog is too thick.",
      }
    );

    return w;
  }

  beforeEach(() => {
    world = setupWorldWithSequenceTemplate();
    server = new GameServer(world);
    server.start(0);
    port = server.getPort()!;
  });

  afterEach(() => {
    server.stop();
  });

  it("new player gets sequence instead of room description", async () => {
    const client = await connectClient(port);
    await client.waitForMessage(); // "What is your name?"
    client.send("Maren");

    // Should NOT get "Welcome, Maren" or room description immediately.
    // Instead, after tick interval, should get first fog beat.
    const firstBeat = stripAnsi(await client.waitForMessage());
    expect(firstBeat).toBe("Grey fog.");

    // Player should have Sequence component
    const playerId = world.getEntityByKey("player.maren")!;
    expect(playerId).toBeDefined();
    expect(world.getComponent(playerId, "Sequence")).toBeDefined();

    // Player should NOT have Position yet
    expect(world.getComponent(playerId, "Position")).toBeUndefined();

    await client.close();
  });

  it("new player receives all beats then room description", async () => {
    const client = await connectClient(port);
    await client.waitForMessage(); // name prompt
    client.send("Aldric");

    const beat1 = stripAnsi(await client.waitForMessage());
    expect(beat1).toBe("Grey fog.");

    const beat2 = stripAnsi(await client.waitForMessage());
    expect(beat2).toBe("Ground beneath you.");

    // After all beats, should receive the room description
    const roomDesc = stripAnsi(await client.waitForMessage());
    expect(roomDesc).toContain("The Courtyard");
    expect(roomDesc).toContain("a courtyard");

    // Sequence should be removed
    const playerId = world.getEntityByKey("player.aldric")!;
    expect(world.getComponent(playerId, "Sequence")).toBeUndefined();

    // Player should now have Position
    const pos = world.getComponent(playerId, "Position") as {
      roomId: string;
    };
    const startingRoom = world.getEntityByKey("starting.room")!;
    expect(pos.roomId).toBe(startingRoom);

    await client.close();
  });

  it("input during sequence returns deflect message", async () => {
    const client = await connectClient(port);
    await client.waitForMessage(); // name prompt
    client.send("Maren");

    // Get first beat
    await client.waitForMessage();

    // Try to do something during the sequence
    client.send("look");
    const deflect = stripAnsi(await client.waitForMessage());
    expect(deflect).toBe("The fog is too thick.");

    await client.close();
  });

  it("returning player skips sequence and sees room", async () => {
    // Create an existing player entity (simulating a previous session)
    const startingRoom = world.getEntityByKey("starting.room")!;
    const playerId = world.createEntity("player.maren");
    world.addComponent(playerId, "Player", {
      name: "Maren",
      sessionId: "",
    });
    world.addComponent(playerId, "Position", { roomId: startingRoom });
    world.addComponent(playerId, "VisitedRooms", { rooms: [startingRoom] });

    const client = await connectClient(port);
    await client.waitForMessage(); // name prompt
    client.send("Maren");

    const response = stripAnsi(await client.waitForMessage());
    expect(response).toContain("Welcome back, Maren.");
    expect(response).toContain("The Courtyard");

    // Should NOT have a Sequence component
    expect(world.getComponent(playerId, "Sequence")).toBeUndefined();

    await client.close();
  });

  it("player can interact normally after sequence completes", async () => {
    const client = await connectClient(port);
    await client.waitForMessage(); // name prompt
    client.send("Aldric");

    // Consume all beats and room description
    await client.waitForMessage(); // beat 1
    await client.waitForMessage(); // beat 2
    await client.waitForMessage(); // room desc

    // Now player should be able to use commands
    client.send("look");
    const lookResult = stripAnsi(await client.waitForMessage());
    expect(lookResult).toContain("The Courtyard");

    await client.close();
  });
});
