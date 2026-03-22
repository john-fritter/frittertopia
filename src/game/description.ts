import { z } from "zod/v4";

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
 * Render a room's description from blocks given the current conditions.
 * Currently only evaluates base blocks by visibility. Other block types
 * (weather, season, temperature) are accepted but ignored.
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

  return parts.join(" ");
}

/** Returns the current visibility level for a room. Hardcoded to full for now. */
export function getVisibility(_roomId: string): VisibilityLevel {
  return "full";
}
