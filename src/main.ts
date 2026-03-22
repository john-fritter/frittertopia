import * as path from "node:path";
import * as fs from "node:fs";
import { z } from "zod/v4";
import { World } from "./engine/World.js";
import { loadContentFromDirectory } from "./engine/ContentLoader.js";
import {
  createDatabase,
  saveWorld,
  loadSavedState,
} from "./engine/Persistence.js";
import { registerComponents } from "./game/components.js";
import { createSequenceSystem } from "./game/systems/SequenceSystem.js";
import { createTimeOfDaySystem } from "./game/systems/TimeOfDaySystem.js";
import { GameServer } from "./server/Server.js";

const TICK_INTERVAL = 250;

const world = new World({ tickInterval: TICK_INTERVAL });
registerComponents(world);

// Register events
world.registerEvent(
  "sequence_beat",
  z.object({ playerId: z.string(), text: z.string() })
);
world.registerEvent(
  "sequence_complete",
  z.object({ playerId: z.string(), roomId: z.string() })
);
world.registerEvent(
  "player_destroyed",
  z.object({ playerId: z.string() })
);

// Register systems
world.addSystem(createSequenceSystem(TICK_INTERVAL));
world.addSystem(createTimeOfDaySystem(TICK_INTERVAL));

// Create world.time singleton entity
const worldTimeId = world.createEntity("world.time");
world.addComponent(worldTimeId, "TimeOfDay", {
  bracket: "unknown",
  moonFraction: 0,
  moonPhase: "new",
  updatedAt: new Date().toISOString(),
});

const dataDir = path.join(import.meta.dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, "world.db");

// --fresh flag: delete saved state for a clean start
if (process.argv.includes("--fresh")) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  console.log("Fresh start: cleared saved state.");
}

const db = createDatabase(dbPath);

// Always load content from YAML — it's the authoritative source for rooms, items, sequences
const contentDir = path.join(import.meta.dirname, "..", "content");
loadContentFromDirectory(contentDir, world);
console.log("Loaded content from YAML.");

// Restore runtime state from DB (players + runtime-modified content entities)
const savedEntityCount = (
  db.prepare("SELECT COUNT(*) as count FROM entities").get() as {
    count: number;
  }
).count;

if (savedEntityCount > 0) {
  loadSavedState(db, world);
  console.log(`Restored ${savedEntityCount} saved entity/entities from database.`);
}

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const server = new GameServer(world);
server.start(port);

// Auto-save every 5 minutes
const autoSaveInterval = setInterval(() => {
  saveWorld(db, world);
  console.log("Auto-saved world.");
}, 5 * 60 * 1000);

function shutdown(): void {
  console.log("\nShutting down...");
  clearInterval(autoSaveInterval);
  server.stop();
  saveWorld(db, world);
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
