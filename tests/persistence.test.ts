import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { z } from "zod/v4";
import {
  createDatabase,
  saveWorld,
  loadSavedState,
} from "../src/engine/Persistence.js";
import { World } from "../src/engine/World.js";

function makeWorld(): World {
  const world = new World();
  world.registerComponent("Room", z.object({ name: z.string() }));
  world.registerComponent(
    "Description",
    z.object({ short: z.string(), long: z.string() })
  );
  world.registerComponent(
    "Position",
    z.object({ roomId: z.string() }),
    ["roomId"]
  );
  world.registerComponent(
    "Player",
    z.object({ name: z.string(), sessionId: z.string() })
  );
  world.registerComponent(
    "VisitedRooms",
    z.object({ rooms: z.array(z.string()) })
  );
  world.registerComponent(
    "Exits",
    z.object({ exits: z.record(z.string(), z.string()) }),
    ["exits.*"]
  );
  world.registerComponent(
    "Presence",
    z.object({ description: z.string() })
  );
  return world;
}

/** Create a world with content entities (rooms + an item). */
function populateContent(world: World): {
  kitchen: string;
  courtyard: string;
  broom: string;
} {
  const kitchen = world.createEntity("monastery.kitchen");
  world.addComponent(kitchen, "Room", { name: "Kitchen" });
  world.addComponent(kitchen, "Description", {
    short: "A kitchen.",
    long: "A large monastery kitchen.",
  });

  const courtyard = world.createEntity("starting.room");
  world.addComponent(courtyard, "Room", { name: "Courtyard" });
  world.addComponent(courtyard, "Description", {
    short: "A courtyard.",
    long: "A sunlit courtyard.",
  });

  world.addComponent(kitchen, "Exits", {
    exits: { south: courtyard },
  });
  world.addComponent(courtyard, "Exits", {
    exits: { north: kitchen },
  });

  const broom = world.createEntity("monastery.broom");
  world.addComponent(broom, "Description", {
    short: "A broom",
    long: "A worn straw broom.",
  });
  world.addComponent(broom, "Presence", {
    description: "A straw broom leans against the wall.",
  });
  world.addComponent(broom, "Position", { roomId: courtyard });

  return { kitchen, courtyard, broom };
}

describe("Persistence — save everything, merge on load", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("all entities saved — content and players", () => {
    const world = makeWorld();
    populateContent(world);

    const player = world.createEntity("player.maren");
    world.addComponent(player, "Player", { name: "Maren", sessionId: "s1" });

    saveWorld(db, world);

    const entityCount = (
      db.prepare("SELECT COUNT(*) as count FROM entities").get() as {
        count: number;
      }
    ).count;
    // 3 content entities (kitchen, courtyard, broom) + 1 player
    expect(entityCount).toBe(4);

    const keys = (
      db.prepare("SELECT key FROM entities WHERE key IS NOT NULL ORDER BY key")
        .all() as Array<{ key: string }>
    ).map((r) => r.key);
    expect(keys).toContain("monastery.kitchen");
    expect(keys).toContain("starting.room");
    expect(keys).toContain("monastery.broom");
    expect(keys).toContain("player.maren");
  });

  it("save translates UUIDs to keys for Position, VisitedRooms, and Exits", () => {
    const world = makeWorld();
    const { kitchen, courtyard } = populateContent(world);

    const player = world.createEntity("player.test");
    world.addComponent(player, "Player", { name: "Test", sessionId: "" });
    world.addComponent(player, "Position", { roomId: kitchen });
    world.addComponent(player, "VisitedRooms", {
      rooms: [kitchen, courtyard],
    });

    saveWorld(db, world);

    // Position stores key
    const posRow = db
      .prepare(
        "SELECT data FROM components WHERE entity_id = ? AND component_type = ?"
      )
      .get(player, "Position") as { data: string };
    expect(JSON.parse(posRow.data).roomId).toBe("monastery.kitchen");

    // VisitedRooms stores keys
    const vrRow = db
      .prepare(
        "SELECT data FROM components WHERE entity_id = ? AND component_type = ?"
      )
      .get(player, "VisitedRooms") as { data: string };
    expect(JSON.parse(vrRow.data).rooms).toEqual([
      "monastery.kitchen",
      "starting.room",
    ]);

    // Exits stores keys
    const exitsRow = db
      .prepare(
        "SELECT data FROM components WHERE entity_id = ? AND component_type = ?"
      )
      .get(kitchen, "Exits") as { data: string };
    expect(JSON.parse(exitsRow.data).exits).toEqual({
      south: "starting.room",
    });
  });

  it("merge on load — content entity gets DB state overlaid on YAML baseline", () => {
    const world1 = makeWorld();
    const rooms1 = populateContent(world1);

    // Move broom to kitchen at runtime
    const broom1 = world1.getEntityByKey("monastery.broom")!;
    world1.entities.setComponent(broom1, "Position", {
      roomId: rooms1.kitchen,
    });

    saveWorld(db, world1);

    // Restart: fresh content (broom starts in courtyard per YAML), then merge
    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    loadSavedState(db, world2);

    // Broom Position comes from DB (kitchen), not YAML (courtyard)
    const broom2 = world2.getEntityByKey("monastery.broom")!;
    const pos = world2.getComponent(broom2, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.kitchen);
  });

  it("YAML component preserved when DB has no saved version", () => {
    const world1 = makeWorld();
    populateContent(world1);
    saveWorld(db, world1);

    // Restart with updated YAML — broom gets a new component not in DB
    const world2 = makeWorld();
    populateContent(world2);
    const broom2 = world2.getEntityByKey("monastery.broom")!;
    // Simulate new YAML component (Lock) — register it first
    world2.registerComponent("Lock", z.object({ locked: z.boolean() }));
    world2.addComponent(broom2, "Lock", { locked: true });

    loadSavedState(db, world2);

    // Lock component survives merge (DB doesn't have it, so YAML version stays)
    const lock = world2.getComponent(broom2, "Lock") as { locked: boolean };
    expect(lock.locked).toBe(true);

    // DB components are also present
    const desc = world2.getComponent(broom2, "Description") as {
      short: string;
    };
    expect(desc.short).toBe("A broom");
  });

  it("player entities still restore correctly (only in DB, not YAML)", () => {
    const world1 = makeWorld();
    const { kitchen } = populateContent(world1);

    const player = world1.createEntity("player.maren");
    world1.addComponent(player, "Player", { name: "Maren", sessionId: "s1" });
    world1.addComponent(player, "Position", { roomId: kitchen });
    world1.addComponent(player, "VisitedRooms", { rooms: [kitchen] });

    saveWorld(db, world1);

    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    loadSavedState(db, world2);

    // Player exists with correct data
    expect(world2.entities.hasEntity(player)).toBe(true);
    expect(world2.getEntityByKey("player.maren")).toBe(player);

    const playerComp = world2.getComponent(player, "Player") as {
      name: string;
    };
    expect(playerComp.name).toBe("Maren");

    // Position resolves to new kitchen UUID
    const pos = world2.getComponent(player, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.kitchen);

    // VisitedRooms resolved
    const visited = world2.getComponent(player, "VisitedRooms") as {
      rooms: string[];
    };
    expect(visited.rooms).toEqual([rooms2.kitchen]);
  });

  it("orphaned content entity: warns and discards", () => {
    const world1 = makeWorld();
    populateContent(world1);

    // Create extra content entity that won't exist on restart
    const torch = world1.createEntity("dungeon.torch");
    world1.addComponent(torch, "Presence", {
      description: "A flickering torch.",
    });

    saveWorld(db, world1);

    // Restart without dungeon.torch in content
    const world2 = makeWorld();
    populateContent(world2);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadSavedState(db, world2);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Saved state for "dungeon.torch" but it no longer exists in content'
      )
    );
    expect(world2.getEntityByKey("dungeon.torch")).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("orphaned player position: moved to starting room", () => {
    const world1 = makeWorld();
    populateContent(world1);

    const tempRoom = world1.createEntity("temp.room");
    world1.addComponent(tempRoom, "Room", { name: "Temp" });

    const player = world1.createEntity("player.lost");
    world1.addComponent(player, "Player", { name: "Lost", sessionId: "" });
    world1.addComponent(player, "Position", { roomId: tempRoom });
    world1.addComponent(player, "VisitedRooms", { rooms: [tempRoom] });

    saveWorld(db, world1);

    const world2 = makeWorld();
    const rooms2 = populateContent(world2);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadSavedState(db, world2);

    const pos = world2.getComponent(player, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.courtyard);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Player "Lost" was in a room that no longer exists'
      )
    );

    const visited = world2.getComponent(player, "VisitedRooms") as {
      rooms: string[];
    };
    expect(visited.rooms).toEqual([]);

    warnSpy.mockRestore();
  });

  it("UUID↔key translation for non-player entities (item Position)", () => {
    const world1 = makeWorld();
    const rooms1 = populateContent(world1);

    // Move broom to kitchen
    const broom1 = world1.getEntityByKey("monastery.broom")!;
    world1.entities.setComponent(broom1, "Position", {
      roomId: rooms1.kitchen,
    });

    saveWorld(db, world1);

    // Verify DB has key, not UUID
    const posRow = db
      .prepare(
        "SELECT data FROM components WHERE entity_id = ? AND component_type = ?"
      )
      .get(broom1, "Position") as { data: string };
    expect(JSON.parse(posRow.data).roomId).toBe("monastery.kitchen");

    // Restart — room gets new UUID
    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    loadSavedState(db, world2);

    // Broom Position points to new kitchen UUID
    const broom2 = world2.getEntityByKey("monastery.broom")!;
    const pos = world2.getComponent(broom2, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.kitchen);
    expect(pos.roomId).not.toBe(rooms1.kitchen); // different UUID
  });

  it("full round-trip: content + players + modifications", () => {
    const world1 = makeWorld();
    const rooms1 = populateContent(world1);

    // Player in kitchen
    const player = world1.createEntity("player.ada");
    world1.addComponent(player, "Player", { name: "Ada", sessionId: "" });
    world1.addComponent(player, "Position", { roomId: rooms1.kitchen });
    world1.addComponent(player, "VisitedRooms", {
      rooms: [rooms1.courtyard, rooms1.kitchen],
    });

    // Broom moved to kitchen
    const broom1 = world1.getEntityByKey("monastery.broom")!;
    world1.entities.setComponent(broom1, "Position", {
      roomId: rooms1.kitchen,
    });

    saveWorld(db, world1);

    // Restart
    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    loadSavedState(db, world2);

    // Player restored
    const playerPos = world2.getComponent(player, "Position") as {
      roomId: string;
    };
    expect(playerPos.roomId).toBe(rooms2.kitchen);

    const visited = world2.getComponent(player, "VisitedRooms") as {
      rooms: string[];
    };
    expect(visited.rooms).toContain(rooms2.courtyard);
    expect(visited.rooms).toContain(rooms2.kitchen);

    // Broom position preserved (kitchen, not courtyard YAML default)
    const broom2 = world2.getEntityByKey("monastery.broom")!;
    const broomPos = world2.getComponent(broom2, "Position") as {
      roomId: string;
    };
    expect(broomPos.roomId).toBe(rooms2.kitchen);

    // Exits resolved correctly
    const kitchenExits = world2.getComponent(rooms2.kitchen, "Exits") as {
      exits: Record<string, string>;
    };
    expect(kitchenExits.exits.south).toBe(rooms2.courtyard);
  });

  it("second save overwrites previous data", () => {
    const world = makeWorld();
    const { kitchen, courtyard } = populateContent(world);

    const player = world.createEntity("player.test");
    world.addComponent(player, "Player", { name: "Test", sessionId: "" });
    world.addComponent(player, "Position", { roomId: kitchen });
    saveWorld(db, world);

    world.entities.setComponent(player, "Position", { roomId: courtyard });
    saveWorld(db, world);

    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    loadSavedState(db, world2);

    const pos = world2.getComponent(player, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.courtyard);
  });

  it("content updates take effect with --fresh (no DB state)", () => {
    const world1 = makeWorld();
    populateContent(world1);
    saveWorld(db, world1);

    // Simulate --fresh: clear DB
    db.exec("DELETE FROM components");
    db.exec("DELETE FROM entities");

    // Restart with updated content
    const world2 = makeWorld();
    populateContent(world2);
    // No DB entities to load
    const count = (
      db.prepare("SELECT COUNT(*) as count FROM entities").get() as {
        count: number;
      }
    ).count;
    expect(count).toBe(0);

    // World is pure YAML baseline
    const broom2 = world2.getEntityByKey("monastery.broom")!;
    const pos = world2.getComponent(broom2, "Position") as { roomId: string };
    const courtyard2 = world2.getEntityByKey("starting.room")!;
    expect(pos.roomId).toBe(courtyard2);
  });

  it("World convenience method loadSavedState() works", () => {
    const world1 = makeWorld();
    const { kitchen } = populateContent(world1);
    const player = world1.createEntity("player.test");
    world1.addComponent(player, "Player", { name: "Test", sessionId: "" });
    world1.addComponent(player, "Position", { roomId: kitchen });
    world1.save(db);

    const world2 = makeWorld();
    const rooms2 = populateContent(world2);
    world2.loadSavedState(db);

    const pos = world2.getComponent(player, "Position") as { roomId: string };
    expect(pos.roomId).toBe(rooms2.kitchen);
  });
});
