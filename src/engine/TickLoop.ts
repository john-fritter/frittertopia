import type { EntityManager } from "./EntityManager.js";
import type { EventBus } from "./EventBus.js";

export type SystemFn = (entities: EntityManager, events: EventBus) => void;

export class TickLoop {
  private systems: SystemFn[];
  private tickCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    systems: SystemFn[],
    private entities: EntityManager,
    private events: EventBus,
    private intervalMs: number = 250
  ) {
    this.systems = systems;
  }

  tick(): void {
    for (const system of this.systems) {
      system(this.entities, this.events);
    }
    this.events.processQueue();
    this.tickCount++;
  }

  run(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTickCount(): number {
    return this.tickCount;
  }
}
