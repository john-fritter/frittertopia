import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { ContextBuilder } from "../src/engine/description/ContextBuilder.js";
import { PromptBuilder } from "../src/engine/description/PromptBuilder.js";
import { DescriptionCache } from "../src/engine/description/DescriptionCache.js";
import { DescriptionService } from "../src/engine/description/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorld(): World {
  const world = new World();
  registerComponents(world);
  return world;
}

function addRoom(
  world: World,
  key: string,
  name: string,
  short: string,
  brief?: string,
  exits?: Record<string, string>
): string {
  const id = world.createEntity(key);
  world.addComponent(id, "Room", { name });
  world.addComponent(id, "Description", { short });
  if (brief) world.addComponent(id, "RoomBrief", { brief });
  if (exits) world.addComponent(id, "Exits", { exits });
  return id;
}

function addPlayer(
  world: World,
  roomId: string,
  name: string,
  visitedRooms: string[] = []
): string {
  const id = world.createEntity();
  world.addComponent(id, "Player", { name, sessionId: "s-" + name });
  world.addComponent(id, "Position", { roomId });
  world.addComponent(id, "VisitedRooms", { rooms: visitedRooms });
  return id;
}

function addItem(
  world: World,
  roomId: string,
  short: string,
  presenceDesc: string
): string {
  const id = world.createEntity();
  world.addComponent(id, "Position", { roomId });
  world.addComponent(id, "Description", { short });
  world.addComponent(id, "Presence", { description: presenceDesc });
  return id;
}

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

describe("ContextBuilder", () => {
  let world: World;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    world = makeWorld();
    roomId = addRoom(world, "test.room", "The Stone Hall", "a stone hall", "A wide hall of grey stone.");
    playerId = addPlayer(world, roomId, "Tester", [roomId]);
  });

  it("builds context with correct room name and descriptions", () => {
    const builder = new ContextBuilder(world);
    const ctx = builder.buildContext(roomId, playerId);

    expect(ctx.roomName).toBe("The Stone Hall");
    expect(ctx.roomBrief).toBe("A wide hall of grey stone.");
    expect(ctx.roomShort).toBe("a stone hall");
  });

  it("uses short description as brief when RoomBrief is absent", () => {
    const world2 = makeWorld();
    const room2 = addRoom(world2, "bare.room", "The Bare Room", "a bare room");
    const player2 = addPlayer(world2, room2, "Solo", [room2]);

    const ctx = new ContextBuilder(world2).buildContext(room2, player2);

    expect(ctx.roomBrief).toBe("a bare room");
    expect(ctx.roomShort).toBe("a bare room");
  });

  it("resolves exit directions to room names", () => {
    const world2 = makeWorld();
    const hallId = world2.createEntity("hall.room");
    world2.addComponent(hallId, "Room", { name: "The Hall" });
    world2.addComponent(hallId, "Description", { short: "a hall" });

    const gardenId = world2.createEntity("garden.room");
    world2.addComponent(gardenId, "Room", { name: "The Garden" });
    world2.addComponent(gardenId, "Description", { short: "a garden" });

    world2.addComponent(hallId, "Exits", { exits: { north: gardenId } });
    const player2 = addPlayer(world2, hallId, "Walker", []);

    const ctx = new ContextBuilder(world2).buildContext(hallId, player2);

    expect(ctx.exits).toBeDefined();
    expect(ctx.exits!["north"]).toBe("The Garden");
  });

  it("exits is empty when room has no Exits component", () => {
    const world2 = makeWorld();
    const room2 = addRoom(world2, "dead.end", "Dead End", "a dead end");
    const player2 = addPlayer(world2, room2, "Solo", []);

    const ctx = new ContextBuilder(world2).buildContext(room2, player2);

    expect(ctx.exits).toEqual({});
  });

  it("identifies entities present via Presence component", () => {
    addItem(world, roomId, "a wooden chair", "A wooden chair sits in the corner.");
    addItem(world, roomId, "a lit candle", "A candle flickers on the shelf.");

    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);

    expect(ctx.entitiesPresent).toHaveLength(2);
    expect(ctx.entitiesPresent[0]).toEqual({
      name: "a wooden chair",
      description: "A wooden chair sits in the corner.",
    });
    expect(ctx.entitiesPresent[1]).toEqual({
      name: "a lit candle",
      description: "A candle flickers on the shelf.",
    });
  });

  it("excludes the requesting player from entitiesPresent", () => {
    // Give the player a Presence component — should still be excluded
    world.addComponent(playerId, "Presence", { description: "You are here." });

    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);

    expect(ctx.entitiesPresent).toHaveLength(0);
  });

  it("excludes entities in other rooms", () => {
    const otherRoom = addRoom(world, "other.room", "Other Room", "another room");
    addItem(world, otherRoom, "remote item", "It is far away.");

    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);

    expect(ctx.entitiesPresent).toHaveLength(0);
  });

  it("identifies other players in the room", () => {
    addPlayer(world, roomId, "Alice", []);
    addPlayer(world, roomId, "Bob", []);

    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);

    expect(ctx.otherPlayers).toContain("Alice");
    expect(ctx.otherPlayers).toContain("Bob");
    expect(ctx.otherPlayers).not.toContain("Tester");
  });

  it("does not include players in other rooms", () => {
    const otherRoom = addRoom(world, "other.room2", "Other Room", "another room");
    addPlayer(world, otherRoom, "Ghost", []);

    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);

    expect(ctx.otherPlayers).toHaveLength(0);
  });

  it("detects a return visit when room is in VisitedRooms", () => {
    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);
    expect(ctx.isFirstVisit).toBe(false);
  });

  it("detects a first visit when room is not in VisitedRooms", () => {
    const player2 = addPlayer(world, roomId, "Newcomer", []);
    const ctx = new ContextBuilder(world).buildContext(roomId, player2);
    expect(ctx.isFirstVisit).toBe(true);
  });

  it("detects a first visit when VisitedRooms component is absent", () => {
    const id = world.createEntity();
    world.addComponent(id, "Player", { name: "Blank", sessionId: "blank" });
    world.addComponent(id, "Position", { roomId });
    // No VisitedRooms component

    const ctx = new ContextBuilder(world).buildContext(roomId, id);
    expect(ctx.isFirstVisit).toBe(true);
  });

  it("stubs timeOfDay and weather with placeholder values", () => {
    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);
    expect(ctx.timeOfDay).toBe("day");
    expect(ctx.weather).toBe("clear");
  });
});

// ---------------------------------------------------------------------------
// PromptBuilder
// ---------------------------------------------------------------------------

describe("PromptBuilder", () => {
  const builder = new PromptBuilder();

  const baseContext = {
    roomName: "The Courtyard",
    roomBrief: "A wide open courtyard surrounded by stone walls.",
    roomShort: "a wide courtyard",
    entitiesPresent: [],
    otherPlayers: [],
    isFirstVisit: false,
    timeOfDay: "day",
    weather: "clear",
    exits: { east: "The Corridor", south: "The Kitchen" },
  };

  describe("buildSystemPrompt", () => {
    it("instructs second-person present-tense writing", () => {
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toMatch(/second-person/i);
      expect(prompt).toMatch(/present.tense/i);
    });

    it("prohibits inventing objects or interactive elements", () => {
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toMatch(/never invent/i);
    });

    it("specifies sentence length", () => {
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toMatch(/sentences/i);
    });
  });

  describe("buildUserPrompt", () => {
    it("includes the room name", () => {
      const prompt = builder.buildUserPrompt(baseContext);
      expect(prompt).toContain("Room: The Courtyard");
    });

    it("includes the room brief", () => {
      const prompt = builder.buildUserPrompt(baseContext);
      expect(prompt).toContain("Brief: A wide open courtyard surrounded by stone walls.");
    });

    it("marks a returning visit", () => {
      const prompt = builder.buildUserPrompt({ ...baseContext, isFirstVisit: false });
      expect(prompt).toContain("Visit: returning");
    });

    it("marks a first visit", () => {
      const prompt = builder.buildUserPrompt({ ...baseContext, isFirstVisit: true });
      expect(prompt).toContain("Visit: first visit");
    });

    it("lists present entities", () => {
      const ctx = {
        ...baseContext,
        entitiesPresent: [
          { name: "a broom", description: "A broom leans against the wall." },
        ],
      };
      const prompt = builder.buildUserPrompt(ctx);
      expect(prompt).toContain("a broom");
      expect(prompt).toContain("A broom leans against the wall.");
    });

    it("lists other players", () => {
      const ctx = { ...baseContext, otherPlayers: ["Alice"] };
      const prompt = builder.buildUserPrompt(ctx);
      expect(prompt).toContain("Alice (player)");
    });

    it("shows 'empty' when nothing is present", () => {
      const prompt = builder.buildUserPrompt(baseContext);
      expect(prompt).toContain("Present: empty");
    });

    it("includes time and weather", () => {
      const prompt = builder.buildUserPrompt(baseContext);
      expect(prompt).toContain("Time: day");
      expect(prompt).toContain("Weather: clear");
    });

    it("includes exits when present", () => {
      const prompt = builder.buildUserPrompt(baseContext);
      expect(prompt).toContain("Exits:");
      expect(prompt).toContain("east → The Corridor");
      expect(prompt).toContain("south → The Kitchen");
    });

    it("omits exits line when exits is undefined", () => {
      const ctx = { ...baseContext, exits: undefined };
      const prompt = builder.buildUserPrompt(ctx);
      expect(prompt).not.toContain("Exits:");
    });
  });
});

// ---------------------------------------------------------------------------
// DescriptionCache
// ---------------------------------------------------------------------------

describe("DescriptionCache", () => {
  const TTL_MS = 5 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null on a cache miss", () => {
    const cache = new DescriptionCache();
    expect(cache.get("player1", "room1")).toBeNull();
  });

  it("returns the cached text on a hit", () => {
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "The hall is cold.");
    expect(cache.get("player1", "room1")).toBe("The hall is cold.");
  });

  it("returns null after TTL expires", () => {
    vi.useFakeTimers();
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "Stone walls.");
    vi.advanceTimersByTime(TTL_MS + 1);
    expect(cache.get("player1", "room1")).toBeNull();
  });

  it("returns text when TTL has not expired", () => {
    vi.useFakeTimers();
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "Stone walls.");
    vi.advanceTimersByTime(TTL_MS - 1);
    expect(cache.get("player1", "room1")).toBe("Stone walls.");
  });

  it("invalidate clears all entries for a given room", () => {
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "Text A.");
    cache.set("player2", "room1", "Text B.");
    cache.set("player1", "room2", "Text C.");

    cache.invalidate("room1");

    expect(cache.get("player1", "room1")).toBeNull();
    expect(cache.get("player2", "room1")).toBeNull();
    expect(cache.get("player1", "room2")).toBe("Text C."); // untouched
  });

  it("invalidatePlayer clears all entries for a given player", () => {
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "Text A.");
    cache.set("player1", "room2", "Text B.");
    cache.set("player2", "room1", "Text C.");

    cache.invalidatePlayer("player1");

    expect(cache.get("player1", "room1")).toBeNull();
    expect(cache.get("player1", "room2")).toBeNull();
    expect(cache.get("player2", "room1")).toBe("Text C."); // untouched
  });

  it("separate players get separate cache entries for the same room", () => {
    const cache = new DescriptionCache();
    cache.set("player1", "room1", "Alice sees it.");
    cache.set("player2", "room1", "Bob sees it.");
    expect(cache.get("player1", "room1")).toBe("Alice sees it.");
    expect(cache.get("player2", "room1")).toBe("Bob sees it.");
  });
});

// ---------------------------------------------------------------------------
// DescriptionService
// ---------------------------------------------------------------------------

describe("DescriptionService", () => {
  const TTL_MS = 5 * 60 * 1000;

  let world: World;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    world = makeWorld();
    roomId = addRoom(world, "svc.room", "The Chapel", "a chapel", "A small stone chapel.");
    playerId = addPlayer(world, roomId, "Pilgrim", [roomId]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env["OPENROUTER_API_KEY"];
  });

  it("returns AI-generated text on success", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({
      ok: true,
      text: "Candlelight flickers across old stone.",
    });

    const result = await world.description.describeRoom(roomId, playerId);

    expect(result).toBe("Candlelight flickers across old stone.");
  });

  it("returns cached text without calling the LLM on a cache hit", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Generated once." });

    await world.description.describeRoom(roomId, playerId);
    const second = await world.description.describeRoom(roomId, playerId);

    expect(second).toBe("Generated once.");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("calls the LLM again after the cache expires", async () => {
    vi.useFakeTimers();
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Fresh description." });

    await world.description.describeRoom(roomId, playerId);
    vi.advanceTimersByTime(TTL_MS + 1);
    await world.description.describeRoom(roomId, playerId);

    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("returns fallback text on LLM failure", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({
      ok: false,
      error: "API error 500",
    });

    const result = await world.description.describeRoom(roomId, playerId);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns fallback immediately when no API key is configured", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const noKeyWorld = makeWorld();
    const r = addRoom(noKeyWorld, "fog.room", "The Fog", "thick fog");
    const p = addPlayer(noKeyWorld, r, "Lost", []);

    const generateMock = vi.spyOn(noKeyWorld.llm, "generate");

    const result = await noKeyWorld.description.describeRoom(r, p);

    // generate is still called — it returns { ok: false } because of missing key
    // (the LLMClient handles that internally; DescriptionService handles the ok:false path)
    const callResult = await generateMock.mock.results[0]?.value;
    expect(callResult?.ok).toBe(false);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("fallback text does not contain error messages or system language", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({
      ok: false,
      error: "API error 429: rate limited",
    });

    const result = await world.description.describeRoom(roomId, playerId);

    const lower = result.toLowerCase();
    expect(lower).not.toContain("error");
    expect(lower).not.toContain("api");
    expect(lower).not.toContain("openrouter");
    expect(lower).not.toContain("failed");
    expect(lower).not.toContain("rate limit");
    expect(lower).not.toContain("429");
  });

  it("never throws — always returns a string", async () => {
    vi.spyOn(world.llm, "generate").mockRejectedValue(new Error("unexpected"));

    // Even if LLMClient.generate somehow throws, describeRoom should not
    // (In practice LLMClient never throws, but belt-and-suspenders test)
    await expect(
      world.description.describeRoom(roomId, playerId)
    ).resolves.toEqual(expect.any(String));
  });
});
