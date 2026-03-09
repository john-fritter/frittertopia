import { World } from "./engine/World.js";
import { registerComponents } from "./game/components.js";
import { GameServer } from "./server/Server.js";

const world = new World();
registerComponents(world);

// --- The Monastery ---

const courtyard = world.createEntity("starting.room");
world.addComponent(courtyard, "Room", { name: "The Monastery Courtyard" });
world.addComponent(courtyard, "Description", {
  short: "a crumbling stone courtyard",
  long: "Cracked flagstones spread beneath an open sky, edged by low walls of grey stone worn smooth by centuries of rain. A well stands at the center, its rope frayed and its bucket long missing. Moss creeps between the stones in thick green seams, and somewhere above, a bird calls once and falls silent.",
});

const kitchen = world.createEntity("monastery.kitchen");
world.addComponent(kitchen, "Room", { name: "The Monastery Kitchen" });
world.addComponent(kitchen, "Description", {
  short: "a large stone kitchen",
  long: "A vaulted ceiling of soot-darkened stone arches above a room that still smells faintly of woodsmoke and dried herbs. A broad hearth dominates the far wall, its iron grate cold and spotted with rust. Bundles of rosemary and thyme hang from hooks along the rafters, brittle and grey with dust. A heavy oak table runs the length of the room, scarred with knife marks.",
});

const corridor = world.createEntity("monastery.corridor");
world.addComponent(corridor, "Room", { name: "The East Corridor" });
world.addComponent(corridor, "Description", {
  short: "a long stone corridor",
  long: "A narrow passage stretches between walls of rough-cut stone, the ceiling low enough to brush with an outstretched hand. Thin light falls from a single window set high in the eastern wall, casting a pale rectangle on the flagstones. The air is cool and still, carrying the faint mineral smell of old stone.",
});

const chapel = world.createEntity("monastery.chapel");
world.addComponent(chapel, "Room", { name: "The Small Chapel" });
world.addComponent(chapel, "Description", {
  short: "a small stone chapel",
  long: "A modest chapel of pale limestone, its walls bare except for a simple wooden cross above the altar. Three rows of worn pews face the front, their wood darkened by the oil of countless hands. Light enters through a single arched window of plain glass, filling the room with a quiet, steady glow. The silence here has weight.",
});

// --- Exits ---

world.addComponent(courtyard, "Exits", {
  exits: { east: corridor, south: kitchen },
});
world.addComponent(kitchen, "Exits", {
  exits: { north: courtyard },
});
world.addComponent(corridor, "Exits", {
  exits: { west: courtyard, north: chapel },
});
world.addComponent(chapel, "Exits", {
  exits: { south: corridor },
});

// --- Presence entities ---

const broom = world.createEntity();
world.addComponent(broom, "Position", { roomId: kitchen });
world.addComponent(broom, "Description", {
  short: "a broom",
  long: "A straw broom with a handle of pale ash, leaning at an angle as though someone set it down mid-sweep and never returned.",
});
world.addComponent(broom, "Presence", {
  description: "A broom leans against the wall, forgotten.",
});

const candle = world.createEntity();
world.addComponent(candle, "Position", { roomId: chapel });
world.addComponent(candle, "Description", {
  short: "a half-burned candle",
  long: "A thick tallow candle in a plain iron holder, burned halfway down. A thread of dried wax traces a line down its side like a frozen tear.",
});
world.addComponent(candle, "Presence", {
  description: "A half-burned candle sits on the altar, its wick cold.",
});

// --- Start server ---

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const server = new GameServer(world);
server.start(port);

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
});
