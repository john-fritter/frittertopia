import { z } from "zod/v4";
import type { World } from "../engine/World.js";

export function registerComponents(world: World): void {
  world.registerComponent(
    "Description",
    z.object({
      short: z.string(),
    })
  );

  world.registerComponent(
    "RoomBrief",
    z.object({ brief: z.string() })
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
    "SkyDescriptions",
    z.object({
      brackets: z.record(
        z.string(),
        z.object({
          sky: z.string(),
          window: z.string(),
          sound: z.string(),
          moon: z.record(z.string(), z.string()).optional(),
        })
      ),
    })
  );

  world.registerComponent(
    "TimeOfDay",
    z.object({
      bracket: z.string(),
      moonFraction: z.number(),
      moonPhase: z.string(),
      updatedAt: z.string(),
    })
  );

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
