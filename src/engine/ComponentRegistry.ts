import type { z } from "zod/v4";

export type ComponentSchema = z.ZodType<Record<string, unknown>>;

export class ComponentRegistry {
  private schemas = new Map<string, ComponentSchema>();

  register(name: string, schema: ComponentSchema): void {
    if (this.schemas.has(name)) {
      throw new Error(`Component type "${name}" is already registered`);
    }
    this.schemas.set(name, schema);
  }

  get(name: string): ComponentSchema {
    const schema = this.schemas.get(name);
    if (!schema) {
      throw new Error(`Component type "${name}" is not registered`);
    }
    return schema;
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  validate(name: string, data: unknown): Record<string, unknown> {
    const schema = this.get(name);
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `Invalid data for component "${name}": ${result.error.message}`
      );
    }
    return result.data;
  }
}
