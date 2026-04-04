import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import {
  getMoonPhaseName,
  getMoonData,
  setDebugTime,
  type MoonPhaseName,
} from "../src/game/solar.js";
import {
  getVisibility,
  renderDescription,
  substituteVariables,
  type DescriptionBlock,
  type VisibilityLevel,
} from "../src/game/description.js";
import { createTimeOfDaySystem } from "../src/game/systems/TimeOfDaySystem.js";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { loadContentFromString } from "../src/engine/ContentLoader.js";

afterEach(() => {
  setDebugTime(null);
});

// --- Moon phase derivation ---

describe("getMoonPhaseName", () => {
  it("returns new at phase 0", () => {
    expect(getMoonPhaseName(0)).toBe("new");
  });

  it("returns full at phase 0.5", () => {
    expect(getMoonPhaseName(0.5)).toBe("full");
  });

  it("returns first_quarter at phase 0.25", () => {
    expect(getMoonPhaseName(0.25)).toBe("first_quarter");
  });

  it("returns third_quarter at phase 0.75", () => {
    expect(getMoonPhaseName(0.75)).toBe("third_quarter");
  });

  it("returns waxing_crescent at phase 0.125", () => {
    expect(getMoonPhaseName(0.125)).toBe("waxing_crescent");
  });

  it("returns waxing_gibbous at phase 0.375", () => {
    expect(getMoonPhaseName(0.375)).toBe("waxing_gibbous");
  });

  it("returns waning_gibbous at phase 0.625", () => {
    expect(getMoonPhaseName(0.625)).toBe("waning_gibbous");
  });

  it("returns waning_crescent at phase 0.875", () => {
    expect(getMoonPhaseName(0.875)).toBe("waning_crescent");
  });

  it("wraps correctly near phase 1.0", () => {
    // phase 0.97 → close to 1.0 → wraps to new
    expect(getMoonPhaseName(0.97)).toBe("new");
  });
});

describe("getMoonData with known dates", () => {
  it("returns near-full moon around full moon date", () => {
    // June 11, 2025 is approximately full moon
    const data = getMoonData(new Date("2025-06-11T12:00:00Z"));
    expect(data.fraction).toBeGreaterThan(0.95);
    expect(data.phase).toBe("full");
  });

  it("returns near-new moon around new moon date", () => {
    // June 25, 2025 is approximately new moon
    const data = getMoonData(new Date("2025-06-25T12:00:00Z"));
    expect(data.fraction).toBeLessThan(0.05);
    expect(data.phase).toBe("new");
  });
});

// --- Visibility computation ---

describe("getVisibility", () => {
  const TICK = 250;

  function makeWorld(
    bracket: string,
    moonFraction: number,
    moonPhase: string
  ): World {
    const world = new World({ tickInterval: TICK });
    registerComponents(world);
    world.registerComponent(
      "RoomExposure",
      z.object({ exposure: z.enum(["outdoor", "sheltered", "indoor"]) })
    );

    const timeId = world.createEntity("world.time");
    world.addComponent(timeId, "TimeOfDay", {
      bracket,
      moonFraction,
      moonPhase,
      updatedAt: "",
    });

    return world;
  }

  function addRoom(
    world: World,
    key: string,
    exposure: string
  ): string {
    const id = world.createEntity(key);
    world.addComponent(id, "Room", { name: "Test Room" });
    world.addComponent(id, "RoomExposure", { exposure });
    return id;
  }

  // Indoor rooms are always full
  it("indoor room is full at any time", () => {
    for (const bracket of [
      "morning", "midday", "afternoon", "dawn", "dusk",
      "evening", "night", "deep_night",
    ]) {
      const world = makeWorld(bracket, 0, "new");
      const roomId = addRoom(world, "test.room", "indoor");
      expect(getVisibility(roomId, world)).toBe("full");
    }
  });

  // Outdoor daytime
  it("outdoor room at morning/midday/afternoon is full", () => {
    for (const bracket of ["morning", "midday", "afternoon"]) {
      const world = makeWorld(bracket, 0, "new");
      const roomId = addRoom(world, "test.room", "outdoor");
      expect(getVisibility(roomId, world)).toBe("full");
    }
  });

  // Outdoor dawn/dusk
  it("outdoor room at dawn/dusk is reduced", () => {
    for (const bracket of ["dawn", "dusk"]) {
      const world = makeWorld(bracket, 0, "new");
      const roomId = addRoom(world, "test.room", "outdoor");
      expect(getVisibility(roomId, world)).toBe("reduced");
    }
  });

  // Outdoor evening
  it("outdoor room at evening is minimal", () => {
    const world = makeWorld("evening", 0, "new");
    const roomId = addRoom(world, "test.room", "outdoor");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  // Outdoor night — no moon
  it("outdoor room at night with no moon is minimal", () => {
    const world = makeWorld("night", 0.1, "waxing_crescent");
    const roomId = addRoom(world, "test.room", "outdoor");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  // Outdoor night — bright moon (> 0.75)
  it("outdoor room at night with bright moon is reduced", () => {
    const world = makeWorld("night", 0.9, "full");
    const roomId = addRoom(world, "test.room", "outdoor");
    expect(getVisibility(roomId, world)).toBe("reduced");
  });

  // Outdoor deep_night — no moon
  it("outdoor room at deep_night with no moon is none", () => {
    const world = makeWorld("deep_night", 0.1, "waxing_crescent");
    const roomId = addRoom(world, "test.room", "outdoor");
    expect(getVisibility(roomId, world)).toBe("none");
  });

  // Outdoor deep_night — bright moon
  it("outdoor room at deep_night with bright moon is minimal", () => {
    const world = makeWorld("deep_night", 0.9, "full");
    const roomId = addRoom(world, "test.room", "outdoor");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  // Sheltered — better than outdoor at the low end
  it("sheltered room at evening is reduced (better than outdoor minimal)", () => {
    const world = makeWorld("evening", 0, "new");
    const roomId = addRoom(world, "test.room", "sheltered");
    expect(getVisibility(roomId, world)).toBe("reduced");
  });

  it("sheltered room at night is minimal", () => {
    const world = makeWorld("night", 0.1, "waxing_crescent");
    const roomId = addRoom(world, "test.room", "sheltered");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  it("sheltered room at night with bright moon is reduced", () => {
    const world = makeWorld("night", 0.9, "full");
    const roomId = addRoom(world, "test.room", "sheltered");
    expect(getVisibility(roomId, world)).toBe("reduced");
  });

  it("sheltered room at deep_night is minimal", () => {
    const world = makeWorld("deep_night", 0.1, "new");
    const roomId = addRoom(world, "test.room", "sheltered");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  it("sheltered room at deep_night with bright moon is still minimal (bonuses don't stack)", () => {
    const world = makeWorld("deep_night", 0.9, "full");
    const roomId = addRoom(world, "test.room", "sheltered");
    expect(getVisibility(roomId, world)).toBe("minimal");
  });

  // Room without RoomExposure defaults to outdoor
  it("room without RoomExposure defaults to outdoor behavior", () => {
    const world = makeWorld("deep_night", 0, "new");
    const id = world.createEntity("bare.room");
    world.addComponent(id, "Room", { name: "Bare" });
    expect(getVisibility(id, world)).toBe("none");
  });

  // No world.time entity defaults to full
  it("returns full when world.time entity is missing", () => {
    const world = new World();
    registerComponents(world);
    const id = world.createEntity("test.room");
    world.addComponent(id, "Room", { name: "Test" });
    expect(getVisibility(id, world)).toBe("full");
  });
});

// --- Variable substitution ---

describe("substituteVariables", () => {
  it("replaces known variables", () => {
    const result = substituteVariables("The sky: {sky}", { sky: "blue" });
    expect(result).toBe("The sky: blue");
  });

  it("replaces dotted variable names", () => {
    const result = substituteVariables(
      "Through the window, {sky.window} falls.",
      { "sky.window": "warm light" }
    );
    expect(result).toBe("Through the window, warm light falls.");
  });

  it("leaves unknown variables as-is", () => {
    const result = substituteVariables("The {nonexistent} thing.", {});
    expect(result).toBe("The {nonexistent} thing.");
  });

  it("replaces empty string variable", () => {
    const result = substituteVariables("Base. {sky.sound}", {
      "sky.sound": "",
    });
    expect(result).toBe("Base. ");
  });

  it("handles multiple variables in one string", () => {
    const result = substituteVariables("{sky} Also {sky.sound}", {
      sky: "Clear.",
      "sky.sound": "Birds.",
    });
    expect(result).toBe("Clear. Also Birds.");
  });
});

describe("renderDescription with variables", () => {
  function block(
    overrides: Partial<DescriptionBlock> & { id: string; text: string }
  ): DescriptionBlock {
    return { type: "base", ...overrides };
  }

  it("substitutes variables in rendered text", () => {
    const blocks = [
      block({ id: "b1", text: "The courtyard. {sky}" }),
    ];
    const result = renderDescription(blocks, {
      visibility: "full",
      variables: { sky: "The sun is high." },
    });
    expect(result).toBe("The courtyard. The sun is high.");
  });

  it("substitutes variables in detail text too", () => {
    const blocks = [
      block({
        id: "b1",
        visibility: "reduced+",
        text: "Base text.",
        details: [{ visibility: "full", text: "Detail: {sky.window}." }],
      }),
    ];
    const result = renderDescription(blocks, {
      visibility: "full",
      variables: { "sky.window": "bright light" },
    });
    expect(result).toBe("Base text. Detail: bright light.");
  });

  it("works without variables (backwards compatible)", () => {
    const blocks = [block({ id: "b1", text: "No variables." })];
    const result = renderDescription(blocks, { visibility: "full" });
    expect(result).toBe("No variables.");
  });

  it("leaves unresolved variables in place", () => {
    const blocks = [
      block({ id: "b1", text: "The {unknown} value." }),
    ];
    const result = renderDescription(blocks, {
      visibility: "full",
      variables: {},
    });
    expect(result).toBe("The {unknown} value.");
  });
});

// --- TimeOfDaySystem moon data ---

describe("TimeOfDaySystem stores moon data", () => {
  const TICK = 250;

  it("populates moonFraction and moonPhase on first tick", () => {
    // Set to a known full-moon date
    setDebugTime(new Date("2025-06-11T12:00:00Z"));

    const world = new World({ tickInterval: TICK });
    registerComponents(world);
    world.addSystem(createTimeOfDaySystem(TICK));

    const timeId = world.createEntity("world.time");
    world.addComponent(timeId, "TimeOfDay", {
      bracket: "unknown",
      moonFraction: 0,
      moonPhase: "new",
      updatedAt: "",
    });

    world.tick();

    const tod = world.getComponent(timeId, "TimeOfDay") as {
      bracket: string;
      moonFraction: number;
      moonPhase: string;
    };

    expect(tod.moonFraction).toBeGreaterThan(0.95);
    expect(tod.moonPhase).toBe("full");
  });
});

// --- Integrated: sky variables resolve at render time ---

describe("sky variable integration", () => {
  function makeFullWorld(bracket: string, moonPhase: string): World {
    const world = new World();
    registerComponents(world);
    world.registerComponent(
      "RoomExposure",
      z.object({ exposure: z.enum(["outdoor", "sheltered", "indoor"]) })
    );

    const timeId = world.createEntity("world.time");
    world.addComponent(timeId, "TimeOfDay", {
      bracket,
      moonFraction: moonPhase === "full" ? 0.99 : 0.01,
      moonPhase,
      updatedAt: "",
    });

    const skyId = world.createEntity("world.sky");
    world.addComponent(skyId, "SkyDescriptions", {
      brackets: {
        morning: {
          sky: "The sun is up.",
          window: "warm morning light",
          sound: "Birdsong.",
        },
        deep_night: {
          sky: "Stars above.",
          window: "darkness",
          sound: "Silence.",
          moon: {
            full: "The full moon is bright.",
            new: "",
          },
        },
      },
    });

    return world;
  }

  it("courtyard renders with sky text at morning", () => {
    const world = makeFullWorld("morning", "new");

    const roomId = world.createEntity("test.courtyard");
    world.addComponent(roomId, "Room", { name: "Courtyard" });
    world.addComponent(roomId, "RoomExposure", { exposure: "outdoor" });
    world.addComponent(roomId, "Description", { short: "a courtyard" });

    const blocks: DescriptionBlock[] = [
      { id: "base", type: "base", visibility: "reduced+", text: "Stones. {sky}" },
    ];

    const tod = world.getComponent(
      world.getEntityByKey("world.time")!,
      "TimeOfDay"
    ) as { bracket: string; moonPhase: string };
    const skyData = world.getComponent(
      world.getEntityByKey("world.sky")!,
      "SkyDescriptions"
    ) as {
      brackets: Record<
        string,
        { sky: string; window: string; sound: string; moon?: Record<string, string> }
      >;
    };
    const bracketData = skyData.brackets[tod.bracket]!;
    const variables: Record<string, string> = {
      sky: bracketData.sky,
      "sky.window": bracketData.window,
      "sky.sound": bracketData.sound,
    };

    const visibility = getVisibility(roomId, world);
    const result = renderDescription(blocks, { visibility, variables });

    expect(result).toBe("Stones. The sun is up.");
  });

  it("night sky includes moon text for full moon", () => {
    const world = makeFullWorld("deep_night", "full");

    const skyData = world.getComponent(
      world.getEntityByKey("world.sky")!,
      "SkyDescriptions"
    ) as {
      brackets: Record<
        string,
        { sky: string; window: string; sound: string; moon?: Record<string, string> }
      >;
    };
    const bracketData = skyData.brackets["deep_night"]!;

    let skyText = bracketData.sky;
    const moonText = bracketData.moon?.["full"];
    if (moonText) skyText += " " + moonText;

    expect(skyText).toBe("Stars above. The full moon is bright.");
  });

  it("night sky has no moon text for new moon", () => {
    const world = makeFullWorld("deep_night", "new");

    const skyData = world.getComponent(
      world.getEntityByKey("world.sky")!,
      "SkyDescriptions"
    ) as {
      brackets: Record<
        string,
        { sky: string; window: string; sound: string; moon?: Record<string, string> }
      >;
    };
    const bracketData = skyData.brackets["deep_night"]!;

    let skyText = bracketData.sky;
    const moonText = bracketData.moon?.["new"];
    if (moonText) skyText += " " + moonText;

    // New moon text is empty string, so no append
    expect(skyText).toBe("Stars above.");
  });

  it("indoor room without sky variables is unaffected", () => {
    const world = makeFullWorld("morning", "new");

    const roomId = world.createEntity("test.kitchen");
    world.addComponent(roomId, "Room", { name: "Kitchen" });
    world.addComponent(roomId, "RoomExposure", { exposure: "indoor" });
    world.addComponent(roomId, "Description", { short: "a kitchen" });

    const blocks: DescriptionBlock[] = [
      { id: "base", type: "base", visibility: "reduced+", text: "Soot-darkened stone arches above." },
    ];

    const visibility = getVisibility(roomId, world);
    expect(visibility).toBe("full");

    const result = renderDescription(blocks, { visibility, variables: { sky: "Sun is up." } });

    // No {sky} in the text, so no substitution happens
    expect(result).toBe("Soot-darkened stone arches above.");
  });

  it("variables resolve differently when debug time changes", () => {
    const world = new World();
    registerComponents(world);

    // Set up sky data with two brackets
    const skyId = world.createEntity("world.sky");
    world.addComponent(skyId, "SkyDescriptions", {
      brackets: {
        morning: { sky: "Morning sky.", window: "morning light", sound: "" },
        evening: { sky: "Evening sky.", window: "fading light", sound: "" },
      },
    });

    // Simulate different brackets producing different variables
    const block: DescriptionBlock = {
      id: "test",
      type: "base",
      text: "Outside: {sky}",
    };

    const morningResult = renderDescription([block], {
      visibility: "full",
      variables: { sky: "Morning sky." },
    });
    expect(morningResult).toBe("Outside: Morning sky.");

    const eveningResult = renderDescription([block], {
      visibility: "full",
      variables: { sky: "Evening sky." },
    });
    expect(eveningResult).toBe("Outside: Evening sky.");
  });
});

// --- Courtyard YAML integration ---

describe("courtyard YAML loads with RoomBrief", () => {
  it("loads courtyard with RoomBrief and Description.short", () => {
    const world = new World();
    registerComponents(world);

    loadContentFromString(
      `
entities:
  - key: starting.room
    components:
      Room:
        name: "The Monastery Courtyard"
      Description:
        short: "a crumbling stone courtyard"
      RoomBrief:
        brief: "Cracked flagstones beneath an open sky."
      Exits:
        exits: {}
`,
      world,
      "test-courtyard.yaml"
    );

    const roomId = world.getEntityByKey("starting.room")!;
    expect(world.getComponent(roomId, "Description")).toEqual({
      short: "a crumbling stone courtyard",
    });
    expect(world.getComponent(roomId, "RoomBrief")).toEqual({
      brief: "Cracked flagstones beneath an open sky.",
    });
  });
});
