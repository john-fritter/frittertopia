import type { z } from "zod/v4";

export type EventSchema = z.ZodType;

type Handler = (payload: unknown) => void;

interface QueuedEvent {
  type: string;
  payload: unknown;
}

export class EventBus {
  private schemas = new Map<string, EventSchema>();
  private handlers = new Map<string, Handler[]>();
  private queue: QueuedEvent[] = [];

  registerEvent(name: string, schema: EventSchema): void {
    if (this.schemas.has(name)) {
      throw new Error(`Event type "${name}" is already registered`);
    }
    this.schemas.set(name, schema);
  }

  subscribe(eventType: string, handler: Handler): () => void {
    if (!this.schemas.has(eventType)) {
      throw new Error(`Event type "${eventType}" is not registered`);
    }
    let list = this.handlers.get(eventType);
    if (!list) {
      list = [];
      this.handlers.set(eventType, list);
    }
    list.push(handler);
    return () => {
      const arr = this.handlers.get(eventType);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  emit(eventType: string, payload: unknown): void {
    const schema = this.schemas.get(eventType);
    if (!schema) {
      throw new Error(`Event type "${eventType}" is not registered`);
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new Error(
        `Invalid payload for event "${eventType}": ${result.error.message}`
      );
    }
    this.queue.push({ type: eventType, payload: result.data });
  }

  processQueue(): void {
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      const list = this.handlers.get(event.type);
      if (list) {
        for (const handler of list) {
          handler(event.payload);
        }
      }
    }
  }
}
