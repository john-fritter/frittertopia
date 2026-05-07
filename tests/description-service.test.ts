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
import { buildDescriptionPrompt, PromptBuilder } from "../src/engine/description/PromptBuilder.js";
import { DescriptionService } from "../src/engine/description/index.js";
import * as path from "node:path";

const PROMPTS_DIR = path.join(import.meta.dirname, "..", "content", "prompts");

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
// ContextBuilder — unchanged; pure ECS query assembly
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

    const ctx = new ContextBuilder(world).buildContext(roomId, id);
    expect(ctx.isFirstVisit).toBe(true);
  });

  it("falls back to 'day' / 'new' when world.time entity is absent", () => {
    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);
    expect(ctx.timeOfDay).toBe("day");
    expect(ctx.moonPhase).toBe("new");
    expect(typeof ctx.moonAboveHorizon).toBe("boolean");
    expect(ctx.weather).toBe("clear");
  });

  it("includes zoneName and zoneBrief from WeatherZone when room has a WeatherZoneRef", () => {
    const world2 = makeWorld();
    const zoneId = world2.createEntity("test.zone");
    world2.addComponent(zoneId, "WeatherZone", {
      name: "Test Alpine",
      brief: "Cold and wet.",
      climate: "alpine",
      tempCurve: { winterMin: -10, winterMax: 2, summerMin: 5, summerMax: 18, diurnalRange: 10 },
      pressureDrift: { speed: "slow", volatility: "high" },
      precipitationBias: "high",
    });
    world2.addComponent(zoneId, "WeatherState", {
      tempC: 5,
      pressureMb: 1010,
      precipState: "clear",
      precipStateElapsedMs: 0,
      precipStateDurationMs: 0,
      tempNoise: 0,
      pressureNoise: 0,
      pressureHistory: [],
      snowDepth: 0,
    });
    const r2 = addRoom(world2, "zone.room", "The Courtyard", "a courtyard");
    world2.addComponent(r2, "WeatherZoneRef", { zoneId });
    const p2 = addPlayer(world2, r2, "Hiker", []);

    const ctx = new ContextBuilder(world2).buildContext(r2, p2);
    expect(ctx.zoneName).toBe("Test Alpine");
    expect(ctx.zoneBrief).toBe("Cold and wet.");
  });

  it("omits zoneName and zoneBrief for rooms without a WeatherZoneRef", () => {
    const ctx = new ContextBuilder(world).buildContext(roomId, playerId);
    expect(ctx.zoneName).toBeUndefined();
    expect(ctx.zoneBrief).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PromptBuilder — buildDescriptionPrompt (prompt-kind architecture)
// ---------------------------------------------------------------------------

describe("buildDescriptionPrompt", () => {
  const baseContext = {
    roomName: "The Courtyard",
    roomBrief: "A wide open courtyard surrounded by stone walls.",
    roomShort: "a wide courtyard",
    entitiesPresent: [] as Array<{ name: string; description: string }>,
    otherPlayers: [] as string[],
    isFirstVisit: false,
    timeOfDay: "day",
    moonPhase: "full",
    moonAboveHorizon: true,
    weather: "clear",
    exits: { east: "The Corridor", south: "The Kitchen" },
  };

  it("returns a {system, user} object — prompt-kind scaffold shape", () => {
    const result = buildDescriptionPrompt(baseContext, "look");
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("system prompt is self-contained — two calls with different rawInput produce the same system prompt", () => {
    const r1 = buildDescriptionPrompt(baseContext, "look");
    const r2 = buildDescriptionPrompt(baseContext, "smell candle");
    expect(r1.system).toBe(r2.system);
  });

  describe("system prompt", () => {
    it("instructs second-person present-tense writing", () => {
      const { system } = buildDescriptionPrompt(baseContext, "look");
      expect(system).toMatch(/second person/i);
      expect(system).toMatch(/present.tense/i);
    });

    it("contains length guidance", () => {
      const { system } = buildDescriptionPrompt(baseContext, "look");
      expect(system).toMatch(/as long as needed|one or two lines/i);
    });
  });

  describe("user prompt — field presence", () => {
    it("includes the room name", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("[ROOM: The Courtyard]");
    });

    it("includes the room brief", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("A wide open courtyard surrounded by stone walls.");
    });

    it("includes time and moon", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("time=day");
      expect(user).toContain("moon=full (above horizon)");
    });

    it("includes weather", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("weather=clear");
    });

    it("includes exits when present", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("EXITS:");
      expect(user).toContain("east → The Corridor");
      expect(user).toContain("south → The Kitchen");
    });

    it("omits exits line when exits is empty", () => {
      const { user } = buildDescriptionPrompt({ ...baseContext, exits: {} }, "look");
      expect(user).not.toContain("EXITS:");
    });

    it("omits exits line when exits is undefined", () => {
      const { user } = buildDescriptionPrompt({ ...baseContext, exits: undefined }, "look");
      expect(user).not.toContain("EXITS:");
    });

    it("lists present entities", () => {
      const ctx = {
        ...baseContext,
        entitiesPresent: [{ name: "a broom", description: "A broom leans against the wall." }],
      };
      const { user } = buildDescriptionPrompt(ctx, "look");
      expect(user).toContain("a broom");
      expect(user).toContain("A broom leans against the wall.");
    });

    it("lists other players", () => {
      const ctx = { ...baseContext, otherPlayers: ["Alice"] };
      const { user } = buildDescriptionPrompt(ctx, "look");
      expect(user).toContain("Alice (player)");
    });

    it("shows 'empty' when nothing is present", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).toContain("PRESENT: empty");
    });
  });

  describe("user prompt — raw input contract", () => {
    it("includes [INPUT] block with the raw input", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look at the altar");
      expect(user).toContain("[INPUT] { look at the altar }");
    });

    it("includes raw sensory input verbatim", () => {
      const { user } = buildDescriptionPrompt(baseContext, "smell candle");
      expect(user).toContain("[INPUT] { smell candle }");
    });

    it("does NOT contain a Target: field", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look at the altar");
      expect(user).not.toContain("Target:");
    });

    it("does NOT contain a Command: field", () => {
      const { user } = buildDescriptionPrompt(baseContext, "smell candle");
      expect(user).not.toContain("Command:");
    });

    it("does NOT contain a Visit: field", () => {
      const { user } = buildDescriptionPrompt(baseContext, "look");
      expect(user).not.toContain("Visit:");
    });

    it("[INPUT] block appears after [ROOM] block", () => {
      const { user } = buildDescriptionPrompt(baseContext, "listen");
      const roomIdx = user.indexOf("[ROOM:");
      const inputIdx = user.indexOf("[INPUT]");
      expect(roomIdx).toBeGreaterThan(-1);
      expect(inputIdx).toBeGreaterThan(roomIdx);
    });
  });
});

// ---------------------------------------------------------------------------
// DescriptionService — describe()
// ---------------------------------------------------------------------------

describe("DescriptionService", () => {
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

    const result = await world.description.describe(roomId, playerId, "look");

    expect(result).toBe("Candlelight flickers across old stone.");
  });

  it("returns fallback text on LLM failure", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({
      ok: false,
      error: "API error 500",
    });

    const result = await world.description.describe(roomId, playerId, "look");

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

    const result = await noKeyWorld.description.describe(r, p, "look");

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

    const result = await world.description.describe(roomId, playerId, "look");

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

    await expect(
      world.description.describe(roomId, playerId, "look")
    ).resolves.toEqual(expect.any(String));
  });

  it("always calls the LLM — no caching", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Fresh prose." });

    await world.description.describe(roomId, playerId, "look");
    await world.description.describe(roomId, playerId, "look");

    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("passes raw input to the user prompt", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "You hear silence." });

    await world.description.describe(roomId, playerId, "listen to the bell");

    const userPrompt = generateMock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).toContain("[INPUT] { listen to the bell }");
  });

  it("user prompt does not contain Target: or Command:", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Cold stone." });

    await world.description.describe(roomId, playerId, "touch the altar");

    const userPrompt = generateMock.mock.calls[0]?.[1] ?? "";
    expect(userPrompt).not.toContain("Target:");
    expect(userPrompt).not.toContain("Command:");
  });

  it("different raw inputs produce different LLM calls", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Something." });

    await world.description.describe(roomId, playerId, "look");
    await world.description.describe(roomId, playerId, "smell candle");

    const prompt1 = generateMock.mock.calls[0]?.[1] ?? "";
    const prompt2 = generateMock.mock.calls[1]?.[1] ?? "";
    expect(prompt1).toContain("[INPUT] { look }");
    expect(prompt2).toContain("[INPUT] { smell candle }");
  });
});

// ---------------------------------------------------------------------------
// buildSenseUserPrompt — format contract
// ---------------------------------------------------------------------------

describe("PromptBuilder — buildSenseUserPrompt", () => {
  let builder: PromptBuilder;
  let baseCtx: Parameters<PromptBuilder["buildSenseUserPrompt"]>[0];

  beforeEach(() => {
    builder = new PromptBuilder();
    builder.loadPromptFiles(PROMPTS_DIR);

    baseCtx = {
      roomName: "The Courtyard",
      roomBrief: "A wide open courtyard surrounded by stone walls.",
      roomShort: "a wide courtyard",
      entitiesPresent: [],
      otherPlayers: [],
      isFirstVisit: false,
      timeOfDay: "day",
      moonPhase: "full",
      moonAboveHorizon: true,
      weather: "clear",
      exits: {},
      characterBriefs: [{ name: "Aria", brief: "Tall woman with auburn hair." }],
      currentPlayerName: "Aria",
    };
  });

  it("includes [CURRENT PLAYER] with the player's name", () => {
    const user = builder.buildSenseUserPrompt(baseCtx, "look hands");
    expect(user).toContain("[CURRENT PLAYER: Aria]");
  });

  it("includes the player's brief text inside [CURRENT PLAYER]", () => {
    const user = builder.buildSenseUserPrompt(baseCtx, "look hands");
    expect(user).toContain("Tall woman with auburn hair.");
  });

  it("includes [CHARACTERS] and [PLAYER] blocks for other players", () => {
    const ctx = {
      ...baseCtx,
      otherPlayers: ["Pell"],
      characterBriefs: [
        { name: "Aria", brief: "Tall woman with auburn hair." },
        { name: "Pell", brief: "Short man with grey eyes." },
      ],
    };
    const user = builder.buildSenseUserPrompt(ctx, "look");
    expect(user).toContain("[CHARACTERS]");
    expect(user).toContain("[PLAYER: Pell]");
    expect(user).toContain("Short man with grey eyes.");
    // Not a flat list (no "- Pell: ..." format)
    expect(user).not.toMatch(/- Pell:/);
  });

  it("omits [CHARACTERS] section when no other players have briefs", () => {
    const user = builder.buildSenseUserPrompt(baseCtx, "look");
    expect(user).not.toContain("[CHARACTERS]");
    // [PLAYER: Name] block header should be absent
    expect(user).not.toMatch(/\[PLAYER: /);
  });

  it("includes [TARGET] section when a target brief is supplied", () => {
    const target = { name: "Pell", brief: "Short man with grey eyes." };
    const user = builder.buildSenseUserPrompt(baseCtx, "look at Pell", target);
    expect(user).toContain("[TARGET: Pell]");
    expect(user).toContain("Short man with grey eyes.");
  });

  it("omits [TARGET] section when no target brief is supplied", () => {
    const user = builder.buildSenseUserPrompt(baseCtx, "look at the well");
    expect(user).not.toContain("[TARGET:");
    expect(user).not.toContain("TARGET BRIEF:");
  });

  it("includes room context fields", () => {
    const user = builder.buildSenseUserPrompt(baseCtx, "look");
    expect(user).toContain("[ROOM: The Courtyard]");
    expect(user).toContain("A wide open courtyard");
    expect(user).toContain("time=day");
    expect(user).toContain("[INPUT] { look }");
  });

  it("includes exits when present", () => {
    const ctx = { ...baseCtx, exits: { north: "The Hall" } };
    const user = builder.buildSenseUserPrompt(ctx, "look");
    expect(user).toContain("EXITS:");
    expect(user).toContain("north → The Hall");
  });

  it("falls back to (no brief on file) when current player has no brief", () => {
    const ctx = { ...baseCtx, characterBriefs: [] };
    const user = builder.buildSenseUserPrompt(ctx, "look hands");
    expect(user).toContain("[CURRENT PLAYER: Aria]");
    expect(user).toContain("(no brief on file)");
  });
});

// ---------------------------------------------------------------------------
// DescriptionService — describe() vs describeSense() routing
// ---------------------------------------------------------------------------

describe("DescriptionService — role routing", () => {
  let world: World;
  let roomId: string;
  let playerId: string;

  beforeEach(() => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    world = makeWorld();
    roomId = addRoom(world, "route.room", "The Hall", "a hall", "A long stone hall.");
    playerId = addPlayer(world, roomId, "Tester", [roomId]);
    world.addComponent(playerId, "CharacterBrief", { brief: "A sturdy figure." });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["OPENROUTER_API_KEY"];
  });

  it("describe() uses the describe-room system prompt", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "Stone." });
    await world.description.describe(roomId, playerId, "look");
    const system = world.description.lastPrompt?.system ?? "";
    expect(system).toContain("editorialize"); // unique to describe-room.md
    expect(system).not.toContain("self-directed"); // unique to describe.md
  });

  it("describeSense() uses the describe system prompt", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "Your hands." });
    await world.description.describeSense(roomId, playerId, "look hands");
    const system = world.description.lastPrompt?.system ?? "";
    expect(system).toContain("self-directed"); // unique to describe.md
    expect(system).not.toContain("editorialize"); // unique to describe-room.md
  });

  it("describeSense() sets lastPrompt context as sense:", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "Silence." });
    await world.description.describeSense(roomId, playerId, "listen");
    expect(world.description.lastPrompt?.context).toMatch(/^sense:/);
  });

  it("describe() sets lastPrompt context as room:", async () => {
    vi.spyOn(world.llm, "generate").mockResolvedValue({ ok: true, text: "Stone." });
    await world.description.describe(roomId, playerId, "look");
    expect(world.description.lastPrompt?.context).toMatch(/^room:/);
  });

  it("describeSense() resolves named target to their brief", async () => {
    const otherId = addPlayer(world, roomId, "Mira", []);
    world.addComponent(otherId, "CharacterBrief", { brief: "Slight woman, dark eyes." });
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "She meets your gaze." });

    await world.description.describeSense(roomId, playerId, "look at Mira", "Mira");
    const user = generateMock.mock.calls[0]?.[1] ?? "";
    expect(user).toContain("[TARGET: Mira]");
    expect(user).toContain("Slight woman, dark eyes.");
  });

  it("describeSense() omits [TARGET] section for targets without a brief", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Just a wall." });

    await world.description.describeSense(roomId, playerId, "look at the wall", "the wall");
    const user = generateMock.mock.calls[0]?.[1] ?? "";
    expect(user).not.toContain("[TARGET:");
  });

  it("describeSense() user prompt includes [CURRENT PLAYER] section", async () => {
    const generateMock = vi
      .spyOn(world.llm, "generate")
      .mockResolvedValue({ ok: true, text: "Your hands." });

    await world.description.describeSense(roomId, playerId, "look hands");
    const user = generateMock.mock.calls[0]?.[1] ?? "";
    expect(user).toContain("[CURRENT PLAYER: Tester]");
  });
});
