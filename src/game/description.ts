import { z } from "zod/v4";
import type { World } from "../engine/World.js";
import type { TimeBracket } from "./solar.js";

// Visibility levels ordered from best to worst
export type VisibilityLevel = "full" | "reduced" | "minimal" | "none";

const VISIBILITY_RANK: Record<VisibilityLevel, number> = {
  none: 0,
  minimal: 1,
  reduced: 2,
  full: 3,
};

const VISIBILITY_LEVELS = new Set(["full", "reduced", "minimal", "none"]);

const VisibilityConditionSchema = z.string().refine(
  (v) =>
    VISIBILITY_LEVELS.has(v) ||
    (v.endsWith("+") && VISIBILITY_LEVELS.has(v.slice(0, -1))),
  "Must be a visibility level (full, reduced, minimal, none) optionally with + suffix"
);

export const BlockDetailSchema = z.object({
  visibility: VisibilityConditionSchema.optional(),
  text: z.string(),
});

export const DescriptionBlockSchema = z.object({
  id: z.string(),
  type: z.enum(["base", "weather", "season", "temperature"]),
  visibility: VisibilityConditionSchema.optional(),
  text: z.string(),
  details: z.array(BlockDetailSchema).optional(),
  // Future condition axes — validated but not evaluated by the renderer yet
  weather: z.array(z.string()).optional(),
  months: z.array(z.number().int().min(1).max(12)).optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
});

export type DescriptionBlock = z.infer<typeof DescriptionBlockSchema>;

export interface ConditionState {
  visibility: VisibilityLevel;
  variables?: Record<string, string>;
  weather?: string;
  temperature?: number;
  month?: number;
}

/** Returns true if the given visibility condition matches the current level. */
function matchesVisibility(
  condition: string | undefined,
  level: VisibilityLevel
): boolean {
  if (condition === undefined) return true;
  if (condition.endsWith("+")) {
    const base = condition.slice(0, -1) as VisibilityLevel;
    return VISIBILITY_RANK[level] >= VISIBILITY_RANK[base];
  }
  return condition === level;
}

/**
 * Returns a specificity score for a visibility condition.
 * Higher = more specific. Exact matches always beat thresholds.
 */
function specificity(condition: string | undefined): number {
  if (condition === undefined) return -1;
  if (condition.endsWith("+")) {
    const base = condition.slice(0, -1) as VisibilityLevel;
    return VISIBILITY_RANK[base];
  }
  return 10 + VISIBILITY_RANK[condition as VisibilityLevel];
}

/**
 * Replace {variableName} patterns with values from the variable map.
 * Unknown variables are left as-is.
 */
export function substituteVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value !== undefined ? value : match;
  });
}

/**
 * Render a room's description from blocks given the current conditions.
 * Currently only evaluates base blocks by visibility. Other block types
 * (weather, season, temperature) are accepted but ignored.
 *
 * If conditions.variables is provided, {variable} patterns in the composed
 * text are substituted with current values.
 */
export function renderDescription(
  blocks: DescriptionBlock[],
  conditions: ConditionState
): string {
  const candidates = blocks.filter(
    (b) =>
      b.type === "base" &&
      matchesVisibility(b.visibility, conditions.visibility)
  );

  if (candidates.length === 0) return "";

  candidates.sort(
    (a, b) => specificity(b.visibility) - specificity(a.visibility)
  );
  const best = candidates[0]!;

  const parts = [best.text];
  if (best.details) {
    for (const detail of best.details) {
      if (matchesVisibility(detail.visibility, conditions.visibility)) {
        parts.push(detail.text);
      }
    }
  }

  let text = parts.join(" ");

  if (conditions.variables) {
    text = substituteVariables(text, conditions.variables);
  }

  return text;
}

// --- Visibility computation ---

type Exposure = "outdoor" | "sheltered" | "indoor";

/**
 * Bracket-to-visibility mapping for outdoor rooms.
 * Moon bonus: moonFraction > 0.75 improves visibility by one tier at night.
 */
const OUTDOOR_VISIBILITY: Record<TimeBracket, VisibilityLevel> = {
  morning: "full",
  midday: "full",
  afternoon: "full",
  dawn: "reduced",
  dusk: "reduced",
  evening: "minimal",
  night: "minimal",
  deep_night: "none",
};

const OUTDOOR_MOON_BONUS: Record<TimeBracket, VisibilityLevel> = {
  morning: "full",
  midday: "full",
  afternoon: "full",
  dawn: "reduced",
  dusk: "reduced",
  evening: "minimal",
  night: "reduced",
  deep_night: "minimal",
};

/**
 * Sheltered rooms: same as outdoor but one tier better at the low end.
 * Moon bonus and shelter bonus don't stack above reduced.
 */
const SHELTERED_VISIBILITY: Record<TimeBracket, VisibilityLevel> = {
  morning: "full",
  midday: "full",
  afternoon: "full",
  dawn: "full",
  dusk: "reduced",
  evening: "reduced",
  night: "minimal",
  deep_night: "minimal",
};

const SHELTERED_MOON_BONUS: Record<TimeBracket, VisibilityLevel> = {
  morning: "full",
  midday: "full",
  afternoon: "full",
  dawn: "full",
  dusk: "reduced",
  evening: "reduced",
  night: "reduced",
  deep_night: "minimal",
};

const BRIGHT_MOON_THRESHOLD = 0.75;

/**
 * Compute the current visibility level for a room.
 *
 * Reads the room's RoomExposure and the current time bracket and moon data
 * from the world.time entity.
 *
 * Indoor rooms are always full visibility (they have their own light sources).
 * Outdoor and sheltered rooms depend on time of day and moon brightness.
 */
export function getVisibility(roomId: string, world: World): VisibilityLevel {
  const exposureComp = world.getComponent(roomId, "RoomExposure") as
    | { exposure: string }
    | undefined;
  const exposure: Exposure =
    (exposureComp?.exposure as Exposure) ?? "outdoor";

  if (exposure === "indoor") return "full";

  const timeEntity = world.getEntityByKey("world.time");
  if (!timeEntity) return "full";

  const tod = world.getComponent(timeEntity, "TimeOfDay") as
    | { bracket: string; moonFraction: number; moonPhase: string }
    | undefined;
  if (!tod || tod.bracket === "unknown") return "full";

  const bracket = tod.bracket as TimeBracket;
  const brightMoon = tod.moonFraction > BRIGHT_MOON_THRESHOLD;

  if (exposure === "sheltered") {
    return brightMoon
      ? SHELTERED_MOON_BONUS[bracket]
      : SHELTERED_VISIBILITY[bracket];
  }

  // outdoor
  return brightMoon
    ? OUTDOOR_MOON_BONUS[bracket]
    : OUTDOOR_VISIBILITY[bracket];
}
