import _SunCalc from "suncalc";
// suncalc is CJS; under ESM the namespace lands on .default at runtime
// but vitest's transform may hoist it directly. Handle both shapes.
const SunCalc = ("default" in _SunCalc ? (_SunCalc as unknown as { default: typeof _SunCalc }).default : _SunCalc);

/** Configured world location — Bend, Oregon. */
export const LOCATION = {
  latitude: 44.06,
  longitude: -121.31,
  timeZone: "America/Los_Angeles",
} as const;

export type TimeBracket =
  | "deep_night"
  | "night"
  | "dawn"
  | "morning"
  | "midday"
  | "afternoon"
  | "dusk"
  | "evening";

// --- Debug time override ---

let debugTime: Date | null = null;

export function setDebugTime(time: Date | null): void {
  debugTime = time;
}

export function getDebugTime(): Date | null {
  return debugTime;
}

/** Returns the debug override time if set, otherwise the real clock. */
export function getCurrentTime(): Date {
  return debugTime ?? new Date();
}

// --- Timezone helpers ---

/**
 * Get the local date string (YYYY-MM-DD) for a Date in the configured timezone.
 */
function localDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: LOCATION.timeZone });
}

/**
 * Get the UTC instant corresponding to midnight of the local date containing `date`.
 * Uses Intl.DateTimeFormat to determine the timezone offset.
 */
function localMidnightUtc(date: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): number => {
    const val = parseInt(parts.find((p) => p.type === type)!.value);
    // Intl can return hour=24 for midnight — normalize to 0
    return type === "hour" && val === 24 ? 0 : val;
  };

  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  const offsetMs = localAsUtc - date.getTime();

  const dateStr = localDateString(date);
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const midnightLocalAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(midnightLocalAsUtc - offsetMs);
}

// --- Moon phase ---

export type MoonPhaseName =
  | "new"
  | "waxing_crescent"
  | "first_quarter"
  | "waxing_gibbous"
  | "full"
  | "waning_gibbous"
  | "third_quarter"
  | "waning_crescent";

const MOON_PHASE_NAMES: MoonPhaseName[] = [
  "new",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full",
  "waning_gibbous",
  "third_quarter",
  "waning_crescent",
];

/**
 * Derive a human-readable moon phase name from suncalc's 0-1 phase value.
 * Eight equal divisions of the lunar cycle.
 */
export function getMoonPhaseName(phase: number): MoonPhaseName {
  // phase 0 = new moon, 0.25 = first quarter, 0.5 = full, 0.75 = third quarter
  // Each of 8 phases spans 0.125 of the cycle, centered on its ideal position.
  const index = Math.floor(((phase + 0.0625) % 1) * 8);
  return MOON_PHASE_NAMES[index] ?? "new";
}

/**
 * Get moon illumination fraction and phase name for a date.
 */
export function getMoonData(date?: Date): {
  fraction: number;
  phase: MoonPhaseName;
} {
  const now = date ?? getCurrentTime();
  const moonData = SunCalc.getMoonIllumination(now);
  return {
    fraction: moonData.fraction,
    phase: getMoonPhaseName(moonData.phase),
  };
}

/**
 * Returns true if the moon is above the horizon at the world location.
 * altitude > 0 means the moon is up.
 */
export function getMoonAboveHorizon(date?: Date): boolean {
  const now = date ?? getCurrentTime();
  const pos = SunCalc.getMoonPosition(now, LOCATION.latitude, LOCATION.longitude);
  return pos.altitude > 0;
}

// --- Bracket computation ---

function isValidSunTime(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Compute the current time-of-day bracket from solar position.
 *
 * Brackets (in order through the day):
 *   deep_night  — midnight → astronomical dawn
 *   night       — astronomical dawn → nautical dawn
 *   dawn        — nautical dawn → sunrise
 *   morning     — sunrise → solar noon − 1 hr
 *   midday      — solar noon ± 1 hr
 *   afternoon   — solar noon + 1 hr → sunset
 *   dusk        — sunset → nautical dusk
 *   evening     — nautical dusk → astronomical dusk
 *   night       — astronomical dusk → midnight
 *
 * If suncalc can't compute a twilight stage (high-latitude summer/winter),
 * the missing boundaries are skipped and adjacent brackets merge.
 */
export function getTimeBracket(date?: Date): TimeBracket {
  const now = date ?? getCurrentTime();

  // Compute suncalc times for the correct local date.
  // suncalc uses the UTC date of the input, so pass noon UTC of the local date
  // to ensure we get the right day's solar events.
  const localDate = localDateString(now);
  const refDate = new Date(localDate + "T12:00:00Z");
  const times = SunCalc.getTimes(
    refDate,
    LOCATION.latitude,
    LOCATION.longitude
  );

  const midnight = localMidnightUtc(now);

  // Build ordered boundaries: [utcTime, bracketThatStartsHere]
  const boundaries: Array<[Date, TimeBracket]> = [];

  boundaries.push([midnight, "deep_night"]);

  if (isValidSunTime(times.nightEnd)) {
    boundaries.push([times.nightEnd, "night"]);
  }
  if (isValidSunTime(times.nauticalDawn)) {
    boundaries.push([times.nauticalDawn, "dawn"]);
  }
  if (isValidSunTime(times.sunrise)) {
    boundaries.push([times.sunrise, "morning"]);
  }
  if (isValidSunTime(times.solarNoon)) {
    const middayStart = new Date(times.solarNoon.getTime() - 60 * 60 * 1000);
    const middayEnd = new Date(times.solarNoon.getTime() + 60 * 60 * 1000);
    boundaries.push([middayStart, "midday"]);
    // Only add afternoon if it ends before sunset (or sunset is missing)
    if (
      !isValidSunTime(times.sunset) ||
      middayEnd.getTime() < times.sunset.getTime()
    ) {
      boundaries.push([middayEnd, "afternoon"]);
    }
  }
  if (isValidSunTime(times.sunset)) {
    boundaries.push([times.sunset, "dusk"]);
  }
  if (isValidSunTime(times.nauticalDusk)) {
    boundaries.push([times.nauticalDusk, "evening"]);
  }
  if (isValidSunTime(times.night)) {
    boundaries.push([times.night, "night"]);
  }

  // Sort by time
  boundaries.sort((a, b) => a[0].getTime() - b[0].getTime());

  // Find the last boundary whose time is <= now
  let bracket: TimeBracket = "deep_night";
  for (const [time, name] of boundaries) {
    if (now.getTime() >= time.getTime()) {
      bracket = name;
    } else {
      break;
    }
  }

  return bracket;
}
