import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";
import {
  getTimeBracket,
  setDebugTime,
  getCurrentTime,
  type TimeBracket,
} from "../src/game/solar.js";
import { createTimeOfDaySystem } from "../src/game/systems/TimeOfDaySystem.js";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";

afterEach(() => {
  setDebugTime(null);
});

describe("getTimeBracket", () => {
  // Summer solstice reference times for Bend, OR (44.06, -121.31):
  //   astro dawn (nightEnd):  09:57 UTC = 2:57 AM PDT
  //   nautical dawn:          10:59 UTC = 3:59 AM PDT
  //   sunrise:                12:23 UTC = 5:23 AM PDT
  //   solar noon:             20:08 UTC = 1:08 PM PDT
  //   sunset:                 03:53 UTC+1 = 8:53 PM PDT
  //   nautical dusk:          05:17 UTC+1 = 10:17 PM PDT
  //   astro dusk (night):     06:18 UTC+1 = 11:18 PM PDT

  it("returns morning for a summer morning", () => {
    // June 21 at 8:00 AM PDT = 15:00 UTC — between sunrise and midday start
    const date = new Date("2025-06-21T15:00:00Z");
    expect(getTimeBracket(date)).toBe("morning");
  });

  it("returns night for a winter late evening", () => {
    // Dec 21 at 11:00 PM PST = Dec 22 07:00 UTC
    // After astro dusk (02:16 UTC Dec 22), before midnight (08:00 UTC Dec 22)
    const date = new Date("2025-12-22T07:00:00Z");
    expect(getTimeBracket(date)).toBe("night");
  });

  it("returns dawn one minute before sunrise", () => {
    // Summer sunrise is ~12:23 UTC. One minute before = 12:22 UTC.
    // This is between nautical dawn (10:59) and sunrise (12:23) → dawn.
    const date = new Date("2025-06-21T12:22:00Z");
    expect(getTimeBracket(date)).toBe("dawn");
  });

  it("returns morning one minute after sunrise", () => {
    // One minute after sunrise = 12:24 UTC → morning
    const date = new Date("2025-06-21T12:24:00Z");
    expect(getTimeBracket(date)).toBe("morning");
  });

  it("returns dusk at sunset", () => {
    // Summer sunset is ~03:53 UTC June 22 (8:53 PM PDT June 21)
    const date = new Date("2025-06-22T03:54:00Z");
    expect(getTimeBracket(date)).toBe("dusk");
  });

  it("returns deep_night at midnight", () => {
    // June 21 midnight PDT = June 21 07:00 UTC
    const date = new Date("2025-06-21T07:00:00Z");
    expect(getTimeBracket(date)).toBe("deep_night");
  });

  it("returns midday around solar noon", () => {
    // Summer solar noon is ~20:08 UTC = 1:08 PM PDT
    const date = new Date("2025-06-21T20:08:00Z");
    expect(getTimeBracket(date)).toBe("midday");
  });

  it("returns afternoon after midday ends", () => {
    // Midday ends at solarNoon + 1hr = ~21:08 UTC
    const date = new Date("2025-06-21T21:30:00Z");
    expect(getTimeBracket(date)).toBe("afternoon");
  });

  it("returns evening between nautical dusk and astronomical dusk", () => {
    // Summer nautical dusk ~05:17 UTC June 22, astro dusk ~06:18 UTC June 22
    const date = new Date("2025-06-22T05:30:00Z");
    expect(getTimeBracket(date)).toBe("evening");
  });

  it("returns night between astronomical dawn and nautical dawn", () => {
    // Summer: astro dawn ~09:57 UTC, nautical dawn ~10:59 UTC
    const date = new Date("2025-06-21T10:30:00Z");
    expect(getTimeBracket(date)).toBe("night");
  });

  it("handles winter solstice brackets correctly", () => {
    // Winter Dec 21: sunrise at 15:38 UTC (7:38 AM PST)
    // 9 AM PST = 17:00 UTC → between sunrise (15:38) and midday start (~19:04)
    const date = new Date("2025-12-21T17:00:00Z");
    expect(getTimeBracket(date)).toBe("morning");
  });

  it("returns deep_night for 2 AM in winter", () => {
    // Dec 21 at 2:00 AM PST = 10:00 UTC
    // Before astro dawn (13:53 UTC) → deep_night
    const date = new Date("2025-12-21T10:00:00Z");
    expect(getTimeBracket(date)).toBe("deep_night");
  });
});

describe("debug time override", () => {
  it("getCurrentTime returns override when set", () => {
    const override = new Date("2025-06-21T15:00:00Z");
    setDebugTime(override);
    expect(getCurrentTime().getTime()).toBe(override.getTime());
  });

  it("getCurrentTime returns real time when override is null", () => {
    setDebugTime(null);
    const before = Date.now();
    const current = getCurrentTime().getTime();
    const after = Date.now();
    expect(current).toBeGreaterThanOrEqual(before);
    expect(current).toBeLessThanOrEqual(after);
  });

  it("getTimeBracket uses debug override when no date argument given", () => {
    // Set override to 8 AM PDT summer → should be morning
    setDebugTime(new Date("2025-06-21T15:00:00Z"));
    expect(getTimeBracket()).toBe("morning");

    // Change to midnight → should be deep_night
    setDebugTime(new Date("2025-06-21T07:00:00Z"));
    expect(getTimeBracket()).toBe("deep_night");
  });

  it("explicit date argument overrides debug time", () => {
    // Set debug to morning
    setDebugTime(new Date("2025-06-21T15:00:00Z"));
    // But pass midnight explicitly → should be deep_night
    expect(getTimeBracket(new Date("2025-06-21T07:00:00Z"))).toBe(
      "deep_night"
    );
  });
});

describe("TimeOfDaySystem", () => {
  const TICK = 250;

  function makeWorld(): World {
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

    return world;
  }

  beforeEach(() => {
    setDebugTime(new Date("2025-06-21T15:00:00Z")); // summer morning
  });

  it("updates TimeOfDay component on first tick", () => {
    const world = makeWorld();
    world.tick();

    const timeId = world.getEntityByKey("world.time")!;
    const tod = world.getComponent(timeId, "TimeOfDay") as {
      bracket: string;
      updatedAt: string;
    };

    expect(tod.bracket).toBe("morning");
    expect(tod.updatedAt).toBeTruthy();
  });

  it("does not update every tick (throttled to ~1 minute)", () => {
    const world = makeWorld();
    world.tick(); // first tick triggers update

    const timeId = world.getEntityByKey("world.time")!;
    const tod1 = world.getComponent(timeId, "TimeOfDay") as {
      bracket: string;
      updatedAt: string;
    };
    const firstUpdate = tod1.updatedAt;

    // Change debug time — if the system updates, the bracket would change
    setDebugTime(new Date("2025-06-21T07:00:00Z")); // midnight = deep_night

    // Tick a few more times (not enough to reach 60s)
    for (let i = 0; i < 10; i++) {
      world.tick();
    }

    const tod2 = world.getComponent(timeId, "TimeOfDay") as {
      bracket: string;
      updatedAt: string;
    };
    // Should still be morning because the throttle hasn't elapsed
    expect(tod2.bracket).toBe("morning");
  });

  it("updates after enough ticks to reach the interval", () => {
    const world = makeWorld();
    world.tick(); // first update → morning

    // Change debug time to midnight
    setDebugTime(new Date("2025-06-21T07:00:00Z"));

    // 60_000ms / 250ms = 240 ticks needed
    for (let i = 0; i < 240; i++) {
      world.tick();
    }

    const timeId = world.getEntityByKey("world.time")!;
    const tod = world.getComponent(timeId, "TimeOfDay") as {
      bracket: string;
      updatedAt: string;
    };
    expect(tod.bracket).toBe("deep_night");
  });

  it("does nothing if world.time entity is missing", () => {
    const world = new World({ tickInterval: TICK });
    registerComponents(world);
    world.addSystem(createTimeOfDaySystem(TICK));
    // No world.time entity created — should not throw
    expect(() => world.tick()).not.toThrow();
  });
});
