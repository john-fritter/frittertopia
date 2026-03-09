import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { ComponentRegistry } from "../src/engine/ComponentRegistry.js";
import { EntityManager } from "../src/engine/EntityManager.js";
import { EventBus } from "../src/engine/EventBus.js";
import { TickLoop } from "../src/engine/TickLoop.js";
import { World } from "../src/engine/World.js";

// ---------- ComponentRegistry ----------

describe("ComponentRegistry", () => {
  it("registers and retrieves a component schema", () => {
    const reg = new ComponentRegistry();
    const schema = z.object({ x: z.number() });
    reg.register("Position", schema);
    expect(reg.has("Position")).toBe(true);
    expect(reg.get("Position")).toBe(schema);
  });

  it("throws on duplicate registration", () => {
    const reg = new ComponentRegistry();
    reg.register("Foo", z.object({ a: z.number() }));
    expect(() => reg.register("Foo", z.object({ b: z.string() }))).toThrow(
      'already registered'
    );
  });

  it("throws when getting an unregistered component", () => {
    const reg = new ComponentRegistry();
    expect(() => reg.get("Nope")).toThrow('not registered');
  });

  it("validates correct data", () => {
    const reg = new ComponentRegistry();
    reg.register("Health", z.object({ current: z.number(), max: z.number() }));
    const result = reg.validate("Health", { current: 10, max: 20 });
    expect(result).toEqual({ current: 10, max: 20 });
  });

  it("rejects invalid data with a clear error", () => {
    const reg = new ComponentRegistry();
    reg.register("Health", z.object({ current: z.number(), max: z.number() }));
    expect(() => reg.validate("Health", { current: "not a number", max: 20 })).toThrow(
      'Invalid data for component "Health"'
    );
  });
});

// ---------- EntityManager ----------

describe("EntityManager", () => {
  function setup() {
    const reg = new ComponentRegistry();
    reg.register("Position", z.object({ x: z.number(), y: z.number() }));
    reg.register("Name", z.object({ name: z.string() }));
    return new EntityManager(reg);
  }

  it("creates entities with unique UUIDs", () => {
    const em = setup();
    const a = em.createEntity();
    const b = em.createEntity();
    expect(a).not.toBe(b);
    expect(em.hasEntity(a)).toBe(true);
    expect(em.hasEntity(b)).toBe(true);
  });

  it("creates entities with key lookup", () => {
    const em = setup();
    const id = em.createEntity("monastery.kitchen");
    expect(em.getEntityByKey("monastery.kitchen")).toBe(id);
  });

  it("throws on duplicate key", () => {
    const em = setup();
    em.createEntity("room.a");
    expect(() => em.createEntity("room.a")).toThrow('already in use');
  });

  it("adds and gets components", () => {
    const em = setup();
    const id = em.createEntity();
    em.addComponent(id, "Position", { x: 1, y: 2 });
    expect(em.getComponent(id, "Position")).toEqual({ x: 1, y: 2 });
  });

  it("rejects invalid component data", () => {
    const em = setup();
    const id = em.createEntity();
    expect(() =>
      em.addComponent(id, "Position", { x: "bad", y: 2 })
    ).toThrow('Invalid data for component "Position"');
  });

  it("throws when adding component to nonexistent entity", () => {
    const em = setup();
    expect(() =>
      em.addComponent("fake-id", "Position", { x: 0, y: 0 })
    ).toThrow('does not exist');
  });

  it("removes components", () => {
    const em = setup();
    const id = em.createEntity();
    em.addComponent(id, "Position", { x: 1, y: 2 });
    em.removeComponent(id, "Position");
    expect(em.getComponent(id, "Position")).toBeUndefined();
  });

  it("enforces singleton components (overwrites)", () => {
    const em = setup();
    const id = em.createEntity();
    em.addComponent(id, "Position", { x: 1, y: 2 });
    em.addComponent(id, "Position", { x: 3, y: 4 });
    expect(em.getComponent(id, "Position")).toEqual({ x: 3, y: 4 });
  });

  it("queries entities by component type", () => {
    const em = setup();
    const a = em.createEntity();
    const b = em.createEntity();
    em.addComponent(a, "Position", { x: 0, y: 0 });
    em.addComponent(b, "Name", { name: "Bob" });
    expect(em.getEntitiesWithComponent("Position")).toEqual([a]);
    expect(em.getEntitiesWithComponent("Name")).toEqual([b]);
  });

  it("queries entities by multiple component types", () => {
    const em = setup();
    const a = em.createEntity();
    const b = em.createEntity();
    em.addComponent(a, "Position", { x: 0, y: 0 });
    em.addComponent(a, "Name", { name: "Alice" });
    em.addComponent(b, "Position", { x: 1, y: 1 });

    const both = em.getEntitiesWithComponents(["Position", "Name"]);
    expect(both).toEqual([a]);
  });

  it("creates entities with a specific ID via createEntityWithId", () => {
    const em = setup();
    const id = em.createEntityWithId("my-custom-id", "room.b");
    expect(id).toBe("my-custom-id");
    expect(em.hasEntity("my-custom-id")).toBe(true);
    expect(em.getEntityByKey("room.b")).toBe("my-custom-id");
  });

  it("throws on duplicate ID in createEntityWithId", () => {
    const em = setup();
    em.createEntityWithId("dup-id");
    expect(() => em.createEntityWithId("dup-id")).toThrow("already exists");
  });

  it("setComponent writes without validation", () => {
    const em = setup();
    const id = em.createEntity();
    // This data is invalid for the Position schema (strings instead of numbers)
    // but setComponent should accept it without complaint
    em.setComponent(id, "Position", { x: "not-a-number", y: "also-bad" } as any);
    expect(em.getComponent(id, "Position")).toEqual({ x: "not-a-number", y: "also-bad" });
  });

  it("setComponent throws for nonexistent entity", () => {
    const em = setup();
    expect(() => em.setComponent("fake", "Position", { x: 0, y: 0 })).toThrow("does not exist");
  });

  it("deletes entities and cleans up components", () => {
    const em = setup();
    const id = em.createEntity("room.a");
    em.addComponent(id, "Position", { x: 0, y: 0 });
    em.deleteEntity(id);

    expect(em.hasEntity(id)).toBe(false);
    expect(em.getEntityByKey("room.a")).toBeUndefined();
    expect(em.getComponent(id, "Position")).toBeUndefined();
    expect(em.getEntitiesWithComponent("Position")).toEqual([]);
  });
});

// ---------- EventBus ----------

describe("EventBus", () => {
  it("registers events and emits with valid payloads", () => {
    const bus = new EventBus();
    bus.registerEvent("damage", z.object({ amount: z.number() }));
    const received: unknown[] = [];
    bus.subscribe("damage", (p) => received.push(p));
    bus.emit("damage", { amount: 5 });
    bus.processQueue();
    expect(received).toEqual([{ amount: 5 }]);
  });

  it("rejects invalid event payloads", () => {
    const bus = new EventBus();
    bus.registerEvent("damage", z.object({ amount: z.number() }));
    expect(() => bus.emit("damage", { amount: "not a number" })).toThrow(
      'Invalid payload for event "damage"'
    );
  });

  it("throws when emitting unregistered event", () => {
    const bus = new EventBus();
    expect(() => bus.emit("nope", {})).toThrow('not registered');
  });

  it("throws when subscribing to unregistered event", () => {
    const bus = new EventBus();
    expect(() => bus.subscribe("nope", () => {})).toThrow('not registered');
  });

  it("calls handlers in subscription order", () => {
    const bus = new EventBus();
    bus.registerEvent("tick", z.object({}));
    const order: number[] = [];
    bus.subscribe("tick", () => order.push(1));
    bus.subscribe("tick", () => order.push(2));
    bus.subscribe("tick", () => order.push(3));
    bus.emit("tick", {});
    bus.processQueue();
    expect(order).toEqual([1, 2, 3]);
  });

  it("supports unsubscribing", () => {
    const bus = new EventBus();
    bus.registerEvent("ping", z.object({}));
    const calls: string[] = [];
    const unsub = bus.subscribe("ping", () => calls.push("handler"));
    bus.emit("ping", {});
    bus.processQueue();
    expect(calls).toEqual(["handler"]);

    unsub();
    bus.emit("ping", {});
    bus.processQueue();
    expect(calls).toEqual(["handler"]); // not called again
  });

  it("throws on duplicate event registration", () => {
    const bus = new EventBus();
    bus.registerEvent("foo", z.object({}));
    expect(() => bus.registerEvent("foo", z.object({}))).toThrow('already registered');
  });
});

// ---------- TickLoop ----------

describe("TickLoop", () => {
  it("runs systems in order and tracks tick count", () => {
    const reg = new ComponentRegistry();
    const em = new EntityManager(reg);
    const bus = new EventBus();
    const order: number[] = [];

    const systems = [
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    ];
    const loop = new TickLoop(systems, em, bus);

    loop.tick();
    expect(order).toEqual([1, 2, 3]);
    expect(loop.getTickCount()).toBe(1);

    loop.tick();
    expect(order).toEqual([1, 2, 3, 1, 2, 3]);
    expect(loop.getTickCount()).toBe(2);
  });

  it("processes events emitted by systems within the same tick", () => {
    const reg = new ComponentRegistry();
    const em = new EntityManager(reg);
    const bus = new EventBus();
    bus.registerEvent("hello", z.object({ msg: z.string() }));

    const received: string[] = [];
    bus.subscribe("hello", (p) => received.push((p as { msg: string }).msg));

    const systems = [
      (_e: EntityManager, ev: EventBus) => ev.emit("hello", { msg: "world" }),
    ];
    const loop = new TickLoop(systems, em, bus);
    loop.tick();

    expect(received).toEqual(["world"]);
  });

  it("run() and stop() control the interval", async () => {
    const reg = new ComponentRegistry();
    const em = new EntityManager(reg);
    const bus = new EventBus();
    const loop = new TickLoop([], em, bus, 50);

    loop.run();
    await new Promise((r) => setTimeout(r, 180));
    loop.stop();

    expect(loop.getTickCount()).toBeGreaterThanOrEqual(2);
  });
});

// ---------- World ----------

describe("World", () => {
  it("provides a clean API surface", () => {
    const world = new World();
    world.registerComponent("Position", z.object({ x: z.number(), y: z.number() }));
    const id = world.createEntity("player");
    world.addComponent(id, "Position", { x: 0, y: 0 });

    expect(world.getEntityByKey("player")).toBe(id);
    expect(world.getComponent(id, "Position")).toEqual({ x: 0, y: 0 });
    expect(world.getEntitiesWithComponent("Position")).toEqual([id]);

    world.removeComponent(id, "Position");
    expect(world.getComponent(id, "Position")).toBeUndefined();

    world.deleteEntity(id);
  });

  it("integrates events through the world API", () => {
    const world = new World();
    world.registerEvent("shout", z.object({ text: z.string() }));
    const heard: string[] = [];
    const unsub = world.onEvent("shout", (p) => heard.push((p as { text: string }).text));
    world.emit("shout", { text: "hello" });
    world.tick();
    expect(heard).toEqual(["hello"]);

    unsub();
    world.emit("shout", { text: "again" });
    world.tick();
    expect(heard).toEqual(["hello"]);
  });

  it("runs systems added via addSystem", () => {
    const world = new World();
    const calls: number[] = [];
    world.addSystem(() => calls.push(1));
    world.addSystem(() => calls.push(2));
    world.tick();
    expect(calls).toEqual([1, 2]);
    expect(world.getTickCount()).toBe(1);
  });
});

// ---------- Integration Test ----------

describe("Integration: Health drain system", () => {
  it("decrements health each tick for all entities with Health", () => {
    const world = new World();

    world.registerComponent("Position", z.object({ x: z.number(), y: z.number() }));
    world.registerComponent("Health", z.object({ current: z.number(), max: z.number() }));
    world.registerComponent("Name", z.object({ name: z.string() }));

    const warrior = world.createEntity("warrior");
    world.addComponent(warrior, "Name", { name: "Warrior" });
    world.addComponent(warrior, "Position", { x: 0, y: 0 });
    world.addComponent(warrior, "Health", { current: 10, max: 10 });

    const mage = world.createEntity("mage");
    world.addComponent(mage, "Name", { name: "Mage" });
    world.addComponent(mage, "Health", { current: 5, max: 5 });

    // Entity without Health — should be unaffected
    const rock = world.createEntity("rock");
    world.addComponent(rock, "Name", { name: "Rock" });
    world.addComponent(rock, "Position", { x: 3, y: 3 });

    // System: drain 1 HP per tick — uses setComponent (fast path, no validation)
    world.addSystem((entities) => {
      for (const id of entities.getEntitiesWithComponent("Health")) {
        const health = entities.getComponent(id, "Health") as { current: number; max: number };
        entities.setComponent(id, "Health", {
          current: health.current - 1,
          max: health.max,
        });
      }
    });

    // Run 3 ticks
    world.tick();
    world.tick();
    world.tick();

    expect(world.getTickCount()).toBe(3);
    expect(world.getComponent(warrior, "Health")).toEqual({ current: 7, max: 10 });
    expect(world.getComponent(mage, "Health")).toEqual({ current: 2, max: 5 });
    // Rock should still have no Health component
    expect(world.getComponent(rock, "Health")).toBeUndefined();
    // Rock still has its other components
    expect(world.getComponent(rock, "Name")).toEqual({ name: "Rock" });
    expect(world.getComponent(rock, "Position")).toEqual({ x: 3, y: 3 });
  });
});
