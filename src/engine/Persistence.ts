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
        insertComponent.run(id, typeName, JSON.stringify(data));
      }
    }
  });
  transaction();
}

export function loadWorld(db: Database.Database, world: World): void {
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

  for (const row of entities) {
    world.createEntityWithId(row.id, row.key ?? undefined);
  }

  for (const row of components) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    world.addComponent(row.entity_id, row.component_type, data);
  }
}
