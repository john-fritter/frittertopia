import type { SystemFn } from "../../engine/TickLoop.js";
import { getTimeBracket, getMoonData, getCurrentTime } from "../solar.js";

const UPDATE_INTERVAL_MS = 60_000; // once per real minute

/**
 * Creates a system that updates the world.time singleton entity with the
 * current time-of-day bracket and moon data. Runs every tick but only
 * recalculates once per minute to avoid unnecessary suncalc calls.
 */
export function createTimeOfDaySystem(tickIntervalMs: number): SystemFn {
  let elapsed = UPDATE_INTERVAL_MS; // trigger immediately on first tick

  return (entities, _events) => {
    elapsed += tickIntervalMs;
    if (elapsed < UPDATE_INTERVAL_MS) return;
    elapsed = 0;

    const timeEntityId = entities.getEntityByKey("world.time");
    if (!timeEntityId) return;

    const now = getCurrentTime();
    const bracket = getTimeBracket(now);
    const moon = getMoonData(now);

    entities.setComponent(timeEntityId, "TimeOfDay", {
      bracket,
      moonFraction: moon.fraction,
      moonPhase: moon.phase,
      updatedAt: now.toISOString(),
    });
  };
}
