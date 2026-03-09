import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { z } from "zod/v4";
import { createDatabase, saveWorld, loadWorld } from "../src/engine/Persistence.js";
import { World } from "../src/engine/World.js";

function makeWorld(): World {
  const world = new World();
  world.registerComponent("Position", z.object({ x: z.number(), y: z.number() }));
  world.registerComponent("Health", z.object({ current: z.number(), max: z.number() }));
  world.registerComponent("Name", z.object({ name: z.string() }));
  return world;
}

describe("Persistence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  it("save and load an empty world", () => {
    const world = makeWorld();
    saveWorld(db, world);

    const loaded = makeWorld();
    loadWorld(db, loaded);

    expect(loaded.entities.getAllEntityIds()).toEqual([]);
  });

  it("round-trips entities with and without keys and their components", () => {
    const world = makeWorld();
    const warrior = world.createEntity("warrior");
    world.addComponent(warrior, "Name", { name: "Warrior" });
    world.addComponent(warrior, "Position", { x: 1, y: 2 });
    world.addComponent(warrior, "Health", { current: 10, max: 10 });

    const rock = world.createEntity(); // no key
    world.addComponent(rock, "Name", { name: "Rock" });
    world.addComponent(rock, "Position", { x: 5, y: 5 });

    saveWorld(db, world);

    const loaded = makeWorld();
    loadWorld(db, loaded);

    // Entity IDs are preserved
    expect(loaded.entities.hasEntity(warrior)).toBe(true);
    expect(loaded.entities.hasEntity(rock)).toBe(true);

    // Key lookup works
    expect(loaded.getEntityByKey("warrior")).toBe(warrior);
    // Unkeyed entity has no key
    expect(loaded.entities.getKeyForEntity(rock)).toBeUndefined();

    // Component data matches
    expect(loaded.getComponent(warrior, "Name")).toEqual({ name: "Warrior" });
    expect(loaded.getComponent(warrior, "Position")).toEqual({ x: 1, y: 2 });
    expect(loaded.getComponent(warrior, "Health")).toEqual({ current: 10, max: 10 });
    expect(loaded.getComponent(rock, "Name")).toEqual({ name: "Rock" });
    expect(loaded.getComponent(rock, "Position")).toEqual({ x: 5, y: 5 });
    expect(loaded.getComponent(rock, "Health")).toBeUndefined();
  });

  it("second save overwrites the first", () => {
    const world = makeWorld();
    const a = world.createEntity("a");
    world.addComponent(a, "Name", { name: "Alpha" });
    saveWorld(db, world);

    // Modify: delete a, add b
    world.deleteEntity(a);
    const b = world.createEntity("b");
    world.addComponent(b, "Name", { name: "Beta" });
    world.addComponent(b, "Health", { current: 3, max: 5 });
    saveWorld(db, world);

    const loaded = makeWorld();
    loadWorld(db, loaded);

    expect(loaded.entities.hasEntity(a)).toBe(false);
    expect(loaded.getEntityByKey("a")).toBeUndefined();
    expect(loaded.entities.hasEntity(b)).toBe(true);
    expect(loaded.getComponent(b, "Name")).toEqual({ name: "Beta" });
    expect(loaded.getComponent(b, "Health")).toEqual({ current: 3, max: 5 });
  });

  it("load validates component data — corrupt JSON causes a validation error", () => {
    const world = makeWorld();
    const id = world.createEntity("test");
    world.addComponent(id, "Health", { current: 10, max: 10 });
    saveWorld(db, world);

    // Corrupt the data in the database
    db.prepare(
      "UPDATE components SET data = ? WHERE entity_id = ? AND component_type = ?"
    ).run(JSON.stringify({ current: "not-a-number", max: 10 }), id, "Health");

    const loaded = makeWorld();
    expect(() => loadWorld(db, loaded)).toThrow('Invalid data for component "Health"');
  });

  it("comprehensive round-trip with mixed entity types", () => {
    const world = makeWorld();

    // Keyed entities with various component combos
    const kitchen = world.createEntity("monastery.kitchen");
    world.addComponent(kitchen, "Name", { name: "Kitchen" });
    world.addComponent(kitchen, "Position", { x: 0, y: 0 });

    const guard = world.createEntity("guard.1");
    world.addComponent(guard, "Name", { name: "Guard" });
    world.addComponent(guard, "Position", { x: 2, y: 3 });
    world.addComponent(guard, "Health", { current: 20, max: 20 });

    // Unkeyed entities
    const arrow = world.createEntity();
    world.addComponent(arrow, "Position", { x: 10, y: 10 });

    const ghost = world.createEntity();
    world.addComponent(ghost, "Name", { name: "Ghost" });
    world.addComponent(ghost, "Health", { current: 1, max: 1 });

    saveWorld(db, world);

    const loaded = makeWorld();
    loadWorld(db, loaded);

    // Verify all entity IDs exist
    for (const id of [kitchen, guard, arrow, ghost]) {
      expect(loaded.entities.hasEntity(id)).toBe(true);
    }

    // Verify keys
    expect(loaded.getEntityByKey("monastery.kitchen")).toBe(kitchen);
    expect(loaded.getEntityByKey("guard.1")).toBe(guard);

    // Verify every component on every entity matches
    const original = world;
    for (const id of [kitchen, guard, arrow, ghost]) {
      for (const typeName of ["Position", "Health", "Name"]) {
        expect(loaded.getComponent(id, typeName)).toEqual(
          original.getComponent(id, typeName)
        );
      }
    }
  });

  it("World convenience methods save() and load() work", () => {
    const world = makeWorld();
    const id = world.createEntity("hero");
    world.addComponent(id, "Name", { name: "Hero" });
    world.save(db);

    const loaded = makeWorld();
    loaded.load(db);
    expect(loaded.getComponent(id, "Name")).toEqual({ name: "Hero" });
    expect(loaded.getEntityByKey("hero")).toBe(id);
  });
});
