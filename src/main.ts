import * as path from "node:path";
import * as fs from "node:fs";
import { World } from "./engine/World.js";
import { loadContentFromDirectory } from "./engine/ContentLoader.js";
import { createDatabase, saveWorld, loadWorld } from "./engine/Persistence.js";
import { registerComponents } from "./game/components.js";
import { GameServer } from "./server/Server.js";

const world = new World();
registerComponents(world);

const dataDir = path.join(import.meta.dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = createDatabase(path.join(dataDir, "world.db"));

const entityCount = (
  db.prepare("SELECT COUNT(*) as count FROM entities").get() as {
    count: number;
  }
).count;

if (entityCount > 0) {
  loadWorld(db, world);
  console.log(`Restored world from database (${entityCount} entities).`);
} else {
  const contentDir = path.join(import.meta.dirname, "..", "content");
  loadContentFromDirectory(contentDir, world);
  saveWorld(db, world);
  console.log("Loaded content from YAML and saved initial state.");
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
