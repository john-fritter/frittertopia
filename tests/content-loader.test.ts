import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod/v4";
import { World } from "../src/engine/World.js";
import {
  loadContentFromString,
  loadContentFromStrings,
  loadContentFromDirectory,
} from "../src/engine/ContentLoader.js";

function makeWorld(): World {
  const world = new World();
  world.registerComponent(
    "Room",
    z.object({ name: z.string() })
  );
  world.registerComponent(
    "Description",
    z.object({
      short: z.string(),
      long: z.string().optional(),
      blocks: z.array(z.any()).optional(),
    })
  );
  world.registerComponent(
    "Position",
    z.object({ roomId: z.string() }),
    ["roomId"]
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

describe("ContentLoader", () => {
  it("loads a simple entity with key and components", () => {
    const world = makeWorld();
    loadContentFromString(
      `
entities:
  - key: test.room
    components:
      Room:
        name: "Test Room"
      Description:
        short: "a test room"
        long: "A plain room for testing."
`,
      world
    );

    const id = world.getEntityByKey("test.room");
    expect(id).toBeDefined();
    expect(world.getComponent(id!, "Room")).toEqual({ name: "Test Room" });
    expect(world.getComponent(id!, "Description")).toEqual({
      short: "a test room",
      long: "A plain room for testing.",
    });
  });

  it("resolves entity references in component data", () => {
    const world = makeWorld();
    loadContentFromString(
      `
entities:
  - key: room.a
    components:
      Room:
        name: "Room A"
      Description:
        short: "room a"
        long: "Room A."
      Exits:
        exits:
          north: room.b
  - key: room.b
    components:
      Room:
        name: "Room B"
      Description:
        short: "room b"
        long: "Room B."
      Exits:
        exits:
          south: room.a
`,
      world
    );

    const idA = world.getEntityByKey("room.a")!;
    const idB = world.getEntityByKey("room.b")!;

    const exitsA = world.getComponent(idA, "Exits") as {
      exits: Record<string, string>;
    };
    expect(exitsA.exits["north"]).toBe(idB);

    const exitsB = world.getComponent(idB, "Exits") as {
      exits: Record<string, string>;
    };
    expect(exitsB.exits["south"]).toBe(idA);
  });

  it("resolves direct field references (Position.roomId)", () => {
    const world = makeWorld();
    loadContentFromString(
      `
entities:
  - key: my.room
    components:
      Room:
        name: "A Room"
      Description:
        short: "a room"
        long: "A room."
  - components:
      Position:
        roomId: my.room
      Presence:
        description: "Something is here."
`,
      world
    );

    const roomId = world.getEntityByKey("my.room")!;
    const entities = world.getEntitiesWithComponent("Position");
    expect(entities).toHaveLength(1);
    const pos = world.getComponent(entities[0]!, "Position") as {
      roomId: string;
    };
    expect(pos.roomId).toBe(roomId);
  });

  it("throws on invalid component data with clear error", () => {
    const world = makeWorld();
    expect(() =>
      loadContentFromString(
        `
entities:
  - key: bad.room
    components:
      Room:
        name: 42
`,
        world,
        "bad-file.yaml"
      )
    ).toThrow(/bad\.room.*bad-file\.yaml/);
  });

  it("throws on unresolved entity reference", () => {
    const world = makeWorld();
    expect(() =>
      loadContentFromString(
        `
entities:
  - key: lonely.room
    components:
      Room:
        name: "Lonely"
      Description:
        short: "lonely"
        long: "Lonely."
      Exits:
        exits:
          north: nonexistent.room
`,
        world
      )
    ).toThrow(/nonexistent\.room/);
  });

  it("throws on duplicate keys", () => {
    const world = makeWorld();
    expect(() =>
      loadContentFromString(
        `
entities:
  - key: dup.room
    components:
      Room:
        name: "First"
      Description:
        short: "first"
        long: "First."
  - key: dup.room
    components:
      Room:
        name: "Second"
      Description:
        short: "second"
        long: "Second."
`,
        world
      )
    ).toThrow(/dup\.room.*already in use/);
  });

  it("loads multiple files with cross-file references", () => {
    const world = makeWorld();
    loadContentFromStrings(
      [
        {
          name: "rooms.yaml",
          yaml: `
entities:
  - key: cross.room
    components:
      Room:
        name: "Cross Room"
      Description:
        short: "a room"
        long: "A room."
`,
        },
        {
          name: "items.yaml",
          yaml: `
entities:
  - components:
      Position:
        roomId: cross.room
      Presence:
        description: "An item is here."
`,
        },
      ],
      world
    );

    const roomId = world.getEntityByKey("cross.room")!;
    const items = world.getEntitiesWithComponent("Presence");
    expect(items).toHaveLength(1);
    const pos = world.getComponent(items[0]!, "Position") as {
      roomId: string;
    };
    expect(pos.roomId).toBe(roomId);
  });

  describe("directory loading", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "content-test-"));
      fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("recursively finds and loads all YAML files", () => {
      fs.writeFileSync(
        path.join(tmpDir, "rooms.yaml"),
        `
entities:
  - key: dir.room
    components:
      Room:
        name: "Dir Room"
      Description:
        short: "a dir room"
        long: "A directory room."
`
      );
      fs.writeFileSync(
        path.join(tmpDir, "sub", "items.yml"),
        `
entities:
  - components:
      Position:
        roomId: dir.room
      Presence:
        description: "Found in a subdirectory."
`
      );

      const world = makeWorld();
      loadContentFromDirectory(tmpDir, world);

      const roomId = world.getEntityByKey("dir.room")!;
      expect(roomId).toBeDefined();

      const items = world.getEntitiesWithComponent("Presence");
      expect(items).toHaveLength(1);
      const pos = world.getComponent(items[0]!, "Position") as {
        roomId: string;
      };
      expect(pos.roomId).toBe(roomId);
    });
  });
});
