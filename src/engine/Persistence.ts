import Database from "better-sqlite3";
import type { World } from "./World.js";

export function createDatabase(filepath: string): Database.Database {
  const db = new Database(filepath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS components (
      entity_id TEXT NOT NULL,
      component_type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (entity_id, component_type),
      FOREIGN KEY (entity_id) REFERENCES entities(id)
    );
  `);
  return db;
}

// Components that hold transient runtime state and must not be persisted.
// These are excluded from both save and load — the YAML baseline or the
// runtime system is always the authoritative source.
const TRANSIENT_COMPONENTS = new Set(["WeatherState", "WeatherZoneRef"]);

export function saveWorld(db: Database.Database, world: World): void {
  const transaction = db.transaction(() => {
    db.exec("DELETE FROM components");
    db.exec("DELETE FROM entities");

    const insertEntity = db.prepare(
      "INSERT INTO entities (id, key) VALUES (?, ?)"
    );
    const insertComponent = db.prepare(
      "INSERT INTO components (entity_id, component_type, data) VALUES (?, ?, ?)"
    );

    for (const id of world.entities.getAllEntityIds()) {
      const key = world.entities.getKeyForEntity(id) ?? null;
      insertEntity.run(id, key);

      for (const [typeName, data] of world.entities.getComponentsForEntity(id)) {
        if (TRANSIENT_COMPONENTS.has(typeName)) continue;
        const serialized = translateForSave(typeName, data, world);
        insertComponent.run(id, typeName, JSON.stringify(serialized));
      }
    }
  });
  transaction();
}

export function loadSavedState(
  db: Database.Database,
  world: World,
  startingRoomKey = "starting.room"
): void {
  const entities = db.prepare("SELECT id, key FROM entities").all() as Array<{
    id: string;
    key: string | null;
  }>;
  const components = db
    .prepare("SELECT entity_id, component_type, data FROM components")
    .all() as Array<{
    entity_id: string;
    component_type: string;
    data: string;
  }>;

  // Group components by entity ID for merge logic
  const componentsByEntity = new Map<
    string,
    Array<{ component_type: string; data: string }>
  >();
  for (const row of components) {
    let list = componentsByEntity.get(row.entity_id);
    if (!list) {
      list = [];
      componentsByEntity.set(row.entity_id, list);
    }
    list.push({ component_type: row.component_type, data: row.data });
  }

  for (const row of entities) {
    const existingId = row.key
      ? world.entities.getEntityByKey(row.key)
      : undefined;
    const comps = componentsByEntity.get(row.id) ?? [];

    if (existingId) {
      // Content entity — merge DB state onto YAML baseline.
      // DB wins per-component: only overwrite components that were saved.
      for (const comp of comps) {
        if (TRANSIENT_COMPONENTS.has(comp.component_type)) continue;
        const data = JSON.parse(comp.data) as Record<string, unknown>;
        const resolved = translateForLoad(comp.component_type, data, world);
        world.entities.setComponent(existingId, comp.component_type, resolved);
      }
    } else {
      // Entity exists in DB but not in YAML.
      const hasPlayer = comps.some((c) => c.component_type === "Player");
      if (!hasPlayer) {
        // Orphaned content entity — YAML no longer defines it.
        if (row.key) {
          console.warn(
            `Warning: Saved state for "${row.key}" but it no longer exists in content. Discarding.`
          );
        }
        continue;
      }

      // Player entity — create it
      world.createEntityWithId(row.id, row.key ?? undefined);
      for (const comp of comps) {
        if (TRANSIENT_COMPONENTS.has(comp.component_type)) continue;
        const data = JSON.parse(comp.data) as Record<string, unknown>;
        const resolved = translateForLoad(comp.component_type, data, world);
        world.addComponent(row.id, comp.component_type, resolved);
      }
    }
  }

  // Validate player positions — fix orphaned references
  const playerIds = world.entities.getEntitiesWithComponent("Player");
  for (const id of playerIds) {
    const position = world.entities.getComponent(id, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) continue;

    if (!world.entities.hasEntity(position.roomId)) {
      const player = world.entities.getComponent(id, "Player") as {
        name: string;
      };
      const startingRoom = world.entities.getEntityByKey(startingRoomKey);
      if (startingRoom) {
        world.entities.setComponent(id, "Position", { roomId: startingRoom });
        console.warn(
          `Warning: Player "${player.name}" was in a room that no longer exists. Moved to starting room.`
        );
      } else {
        world.entities.removeComponent(id, "Position");
        console.warn(
          `Warning: Player "${player.name}" was in a room that no longer exists and no starting room found. Position removed.`
        );
      }
    }

    // Also validate VisitedRooms
    const visited = world.entities.getComponent(id, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    if (visited) {
      const validRooms = visited.rooms.filter((roomId) =>
        world.entities.hasEntity(roomId)
      );
      if (validRooms.length !== visited.rooms.length) {
        world.entities.setComponent(id, "VisitedRooms", { rooms: validRooms });
      }
    }
  }
}

export function deleteEntityData(
  db: Database.Database,
  entityId: string
): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM components WHERE entity_id = ?").run(entityId);
    db.prepare("DELETE FROM entities WHERE id = ?").run(entityId);
  });
  transaction();
}

// Backward-compatible aliases
export const loadRuntimeState = loadSavedState;
export function loadWorld(db: Database.Database, world: World): void {
  loadSavedState(db, world);
}

/** On save: translate UUIDs to entity keys for all ref-annotated fields. */
function translateForSave(
  typeName: string,
  data: Record<string, unknown>,
  world: World
): Record<string, unknown> {
  const refs = world.componentRegistry.getRefs(typeName);
  if (refs.length === 0) return data;

  const result = { ...data };
  for (const refPath of refs) {
    if (refPath.endsWith(".*")) {
      const fieldName = refPath.slice(0, -2);
      const record = result[fieldName];
      if (record && typeof record === "object" && !Array.isArray(record)) {
        const translated: Record<string, string> = {};
        for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
          if (typeof v === "string") {
            translated[k] = world.entities.getKeyForEntity(v) ?? v;
          }
        }
        result[fieldName] = translated;
      }
    } else if (refPath.endsWith("[]")) {
      const fieldName = refPath.slice(0, -2);
      const arr = result[fieldName];
      if (Array.isArray(arr)) {
        result[fieldName] = arr.map((v) =>
          typeof v === "string" ? (world.entities.getKeyForEntity(v) ?? v) : v
        );
      }
    } else {
      const v = result[refPath];
      if (typeof v === "string") {
        result[refPath] = world.entities.getKeyForEntity(v) ?? v;
      }
    }
  }
  return result;
}

/** On load: translate entity keys back to current UUIDs for all ref-annotated fields. */
function translateForLoad(
  typeName: string,
  data: Record<string, unknown>,
  world: World
): Record<string, unknown> {
  const refs = world.componentRegistry.getRefs(typeName);
  if (refs.length === 0) return data;

  const result = { ...data };
  for (const refPath of refs) {
    if (refPath.endsWith(".*")) {
      const fieldName = refPath.slice(0, -2);
      const record = result[fieldName];
      if (record && typeof record === "object" && !Array.isArray(record)) {
        const translated: Record<string, string> = {};
        for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
          if (typeof v === "string") {
            translated[k] = world.entities.getEntityByKey(v) ?? v;
          }
        }
        result[fieldName] = translated;
      }
    } else if (refPath.endsWith("[]")) {
      const fieldName = refPath.slice(0, -2);
      const arr = result[fieldName];
      if (Array.isArray(arr)) {
        result[fieldName] = arr.map((v) =>
          typeof v === "string" ? (world.entities.getEntityByKey(v) ?? v) : v
        );
      }
    } else {
      const v = result[refPath];
      if (typeof v === "string") {
        result[refPath] = world.entities.getEntityByKey(v) ?? v;
      }
    }
  }
  return result;
}
