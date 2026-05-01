import type { SystemFn } from "../../engine/TickLoop.js";

const CHECK_INTERVAL_MS = 10_000;
const DEFAULT_DECAY_MS = 60 * 60 * 1000; // 60 minutes

export function createItemDecaySystem(tickIntervalMs: number): SystemFn {
  let elapsed = CHECK_INTERVAL_MS; // trigger immediately on first tick

  return (entities, _events) => {
    elapsed += tickIntervalMs;
    if (elapsed < CHECK_INTERVAL_MS) return;
    elapsed = 0;

    const now = Date.now();
    const candidates = entities.getEntitiesWithComponents(["ItemTemplate", "Position"]);

    for (const itemId of candidates) {
      const template = entities.getComponent(itemId, "ItemTemplate") as
        | { decayMs?: number }
        | undefined;
      const decayMs = template?.decayMs ?? DEFAULT_DECAY_MS;

      const state = entities.getComponent(itemId, "ItemState") as
        | Record<string, unknown>
        | undefined;

      if (state === undefined || state["placedAt"] === undefined) {
        entities.setComponent(itemId, "ItemState", {
          ...(state ?? {}),
          placedAt: now,
        });
      } else {
        const placedAt = state["placedAt"] as number;
        if (now - placedAt >= decayMs) {
          entities.deleteEntity(itemId);
        }
      }
    }
  };
}
