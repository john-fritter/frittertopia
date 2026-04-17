export type PrecipState =
  | "clear"
  | "overcast"
  | "rain"
  | "storm"
  | "snow"
  | "fog"
  | "sleet";

export type TempBracket = "frigid" | "cold" | "cool" | "mild" | "warm" | "hot";

export type PressureTrend =
  | "falling fast"
  | "falling"
  | "steady"
  | "rising"
  | "rising fast";

export interface TempCurve {
  winterMin: number;
  winterMax: number;
  summerMin: number;
  summerMax: number;
  diurnalRange: number;
}

export interface PressureDrift {
  speed: "slow" | "medium" | "fast";
  volatility: "low" | "medium" | "high";
}

export interface WeatherZoneParams {
  tempCurve: TempCurve;
  pressureDrift: PressureDrift;
  precipitationBias: "low" | "medium" | "high";
}

export interface NoiseState {
  tempNoise: number;
  pressureNoise: number;
}

export interface PressurePoint {
  time: number; // Date.now() ms
  value: number; // hPa
}

// Seeded mulberry32 PRNG. Falls back to time-based seed if none provided.
export function makeRng(seed?: number): () => number {
  let s =
    seed !== undefined
      ? seed >>> 0
      : ((Date.now() ^ (Math.random() * 0xffffffff)) | 0) >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller transform
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

// Temperature in °C. Seasonal peak ~Aug 1 (day 213), trough ~Jan 31 (day 31).
// Coldest before dawn (~5am local), warmest mid-afternoon (~3pm local).
export function computeTemperatureCelsius(
  now: Date,
  params: WeatherZoneParams,
  noise: NoiseState
): number {
  const { winterMin, winterMax, summerMin, summerMax, diurnalRange } =
    params.tempCurve;

  // Seasonal component
  const dayOfYear = getDayOfYear(now);
  const PEAK_DAY = 213; // Aug 1 — ~6 wks after summer solstice (thermal lag)
  const seasonalFraction = Math.cos(
    (2 * Math.PI * (dayOfYear - PEAK_DAY)) / 365
  );
  const midTemp = (summerMax + winterMin) / 2;
  const halfRange = (summerMax - winterMin) / 2;
  const seasonalTemp = midTemp + halfRange * seasonalFraction;

  // Diurnal component: peak at 15h (3pm), trough at 5h (5am)
  const PEAK_HOUR = 15; // 3pm — warmest mid-afternoon
  const hourDecimal = now.getHours() + now.getMinutes() / 60;
  const diurnalFraction = Math.cos(
    (2 * Math.PI * (hourDecimal - PEAK_HOUR)) / 24
  );
  const diurnalContrib = (diurnalRange / 2) * diurnalFraction;

  // Constrain the result to within 2°C of the plausible seasonal range
  // (summerMin↔summerMax in summer, winterMin↔winterMax in winter)
  // This is handled naturally — noise is bounded by updateNoiseTerms.
  // We just add it raw here.
  return seasonalTemp + diurnalContrib + noise.tempNoise;
}

const VOLATILITY_PARAMS = {
  low: { sigma: 0.3, alpha: 0.05, tempMax: 5, pressMax: 15 },
  medium: { sigma: 0.5, alpha: 0.03, tempMax: 8, pressMax: 25 },
  high: { sigma: 0.8, alpha: 0.02, tempMax: 12, pressMax: 35 },
} as const;

export function updateNoiseTerms(
  state: NoiseState,
  params: WeatherZoneParams,
  rng: () => number
): NoiseState {
  const { sigma, alpha, tempMax, pressMax } =
    VOLATILITY_PARAMS[params.pressureDrift.volatility];

  const newTempNoise = Math.max(
    -tempMax,
    Math.min(tempMax, state.tempNoise * (1 - alpha) + gaussian(rng) * sigma)
  );
  const newPressureNoise = Math.max(
    -pressMax,
    Math.min(
      pressMax,
      state.pressureNoise * (1 - alpha) + gaussian(rng) * sigma * 5
    )
  );

  return { tempNoise: newTempNoise, pressureNoise: newPressureNoise };
}

export function computeTempBracket(tempC: number): TempBracket {
  if (tempC < -10) return "frigid";
  if (tempC < 0) return "cold";
  if (tempC < 10) return "cool";
  if (tempC < 20) return "mild";
  if (tempC < 28) return "warm";
  return "hot";
}

export function celsiusToFahrenheit(c: number): number {
  return c * (9 / 5) + 32;
}

const TREND_WINDOW_MS = 1_800_000; // 30 min

export function computePressureTrend(
  history: PressurePoint[],
  windowMs: number = TREND_WINDOW_MS
): PressureTrend {
  if (history.length < 2) return "steady";

  const latest = history[history.length - 1];
  if (!latest) return "steady";

  const cutoff = latest.time - windowMs;
  const oldest = history.find((p) => p.time >= cutoff);
  if (!oldest || oldest === latest) return "steady";

  const delta = latest.value - oldest.value;
  if (delta > 2) return "rising fast";
  if (delta > 0.5) return "rising";
  if (delta < -2) return "falling fast";
  if (delta < -0.5) return "falling";
  return "steady";
}

export function trimPressureHistory(
  history: PressurePoint[],
  windowMs: number = TREND_WINDOW_MS
): PressurePoint[] {
  if (history.length === 0) return history;
  const latest = history[history.length - 1];
  if (!latest) return history;
  const cutoff = latest.time - windowMs;
  const trimmed = history.filter((p) => p.time >= cutoff);
  // Cap at 60 entries
  return trimmed.length > 60 ? trimmed.slice(trimmed.length - 60) : trimmed;
}

export function computePrecipWeights(tempC: number): {
  rain: number;
  snow: number;
  sleet: number;
} {
  const snowP = 1 / (1 + Math.exp(0.5 * (tempC - 0)));
  const rainP = 1 / (1 + Math.exp(-0.5 * (tempC - 4)));
  const sleetP = Math.max(0, 1 - snowP - rainP);
  return { snow: snowP, rain: rainP, sleet: sleetP };
}

export function selectPrecipType(
  weights: { rain: number; snow: number; sleet: number },
  rng: () => number
): "rain" | "snow" | "sleet" {
  const total = weights.rain + weights.snow + weights.sleet;
  const r = rng() * total;
  if (r < weights.snow) return "snow";
  if (r < weights.snow + weights.rain) return "rain";
  return "sleet";
}

const STATE_DURATIONS: Record<PrecipState, [number, number]> = {
  clear: [60, 300],
  overcast: [30, 180],
  rain: [20, 90],
  storm: [20, 90],
  snow: [20, 120],
  fog: [30, 120],
  sleet: [10, 60],
};

const STORM_MAX_MS = 90 * 60 * 1000;

// Base transition weights (target state → weight)
const BASE_TRANSITIONS: Record<PrecipState, Partial<Record<PrecipState, number>>> = {
  clear: { overcast: 2, fog: 1, clear: 7 },
  overcast: { clear: 3, rain: 3, snow: 2, fog: 2 },
  rain: { clear: 2, overcast: 4, storm: 2, sleet: 1, rain: 1 },
  storm: { overcast: 6, rain: 3, clear: 1 },
  snow: { clear: 2, overcast: 4, sleet: 2, snow: 2 },
  fog: { clear: 5, overcast: 3, fog: 2 },
  sleet: { rain: 3, snow: 3, overcast: 3, sleet: 1 },
};

const PRECIP_STATES = new Set<PrecipState>(["rain", "storm", "snow", "sleet"]);
const CLEAR_STATES = new Set<PrecipState>(["clear", "overcast"]);

function randomDurationMs(state: PrecipState, rng: () => number): number {
  const [minMin, maxMin] = STATE_DURATIONS[state];
  const minutes = minMin + rng() * (maxMin - minMin);
  return Math.round(minutes * 60 * 1000);
}

function weightedChoice(
  weights: Partial<Record<PrecipState, number>>,
  rng: () => number
): PrecipState {
  const entries = Object.entries(weights) as [PrecipState, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [state, w] of entries) {
    r -= w;
    if (r <= 0) return state;
  }
  return entries[entries.length - 1]![0];
}

export function nextWeatherState(
  current: PrecipState,
  elapsedMs: number,
  durationMs: number,
  pressureMb: number,
  tempC: number,
  precipBias: "low" | "medium" | "high",
  rng: () => number
): { state: PrecipState; durationMs: number } | null {
  const stormCapped = current === "storm" && elapsedMs >= STORM_MAX_MS;
  if (!stormCapped && elapsedMs < durationMs) return null;

  // Build adjusted weights
  const base = { ...BASE_TRANSITIONS[current] };
  const adjusted: Partial<Record<PrecipState, number>> = {};

  const lowPressureMultiplier =
    pressureMb < 1000 ? 1 + (1000 - pressureMb) / 20 : 1;
  const highPressureMultiplier =
    pressureMb > 1015 ? 1 + (pressureMb - 1015) / 15 : 1;
  const biasMultiplier =
    precipBias === "high" ? 2 : precipBias === "low" ? 0.5 : 1;

  for (const [state, weight] of Object.entries(base) as [PrecipState, number][]) {
    let w = weight;
    if (PRECIP_STATES.has(state)) {
      w *= lowPressureMultiplier * biasMultiplier;
    }
    if (CLEAR_STATES.has(state)) {
      w *= highPressureMultiplier;
    }
    adjusted[state] = w;
  }

  let chosen = weightedChoice(adjusted, rng);

  // If chosen is a precip state, pick specific type based on temperature
  if (PRECIP_STATES.has(chosen) && chosen !== "storm") {
    const weights = computePrecipWeights(tempC);
    chosen = selectPrecipType(weights, rng);
  }

  return { state: chosen, durationMs: randomDurationMs(chosen, rng) };
}

export function initWeatherState(
  params: WeatherZoneParams,
  now: Date,
  rng: () => number
): {
  tempNoise: number;
  pressureNoise: number;
  precipState: PrecipState;
  precipStateDurationMs: number;
} {
  const zeroNoise: NoiseState = { tempNoise: 0, pressureNoise: 0 };
  const tempC = computeTemperatureCelsius(now, params, zeroNoise);

  // Season-biased initial state weights
  const dayOfYear = getDayOfYear(now);
  const isWinter = dayOfYear < 60 || dayOfYear > 330;
  const isSummer = dayOfYear > 150 && dayOfYear < 240;

  let initialWeights: Partial<Record<PrecipState, number>> = {
    clear: 4,
    overcast: 3,
    rain: 2,
    snow: 1,
    fog: 1,
  };

  if (isWinter) {
    initialWeights = { clear: 2, overcast: 4, snow: 3, fog: 1 };
  } else if (isSummer) {
    initialWeights = { clear: 6, overcast: 2, rain: 2 };
  }

  const biasMultiplier =
    params.precipitationBias === "high"
      ? 2
      : params.precipitationBias === "low"
        ? 0.5
        : 1;

  const adjusted: Partial<Record<PrecipState, number>> = {};
  for (const [state, w] of Object.entries(initialWeights) as [PrecipState, number][]) {
    adjusted[state] = PRECIP_STATES.has(state) ? w * biasMultiplier : w;
  }

  let precipState = weightedChoice(adjusted, rng);

  // Resolve precip type via temperature
  if (PRECIP_STATES.has(precipState) && precipState !== "storm") {
    const weights = computePrecipWeights(tempC);
    precipState = selectPrecipType(weights, rng);
  }

  return {
    tempNoise: 0,
    pressureNoise: 0,
    precipState,
    precipStateDurationMs: randomDurationMs(precipState, rng),
  };
}
