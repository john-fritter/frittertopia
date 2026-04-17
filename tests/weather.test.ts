import { describe, it, expect } from "vitest";
import {
  makeRng,
  computeTemperatureCelsius,
  updateNoiseTerms,
  computeTempBracket,
  celsiusToFahrenheit,
  computePressureTrend,
  trimPressureHistory,
  computePrecipWeights,
  selectPrecipType,
  nextWeatherState,
  initWeatherState,
  type WeatherZoneParams,
  type NoiseState,
  type PressurePoint,
} from "../src/game/weather.js";

const ALPINE_ZONE: WeatherZoneParams = {
  tempCurve: {
    winterMin: -12,
    winterMax: 4,
    summerMin: 8,
    summerMax: 22,
    diurnalRange: 12,
  },
  pressureDrift: { speed: "slow", volatility: "high" },
  precipitationBias: "high",
};

const ZERO_NOISE: NoiseState = { tempNoise: 0, pressureNoise: 0 };

// ── makeRng ──────────────────────────────────────────────────────────────────

describe("makeRng", () => {
  it("produces values in [0, 1)", () => {
    const rng = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("same seed → same sequence", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it("different seeds → different sequences", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const aVals = Array.from({ length: 10 }, () => a());
    const bVals = Array.from({ length: 10 }, () => b());
    expect(aVals).not.toEqual(bVals);
  });
});

// ── computeTemperatureCelsius ─────────────────────────────────────────────────

describe("computeTemperatureCelsius", () => {
  it("summer solstice midday is near summerMax", () => {
    // June 21, 3pm local — peak seasonal + peak diurnal
    const date = new Date("2025-06-21T15:00:00");
    const temp = computeTemperatureCelsius(date, ALPINE_ZONE, ZERO_NOISE);
    // Should be close to summerMax (22°C) — within diurnalRange/2 of it
    expect(temp).toBeGreaterThan(15);
    expect(temp).toBeLessThan(30); // some slack for day-of-year offset
  });

  it("winter solstice dawn is near winterMin", () => {
    // Dec 21, 5am local — trough seasonal + trough diurnal
    const date = new Date("2025-12-21T05:00:00");
    const temp = computeTemperatureCelsius(date, ALPINE_ZONE, ZERO_NOISE);
    // Should be near winterMin (-12°C)
    expect(temp).toBeLessThan(2);
    expect(temp).toBeGreaterThan(-20);
  });

  it("noise term shifts temperature", () => {
    const date = new Date("2025-06-21T12:00:00");
    const base = computeTemperatureCelsius(date, ALPINE_ZONE, ZERO_NOISE);
    const withNoise = computeTemperatureCelsius(date, ALPINE_ZONE, {
      tempNoise: 5,
      pressureNoise: 0,
    });
    expect(withNoise).toBeCloseTo(base + 5, 5);
  });

  it("summer midday is warmer than winter dawn", () => {
    const summer = computeTemperatureCelsius(
      new Date("2025-07-15T15:00:00"),
      ALPINE_ZONE,
      ZERO_NOISE
    );
    const winter = computeTemperatureCelsius(
      new Date("2025-01-15T05:00:00"),
      ALPINE_ZONE,
      ZERO_NOISE
    );
    expect(summer).toBeGreaterThan(winter);
  });
});

// ── updateNoiseTerms ──────────────────────────────────────────────────────────

describe("updateNoiseTerms", () => {
  it("keeps tempNoise within bounds for high volatility after 1000 ticks", () => {
    const rng = makeRng(99);
    let state: NoiseState = ZERO_NOISE;
    for (let i = 0; i < 1000; i++) {
      state = updateNoiseTerms(state, ALPINE_ZONE, rng);
    }
    expect(Math.abs(state.tempNoise)).toBeLessThanOrEqual(12 + 0.01);
  });

  it("keeps pressureNoise within bounds for high volatility after 1000 ticks", () => {
    const rng = makeRng(77);
    let state: NoiseState = ZERO_NOISE;
    for (let i = 0; i < 1000; i++) {
      state = updateNoiseTerms(state, ALPINE_ZONE, rng);
    }
    expect(Math.abs(state.pressureNoise)).toBeLessThanOrEqual(35 + 0.01);
  });

  it("low volatility stays within tighter bounds", () => {
    const lowVolZone: WeatherZoneParams = {
      ...ALPINE_ZONE,
      pressureDrift: { speed: "slow", volatility: "low" },
    };
    const rng = makeRng(55);
    let state: NoiseState = ZERO_NOISE;
    for (let i = 0; i < 1000; i++) {
      state = updateNoiseTerms(state, lowVolZone, rng);
    }
    expect(Math.abs(state.tempNoise)).toBeLessThanOrEqual(5 + 0.01);
    expect(Math.abs(state.pressureNoise)).toBeLessThanOrEqual(15 + 0.01);
  });
});

// ── computeTempBracket ────────────────────────────────────────────────────────

describe("computeTempBracket", () => {
  it("frigid below -10", () => expect(computeTempBracket(-15)).toBe("frigid"));
  it("frigid at -10.01", () => expect(computeTempBracket(-10.01)).toBe("frigid"));
  it("cold at -10", () => expect(computeTempBracket(-10)).toBe("cold"));
  it("cold at -0.01", () => expect(computeTempBracket(-0.01)).toBe("cold"));
  it("cool at 0", () => expect(computeTempBracket(0)).toBe("cool"));
  it("cool at 9.99", () => expect(computeTempBracket(9.99)).toBe("cool"));
  it("mild at 10", () => expect(computeTempBracket(10)).toBe("mild"));
  it("mild at 19.99", () => expect(computeTempBracket(19.99)).toBe("mild"));
  it("warm at 20", () => expect(computeTempBracket(20)).toBe("warm"));
  it("warm at 27.99", () => expect(computeTempBracket(27.99)).toBe("warm"));
  it("hot at 28", () => expect(computeTempBracket(28)).toBe("hot"));
  it("hot at 40", () => expect(computeTempBracket(40)).toBe("hot"));
});

// ── celsiusToFahrenheit ───────────────────────────────────────────────────────

describe("celsiusToFahrenheit", () => {
  it("0°C → 32°F", () => expect(celsiusToFahrenheit(0)).toBe(32));
  it("100°C → 212°F", () => expect(celsiusToFahrenheit(100)).toBe(212));
  it("-40°C → -40°F", () => expect(celsiusToFahrenheit(-40)).toBe(-40));
  it("20°C → 68°F", () => expect(celsiusToFahrenheit(20)).toBe(68));
});

// ── computePressureTrend ──────────────────────────────────────────────────────

describe("computePressureTrend", () => {
  const now = Date.now();
  const min = 60_000;

  function history(...entries: [number, number][]): PressurePoint[] {
    return entries.map(([minsAgo, value]) => ({
      time: now - minsAgo * min,
      value,
    }));
  }

  it("steady when < 2 entries", () => {
    expect(computePressureTrend([])).toBe("steady");
    expect(computePressureTrend([{ time: now, value: 1013 }])).toBe("steady");
  });

  it("rising fast when delta > +2", () => {
    expect(computePressureTrend(history([25, 1010], [0, 1013]))).toBe(
      "rising fast"
    );
  });

  it("rising when delta +0.5 to +2", () => {
    expect(computePressureTrend(history([25, 1011.5], [0, 1013]))).toBe(
      "rising"
    );
  });

  it("steady when delta -0.5 to +0.5", () => {
    expect(computePressureTrend(history([25, 1013.2], [0, 1013]))).toBe(
      "steady"
    );
  });

  it("falling when delta -2 to -0.5", () => {
    expect(computePressureTrend(history([25, 1014.5], [0, 1013]))).toBe(
      "falling"
    );
  });

  it("falling fast when delta < -2", () => {
    expect(computePressureTrend(history([25, 1016], [0, 1013]))).toBe(
      "falling fast"
    );
  });

  it("ignores entries outside the 30-min window", () => {
    // Old entry at 35 min ago (outside window) shows a huge change; recent 5 min is stable
    const h = history([35, 980], [5, 1012.8], [0, 1013]);
    expect(computePressureTrend(h)).toBe("steady");
  });
});

// ── trimPressureHistory ───────────────────────────────────────────────────────

describe("trimPressureHistory", () => {
  const now = Date.now();
  const min = 60_000;

  it("removes entries older than window", () => {
    const h: PressurePoint[] = [
      { time: now - 40 * min, value: 1010 }, // outside 30-min window
      { time: now - 20 * min, value: 1012 },
      { time: now, value: 1013 },
    ];
    const trimmed = trimPressureHistory(h, 30 * min);
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0]!.value).toBe(1012);
  });

  it("caps at 60 entries", () => {
    const h: PressurePoint[] = Array.from({ length: 70 }, (_, i) => ({
      time: now - (69 - i) * min,
      value: 1013,
    }));
    const trimmed = trimPressureHistory(h, 120 * min);
    expect(trimmed.length).toBeLessThanOrEqual(60);
  });
});

// ── computePrecipWeights ──────────────────────────────────────────────────────

describe("computePrecipWeights", () => {
  it("snow dominates at -5°C", () => {
    const w = computePrecipWeights(-5);
    expect(w.snow).toBeGreaterThan(w.rain);
    expect(w.snow).toBeGreaterThan(0.5);
  });

  it("rain dominates at 15°C", () => {
    const w = computePrecipWeights(15);
    expect(w.rain).toBeGreaterThan(w.snow);
    expect(w.rain).toBeGreaterThan(0.5);
  });

  it("sleet weight is nonzero in the mixed zone (~2°C)", () => {
    const w = computePrecipWeights(2);
    expect(w.sleet).toBeGreaterThan(0);
  });

  it("all weights are non-negative", () => {
    for (const t of [-20, -5, 0, 2, 5, 10, 20]) {
      const w = computePrecipWeights(t);
      expect(w.snow).toBeGreaterThanOrEqual(0);
      expect(w.rain).toBeGreaterThanOrEqual(0);
      expect(w.sleet).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── selectPrecipType ──────────────────────────────────────────────────────────

describe("selectPrecipType", () => {
  it("returns only valid types", () => {
    const rng = makeRng(1);
    const weights = { snow: 1, rain: 1, sleet: 1 };
    const valid = new Set(["snow", "rain", "sleet"]);
    for (let i = 0; i < 50; i++) {
      expect(valid.has(selectPrecipType(weights, rng))).toBe(true);
    }
  });

  it("heavily weighted snow → mostly snow", () => {
    const rng = makeRng(5);
    const weights = { snow: 100, rain: 1, sleet: 1 };
    let snowCount = 0;
    for (let i = 0; i < 100; i++) {
      if (selectPrecipType(weights, rng) === "snow") snowCount++;
    }
    expect(snowCount).toBeGreaterThan(80);
  });
});

// ── nextWeatherState ──────────────────────────────────────────────────────────

describe("nextWeatherState", () => {
  const rng = makeRng(42);
  const durationMs = 30 * 60 * 1000; // 30 min

  it("returns null before duration expires", () => {
    expect(
      nextWeatherState("clear", durationMs - 1, durationMs, 1013, 5, "medium", rng)
    ).toBeNull();
  });

  it("returns a transition after duration expires", () => {
    const result = nextWeatherState(
      "clear",
      durationMs,
      durationMs,
      1013,
      5,
      "medium",
      rng
    );
    expect(result).not.toBeNull();
    expect(result!.state).toBeTruthy();
    expect(result!.durationMs).toBeGreaterThan(0);
  });

  it("storm forces transition after 90-min hard cap even if duration not reached", () => {
    const ninetyMin = 90 * 60 * 1000;
    const result = nextWeatherState(
      "storm",
      ninetyMin,
      ninetyMin + 60_000, // duration hasn't expired yet
      1013,
      5,
      "medium",
      rng
    );
    expect(result).not.toBeNull();
    expect(result!.state).not.toBe("storm"); // storm shouldn't self-transition via base weights
  });

  it("storm does not exit before 90-min cap if duration not reached", () => {
    const result = nextWeatherState(
      "storm",
      45 * 60 * 1000, // 45 min elapsed
      120 * 60 * 1000, // 120 min duration
      1013,
      5,
      "medium",
      rng
    );
    expect(result).toBeNull();
  });

  it("all returned states are valid PrecipStates", () => {
    const valid = new Set(["clear", "overcast", "rain", "storm", "snow", "fog", "sleet"]);
    const states = ["clear", "overcast", "rain", "snow", "fog", "sleet"] as const;
    const localRng = makeRng(7);
    for (const state of states) {
      for (let i = 0; i < 10; i++) {
        const result = nextWeatherState(state, durationMs, durationMs, 1013, 5, "medium", localRng);
        if (result) {
          expect(valid.has(result.state)).toBe(true);
        }
      }
    }
  });
});

// ── initWeatherState ──────────────────────────────────────────────────────────

describe("initWeatherState", () => {
  it("returns a valid precip state", () => {
    const valid = new Set(["clear", "overcast", "rain", "storm", "snow", "fog", "sleet"]);
    const rng = makeRng(1);
    const result = initWeatherState(ALPINE_ZONE, new Date("2025-06-15T12:00:00"), rng);
    expect(valid.has(result.precipState)).toBe(true);
  });

  it("starts with zero noise", () => {
    const rng = makeRng(2);
    const result = initWeatherState(ALPINE_ZONE, new Date(), rng);
    expect(result.tempNoise).toBe(0);
    expect(result.pressureNoise).toBe(0);
  });

  it("returns a positive duration", () => {
    const rng = makeRng(3);
    const result = initWeatherState(ALPINE_ZONE, new Date(), rng);
    expect(result.precipStateDurationMs).toBeGreaterThan(0);
  });
});
