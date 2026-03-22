import { z } from "zod/v4";
import type { World } from "../engine/World.js";
import { DescriptionBlockSchema } from "./description.js";

export function registerComponents(world: World): void {
  world.registerComponent(
    "Description",
    z.object({
      short: z.string(),
      long: z.string().optional(),
      blocks: z.array(DescriptionBlockSchema).optional(),
    })
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

  world.registerComponent(
    "VisitedRooms",
    z.object({ rooms: z.array(z.string()) })
  );

  world.registerComponent("Admin", z.object({ level: z.number().default(1) }));

  world.registerComponent(
    "Sequence",
    z.object({
      beats: z.array(
        z.object({
          text: z.string(),
          delay: z.number(),
        })
      ),
      currentBeat: z.number(),
      elapsed: z.number(),
      onComplete: z.object({
        placeInRoom: z.string().optional(),
      }),
      deflectMessage: z.string(),
    })
  );

}
