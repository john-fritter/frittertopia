import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod/v4";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { createWeatherSystem } from "../src/game/systems/WeatherSystem.js";

// Use a tick size that triggers the weather update on the first tick
// (WeatherSystem fires when elapsed >= UPDATE_INTERVAL_MS = 60_000)
const TICK_MS = 60_000;

function makeWeatherWorld(): World {
  const world = new World({ tickInterval: TICK_MS });
  registerComponents(world);
  world.registerEvent(
    "weather_state_change",
    z.object({ zoneId: z.string(), from: z.string(), to: z.string() })
  );
  world.addSystem(createWeatherSystem(TICK_MS));
  return world;
}

const BASE_ZONE_PARAMS = {
  climate: "alpine",
  tempCurve: {
    winterMin: -12,
    winterMax: 4,
    summerMin: 8,
    summerMax: 22,
    diurnalRange: 12,
  },
  pressureDrift: { speed: "slow" as const, volatility: "high" as const },
  precipitationBias: "high" as const,
};

describe("WeatherSystem weather_state_change event", () => {
  let world: World;

  beforeEach(() => {
    world = makeWeatherWorld();
  });

  it("emits when precipState transitions to a different state", () => {
    const zoneId = world.createEntity("test.zone");
    world.addComponent(zoneId, "WeatherZone", BASE_ZONE_PARAMS);
    // Storm has no self-transition in BASE_TRANSITIONS, so any outcome is a different state
    world.addComponent(zoneId, "WeatherState", {
      tempC: 20,
      pressureMb: 1013,
      precipState: "storm",
      precipStateElapsedMs: 999_999,
      precipStateDurationMs: 1,
      tempNoise: 0,
      pressureNoise: 0,
      pressureHistory: [],
      snowDepth: 0,
    });

    const received: Array<{ zoneId: string; from: string; to: string }> = [];
    world.onEvent("weather_state_change", (p) => {
      received.push(p as { zoneId: string; from: string; to: string });
    });

    world.tick();

    expect(received).toHaveLength(1);
    expect(received[0]!.from).toBe("storm");
    expect(received[0]!.to).not.toBe("storm");
    expect(received[0]!.zoneId).toBe(zoneId);
  });

  it("does not emit when duration has not expired (no transition)", () => {
    const zoneId = world.createEntity("test.zone");
    world.addComponent(zoneId, "WeatherZone", BASE_ZONE_PARAMS);
    world.addComponent(zoneId, "WeatherState", {
      tempC: 15,
      pressureMb: 1020,
      precipState: "clear",
      precipStateElapsedMs: 0,
      precipStateDurationMs: 999_999_999,
      tempNoise: 0,
      pressureNoise: 0,
      pressureHistory: [],
      snowDepth: 0,
    });

    const received: unknown[] = [];
    world.onEvent("weather_state_change", (p) => received.push(p));

    world.tick();

    expect(received).toHaveLength(0);
  });

  it("does not emit on initialization tick (no prior WeatherState)", () => {
    const zoneId = world.createEntity("test.zone");
    world.addComponent(zoneId, "WeatherZone", BASE_ZONE_PARAMS);
    // No WeatherState — first tick initializes it and continues without emitting

    const received: unknown[] = [];
    world.onEvent("weather_state_change", (p) => received.push(p));

    world.tick();

    expect(received).toHaveLength(0);
  });

  it("includes the zone entity id in the payload", () => {
    const zoneId = world.createEntity("test.zone.named");
    world.addComponent(zoneId, "WeatherZone", BASE_ZONE_PARAMS);
    world.addComponent(zoneId, "WeatherState", {
      tempC: 20,
      pressureMb: 1013,
      precipState: "storm",
      precipStateElapsedMs: 999_999,
      precipStateDurationMs: 1,
      tempNoise: 0,
      pressureNoise: 0,
      pressureHistory: [],
      snowDepth: 0,
    });

    const received: Array<{ zoneId: string; from: string; to: string }> = [];
    world.onEvent("weather_state_change", (p) => {
      received.push(p as { zoneId: string; from: string; to: string });
    });

    world.tick();

    expect(received[0]!.zoneId).toBe(zoneId);
  });
});

describe("WeatherChangeNotifications YAML loading", () => {
  it("loads transition map from content string", async () => {
    const { loadContentFromString } = await import(
      "../src/engine/ContentLoader.js"
    );

    const w = new World();
    registerComponents(w);

    const yaml = `
entities:
  - key: test.weather.zone
    components:
      WeatherZone:
        climate: alpine
        tempCurve:
          winterMin: -12
          winterMax: 4
          summerMin: 8
          summerMax: 22
          diurnalRange: 12
        pressureDrift:
          speed: slow
          volatility: high
        precipitationBias: high
      WeatherChangeNotifications:
        transitions:
          clear_rain: "Rain begins to fall."
          storm: "A storm breaks."
`;

    loadContentFromString(yaml, w, "test.yaml");

    const zoneId = w.getEntityByKey("test.weather.zone");
    expect(zoneId).toBeDefined();

    const notif = w.getComponent(zoneId!, "WeatherChangeNotifications") as
      | { transitions: Record<string, string> }
      | undefined;
    expect(notif).toBeDefined();
    expect(notif!.transitions["clear_rain"]).toBe("Rain begins to fall.");
    expect(notif!.transitions["storm"]).toBe("A storm breaks.");
  });
});
