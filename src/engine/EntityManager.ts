import { v4 as uuidv4 } from "uuid";
import type { ComponentRegistry } from "./ComponentRegistry.js";

export class EntityManager {
  private components = new Map<string, Map<string, Record<string, unknown>>>();
  private entities = new Set<string>();
  private keyToId = new Map<string, string>();
  private idToKey = new Map<string, string>();

  constructor(private registry: ComponentRegistry) {}

  createEntity(key?: string): string {
    const id = uuidv4();
    this.entities.add(id);
    if (key !== undefined) {
      if (this.keyToId.has(key)) {
        throw new Error(`Entity key "${key}" is already in use`);
      }
      this.keyToId.set(key, id);
      this.idToKey.set(id, key);
    }
    return id;
  }

  createEntityWithId(id: string, key?: string): string {
    if (this.entities.has(id)) {
      throw new Error(`Entity "${id}" already exists`);
    }
    this.entities.add(id);
    if (key !== undefined) {
      if (this.keyToId.has(key)) {
        throw new Error(`Entity key "${key}" is already in use`);
      }
      this.keyToId.set(key, id);
      this.idToKey.set(id, key);
    }
    return id;
  }

  deleteEntity(id: string): void {
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    const key = this.idToKey.get(id);
    if (key !== undefined) {
      this.keyToId.delete(key);
      this.idToKey.delete(id);
    }
    for (const [, entityMap] of this.components) {
      entityMap.delete(id);
    }
  }

  getEntityByKey(key: string): string | undefined {
    return this.keyToId.get(key);
  }

  hasEntity(id: string): boolean {
    return this.entities.has(id);
  }

  addComponent(entityId: string, typeName: string, data: Record<string, unknown>): void {
    if (!this.entities.has(entityId)) {
      throw new Error(`Entity "${entityId}" does not exist`);
    }
    const validated = this.registry.validate(typeName, data);
    let entityMap = this.components.get(typeName);
    if (!entityMap) {
      entityMap = new Map();
      this.components.set(typeName, entityMap);
    }
    entityMap.set(entityId, validated);
  }

  setComponent(entityId: string, typeName: string, data: Record<string, unknown>): void {
    if (!this.entities.has(entityId)) {
      throw new Error(`Entity "${entityId}" does not exist`);
    }
    let entityMap = this.components.get(typeName);
    if (!entityMap) {
      entityMap = new Map();
      this.components.set(typeName, entityMap);
    }
    entityMap.set(entityId, data);
  }

  getComponent(entityId: string, typeName: string): Record<string, unknown> | undefined {
    return this.components.get(typeName)?.get(entityId);
  }

  removeComponent(entityId: string, typeName: string): void {
    this.components.get(typeName)?.delete(entityId);
  }

  getEntitiesWithComponent(typeName: string): string[] {
    const entityMap = this.components.get(typeName);
    if (!entityMap) return [];
    return [...entityMap.keys()].filter((id) => this.entities.has(id));
  }

  getEntitiesWithComponents(typeNames: string[]): string[] {
    if (typeNames.length === 0) return [];
    const sets = typeNames.map((t) => new Set(this.getEntitiesWithComponent(t)));
    const smallest = sets.reduce((a, b) => (a.size <= b.size ? a : b));
    return [...smallest].filter((id) => sets.every((s) => s.has(id)));
  }

  getKeyForEntity(entityId: string): string | undefined {
    return this.idToKey.get(entityId);
  }

  getComponentsForEntity(entityId: string): [string, Record<string, unknown>][] {
    const result: [string, Record<string, unknown>][] = [];
    for (const [typeName, entityMap] of this.components) {
      const data = entityMap.get(entityId);
      if (data) {
        result.push([typeName, data]);
      }
    }
    return result;
  }

  getAllEntityIds(): string[] {
    return [...this.entities];
  }
}
