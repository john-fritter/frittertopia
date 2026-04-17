import type { SystemFn } from "../../engine/TickLoop.js";
import {
  makeRng,
  computeTemperatureCelsius,
  updateNoiseTerms,
  trimPressureHistory,
  nextWeatherState,
  initWeatherState,
  type WeatherZoneParams,
  type NoiseState,
  type PrecipState,
  type PressurePoint,
} from "../weather.js";

const UPDATE_INTERVAL_MS = 60_000;
const HISTORY_WINDOW_MS = 1_800_000; // 30 min

interface WeatherZoneData extends WeatherZoneParams {
  climate: string;
}

interface WeatherStateData {
  tempC: number;
  pressureMb: number;
  precipState: PrecipState;
  precipStateElapsedMs: number;
  precipStateDurationMs: number;
  tempNoise: number;
  pressureNoise: number;
  pressureHistory: PressurePoint[];
  snowDepth: number;
}

export function createWeatherSystem(tickIntervalMs: number): SystemFn {
  let elapsed = UPDATE_INTERVAL_MS; // trigger immediately on first tick
  const rng = makeRng();

  return (entities, _events) => {
    elapsed += tickIntervalMs;
    if (elapsed < UPDATE_INTERVAL_MS) return;
    elapsed = 0;

    const now = new Date();
    const zoneIds = entities.getEntitiesWithComponent("WeatherZone");

    for (const zoneId of zoneIds) {
      const zone = entities.getComponent(zoneId, "WeatherZone") as WeatherZoneData | undefined;
      if (!zone) continue;

      const existing = entities.getComponent(zoneId, "WeatherState") as WeatherStateData | undefined;

      if (!existing) {
        const init = initWeatherState(zone, now, rng);
        const noiseState: NoiseState = { tempNoise: init.tempNoise, pressureNoise: init.pressureNoise };
        entities.setComponent(zoneId, "WeatherState", {
          tempC: computeTemperatureCelsius(now, zone, noiseState),
          pressureMb: 1013 + init.pressureNoise,
          precipState: init.precipState,
          precipStateElapsedMs: 0,
          precipStateDurationMs: init.precipStateDurationMs,
          tempNoise: init.tempNoise,
          pressureNoise: init.pressureNoise,
          pressureHistory: [{ time: now.getTime(), value: 1013 + init.pressureNoise }],
          snowDepth: 0,
        });
        continue;
      }

      const newNoise = updateNoiseTerms(
        { tempNoise: existing.tempNoise, pressureNoise: existing.pressureNoise },
        zone,
        rng
      );

      const newTempC = computeTemperatureCelsius(now, zone, newNoise);
      const newPressureMb = 1013 + newNoise.pressureNoise;

      const newHistory = trimPressureHistory(
        [...existing.pressureHistory, { time: now.getTime(), value: newPressureMb }],
        HISTORY_WINDOW_MS
      );

      const newElapsed = existing.precipStateElapsedMs + UPDATE_INTERVAL_MS;
      const transition = nextWeatherState(
        existing.precipState,
        newElapsed,
        existing.precipStateDurationMs,
        newPressureMb,
        newTempC,
        zone.precipitationBias,
        rng
      );

      entities.setComponent(zoneId, "WeatherState", {
        tempC: newTempC,
        pressureMb: newPressureMb,
        precipState: transition ? transition.state : existing.precipState,
        precipStateElapsedMs: transition ? 0 : newElapsed,
        precipStateDurationMs: transition ? transition.durationMs : existing.precipStateDurationMs,
        tempNoise: newNoise.tempNoise,
        pressureNoise: newNoise.pressureNoise,
        pressureHistory: newHistory,
        snowDepth: 0,
      });
    }
  };
}
