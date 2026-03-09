import * as path from "node:path";
import { World } from "./engine/World.js";
import { loadContentFromDirectory } from "./engine/ContentLoader.js";
import { registerComponents } from "./game/components.js";
import { GameServer } from "./server/Server.js";

const world = new World();
registerComponents(world);

const contentDir = path.join(import.meta.dirname, "..", "content");
loadContentFromDirectory(contentDir, world);

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const server = new GameServer(world);
server.start(port);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
});
