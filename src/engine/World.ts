import type Database from "better-sqlite3";
import type { z } from "zod/v4";
import { ComponentRegistry, type ComponentSchema } from "./ComponentRegistry.js";
import { EntityManager } from "./EntityManager.js";
import { EventBus, type EventSchema } from "./EventBus.js";
import { saveWorld, loadWorld } from "./Persistence.js";
import { TickLoop, type SystemFn } from "./TickLoop.js";

export class World {
  readonly componentRegistry: ComponentRegistry;
  readonly entities: EntityManager;
  readonly events: EventBus;
  private systems: SystemFn[] = [];
  private tickLoop: TickLoop;

  constructor(options?: { tickInterval?: number }) {
    this.componentRegistry = new ComponentRegistry();
    this.entities = new EntityManager(this.componentRegistry);
    this.events = new EventBus();
    this.tickLoop = new TickLoop(
      this.systems,
      this.entities,
      this.events,
      options?.tickInterval
    );
  }

  registerComponent(name: string, schema: ComponentSchema): void {
    this.componentRegistry.register(name, schema);
  }

  createEntity(key?: string): string {
    return this.entities.createEntity(key);
  }

  createEntityWithId(id: string, key?: string): string {
    return this.entities.createEntityWithId(id, key);
  }

  deleteEntity(id: string): void {
    this.entities.deleteEntity(id);
  }

  addComponent(entityId: string, typeName: string, data: Record<string, unknown>): void {
    this.entities.addComponent(entityId, typeName, data);
  }

  setComponent(entityId: string, typeName: string, data: Record<string, unknown>): void {
    this.entities.setComponent(entityId, typeName, data);
  }

  getComponent(entityId: string, typeName: string): Record<string, unknown> | undefined {
    return this.entities.getComponent(entityId, typeName);
  }

  removeComponent(entityId: string, typeName: string): void {
    this.entities.removeComponent(entityId, typeName);
  }

  getEntitiesWithComponent(typeName: string): string[] {
    return this.entities.getEntitiesWithComponent(typeName);
  }

  getEntitiesWithComponents(typeNames: string[]): string[] {
    return this.entities.getEntitiesWithComponents(typeNames);
  }

  getEntityByKey(key: string): string | undefined {
    return this.entities.getEntityByKey(key);
  }

  registerEvent(name: string, schema: EventSchema): void {
    this.events.registerEvent(name, schema);
  }

  onEvent(eventType: string, handler: (payload: unknown) => void): () => void {
    return this.events.subscribe(eventType, handler);
  }

  emit(eventType: string, payload: unknown): void {
    this.events.emit(eventType, payload);
  }

  addSystem(system: SystemFn): void {
    this.systems.push(system);
  }

  tick(): void {
    this.tickLoop.tick();
  }

  run(): void {
    this.tickLoop.run();
  }

  stop(): void {
    this.tickLoop.stop();
  }

  getTickCount(): number {
    return this.tickLoop.getTickCount();
  }

  save(db: Database.Database): void {
    saveWorld(db, this);
  }

  load(db: Database.Database): void {
    loadWorld(db, this);
  }
}
