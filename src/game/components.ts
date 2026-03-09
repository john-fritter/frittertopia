import { z } from "zod/v4";
import type { World } from "../engine/World.js";

export function registerComponents(world: World): void {
  world.registerComponent(
    "Description",
    z.object({ short: z.string(), long: z.string() })
  );

  world.registerComponent(
    "Position",
    z.object({ roomId: z.string() }),
    ["roomId"]
  );

  world.registerComponent("Room", z.object({ name: z.string() }));

  world.registerComponent(
    "Exits",
    z.object({ exits: z.record(z.string(), z.string()) }),
    ["exits.*"]
  );

  world.registerComponent(
    "Player",
    z.object({ name: z.string(), sessionId: z.string() })
  );

  world.registerComponent(
    "Presence",
    z.object({ description: z.string() })
  );
}
