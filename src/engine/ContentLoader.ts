import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import type { World } from "./World.js";

const EntityDefSchema = z.object({
  key: z.string().optional(),
  components: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const ContentFileSchema = z.object({
  entities: z.array(EntityDefSchema),
});

type EntityDef = z.infer<typeof EntityDefSchema>;

interface ParsedFile {
  filePath: string;
  entities: EntityDef[];
}

export function loadContentFromString(
  yamlText: string,
  world: World,
  sourceName = "<string>"
): void {
  const parsed = parseYamlContent(yamlText, sourceName);
  applyContent([parsed], world);
}

export function loadContentFromStrings(
  sources: Array<{ yaml: string; name: string }>,
  world: World
): void {
  const parsed = sources.map((s) => parseYamlContent(s.yaml, s.name));
  applyContent(parsed, world);
}

export function loadContentFromDirectory(dirPath: string, world: World): void {
  const files = findYamlFiles(dirPath);
  if (files.length === 0) return;

  const parsed = files.map((filePath) => {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseYamlContent(content, filePath);
  });

  applyContent(parsed, world);
}

function parseYamlContent(yamlText: string, sourceName: string): ParsedFile {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(
      `Failed to parse YAML in "${sourceName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const result = ContentFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid content structure in "${sourceName}": ${result.error.message}`
    );
  }

  return { filePath: sourceName, entities: result.data.entities };
}

function applyContent(files: ParsedFile[], world: World): void {
  // First pass: create all entities so keys are available for reference resolution
  const entityIds: Array<{ id: string; def: EntityDef; source: string }> = [];

  for (const file of files) {
    for (let i = 0; i < file.entities.length; i++) {
      const def = file.entities[i]!;
      const entityLabel = def.key ?? `entity[${i}]`;

      try {
        const id = world.createEntity(def.key);
        entityIds.push({ id, def, source: file.filePath });
      } catch (err) {
        throw new Error(
          `Error creating entity "${entityLabel}" in "${file.filePath}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Second pass: attach components with reference resolution
  for (const { id, def, source } of entityIds) {
    const entityLabel = def.key ?? id;

    for (const [typeName, data] of Object.entries(def.components)) {
      try {
        const resolved = resolveRefs(
          data as Record<string, unknown>,
          typeName,
          world,
          entityLabel,
          source
        );
        world.addComponent(id, typeName, resolved);
      } catch (err) {
        throw new Error(
          `Error on component "${typeName}" of entity "${entityLabel}" in "${source}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

function resolveRefs(
  data: Record<string, unknown>,
  typeName: string,
  world: World,
  entityLabel: string,
  source: string
): Record<string, unknown> {
  const refs = world.componentRegistry.getRefs(typeName);
  if (refs.length === 0) return data;

  const resolved = { ...data };

  for (const refPath of refs) {
    if (refPath.endsWith(".*")) {
      // Record pattern: "fieldName.*"
      const fieldName = refPath.slice(0, -2);
      const record = resolved[fieldName];
      if (record && typeof record === "object" && !Array.isArray(record)) {
        const resolvedRecord: Record<string, string> = {};
        for (const [key, value] of Object.entries(
          record as Record<string, unknown>
        )) {
          if (typeof value === "string") {
            resolvedRecord[key] = resolveKey(value, world, entityLabel, source);
          }
        }
        resolved[fieldName] = resolvedRecord;
      }
    } else {
      // Direct field: "fieldName"
      const value = resolved[refPath];
      if (typeof value === "string") {
        resolved[refPath] = resolveKey(value, world, entityLabel, source);
      }
    }
  }

  return resolved;
}

function resolveKey(
  key: string,
  world: World,
  entityLabel: string,
  source: string
): string {
  const id = world.getEntityByKey(key);
  if (!id) {
    throw new Error(
      `Unresolved entity reference "${key}" on entity "${entityLabel}" in "${source}"`
    );
  }
  return id;
}

function findYamlFiles(dirPath: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.ya?ml$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  results.sort();
  return results;
}
