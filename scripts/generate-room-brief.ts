// Usage: npm run generate-brief <roomKey>
// Reads RoomProse component from YAML content, calls the LLM with the
// room-brief role prompt, and prints the paste-ready brief to stdout.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import * as path from "node:path";
import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { LLMClient } from "../src/engine/LLMClient.js";
import { promptBuilder } from "../src/engine/description/PromptBuilder.js";

const roomKey = process.argv[2];
if (!roomKey) {
  console.error("Usage: npm run generate-brief <roomKey>");
  console.error("Example: npm run generate-brief monastery.kitchen");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Walk content/ to find the room entity by key
// ---------------------------------------------------------------------------

function walkYamlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkYamlFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      files.push(full);
    }
  }
  return files;
}

type YamlEntity = {
  key?: string;
  components?: Record<string, unknown>;
};

type YamlDoc = {
  entities?: YamlEntity[];
};

const contentDir = path.join(process.cwd(), "content");
const yamlFiles = walkYamlFiles(contentDir);

let roomName: string | undefined;
let prose: string | undefined;

for (const file of yamlFiles) {
  const raw = fs.readFileSync(file, "utf8");
  const doc = parseYaml(raw) as YamlDoc;
  if (!doc?.entities) continue;
  for (const entity of doc.entities) {
    if (entity.key !== roomKey) continue;
    const components = entity.components ?? {};
    const roomComp = components["Room"] as { name?: string } | undefined;
    const proseComp = components["RoomProse"] as { prose?: string } | undefined;
    if (roomComp?.name !== undefined) roomName = roomComp.name;
    if (proseComp?.prose !== undefined) prose = proseComp.prose;
  }
}

if (!roomName) {
  console.error(`Room not found or has no Room component: ${roomKey}`);
  process.exit(1);
}

if (!prose) {
  console.error(`Room "${roomKey}" has no RoomProse component.`);
  console.error(`Add a RoomProse component with source prose to the room's YAML entry first.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Generate the brief
// ---------------------------------------------------------------------------

const client = new LLMClient();
const system = promptBuilder.buildSystemPrompt("room-brief", false);
const user = promptBuilder.buildRoomBriefUserPrompt(roomName, prose);

process.stderr.write(`Generating brief for: ${roomName} (${roomKey})\n`);

const result = await client.generate(system, user);

if (!result.ok) {
  console.error(`LLM error: ${result.error}`);
  process.exit(1);
}

console.log(result.text);
