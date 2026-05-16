import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import { World } from "../src/engine/World.js";
import { registerComponents } from "../src/game/components.js";
import { loadContentFromDirectory } from "../src/engine/ContentLoader.js";
import { promptBuilder } from "../src/engine/description/PromptBuilder.js";
import type { CharacterRoll } from "../src/game/characterGenerator.js";
import {
  getBracketMidpoints,
  getMoonAboveHorizon,
  setDebugTime,
  type TimeBracket,
} from "../src/game/solar.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RollSchema = z.object({
  gender: z.string(),
  age: z.string(),
  height: z.string(),
  build: z.string(),
  skin: z.string(),
  eyes: z.string(),
  hair: z.string(),
  fantasticalFeature: z.string().nullable(),
  skinMarks: z.array(z.string()),
}).strict();

const PlayerSchema = z.object({
  name: z.string(),
  brief: z.string().optional(),
  roll: RollSchema.optional(),
}).strict().refine(
  (data) => (data.brief !== undefined) !== (data.roll !== undefined),
  { message: "Exactly one of 'brief' or 'roll' is required" },
);

const OverridesSchema = z.object({
  time: z.object({
    bracket: z.string(),
    moonPhase: z.string(),
    moonAboveHorizon: z.boolean(),
  }).strict().optional(),
  weather: z.object({
    tempC: z.number(),
    precipState: z.string(),
    pressureMb: z.number(),
    pressureTrend: z.string(),
  }).strict().optional(),
}).strict();

const ItemSchema = z.object({
  shortDescription: z.string(),
  brief: z.string(),
  presence: z.string(),
  state: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
}).strict();

const CallSchema = z.object({
  role: z.enum(["describe-room", "describe"]),
  count: z.number().int().positive(),
  input: z.string().optional(),
}).strict();

const ScenarioSchema = z.object({
  description: z.string(),
  roomKey: z.string(),
  overrides: OverridesSchema.optional(),
  currentPlayer: PlayerSchema,
  otherPlayers: z.array(PlayerSchema).optional(),
  items: z.array(ItemSchema).optional(),
  calls: z.array(CallSchema).min(1),
}).strict();

export { ScenarioSchema };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScenarioData = z.infer<typeof ScenarioSchema>;

interface CallResult {
  role: "describe-room" | "describe";
  input: string;
  count: number;
  prompts: { system: string; user: string } | null;
  results: Array<{ iteration: number; type: "success" | "failure"; value: string }>;
}

interface CreatedPlayer {
  id: string;
  name: string;
  brief: string;
}

// ---------------------------------------------------------------------------
// World bootstrap
// ---------------------------------------------------------------------------

function createWorld(): World {
  const world = new World();
  registerComponents(world);

  const worldTimeId = world.createEntity("world.time");
  world.addComponent(worldTimeId, "TimeOfDay", {
    bracket: "unknown",
    moonFraction: 0,
    moonPhase: "new",
    updatedAt: new Date().toISOString(),
  });

  const contentDir = path.join(import.meta.dirname, "..", "content");
  loadContentFromDirectory(contentDir, world);

  const promptsDir = path.join(import.meta.dirname, "..", "content", "prompts");
  promptBuilder.loadPromptFiles(promptsDir);

  return world;
}

// ---------------------------------------------------------------------------
// Scenario application
// ---------------------------------------------------------------------------

function applyOverrides(world: World, scenario: ScenarioData, resolvedRoomId: string): void {
  if (scenario.overrides?.time) {
    const timeOverride = scenario.overrides.time;
    const worldTimeId = world.getEntityByKey("world.time");
    if (worldTimeId) {
      world.setComponent(worldTimeId, "TimeOfDay", {
        bracket: timeOverride.bracket,
        moonFraction: 0.5,
        moonPhase: timeOverride.moonPhase,
        updatedAt: new Date().toISOString(),
      });
    }

    const debugTime = findDebugTimeForTimeOverride(timeOverride);
    if (debugTime) {
      setDebugTime(debugTime);
    } else {
      console.warn(
        `Warning: could not find debug wall-clock time matching ${timeOverride.bracket} with moon ${timeOverride.moonAboveHorizon ? "above" : "below"} horizon; TimeOfDay override still applied.`,
      );
    }
  }

  if (scenario.overrides?.weather) {
    const weatherOverride = scenario.overrides.weather;
    const zoneRef = world.getComponent(resolvedRoomId, "WeatherZoneRef") as
      | { zoneId: string }
      | undefined;
    if (zoneRef) {
      const now = Date.now();
      const pressureHistory = [
        { time: now - 60_000, value: weatherOverride.pressureMb },
        { time: now, value: weatherOverride.pressureMb },
      ];
      world.addComponent(zoneRef.zoneId, "WeatherState", {
        tempC: weatherOverride.tempC,
        pressureMb: weatherOverride.pressureMb,
        precipState: weatherOverride.precipState,
        precipStateElapsedMs: 0,
        precipStateDurationMs: 600_000,
        tempNoise: 0,
        pressureNoise: 0,
        pressureHistory,
        snowDepth: 0,
      });
    } else {
      console.warn(
        `Warning: weather override ignored because room ${scenario.roomKey} has no WeatherZoneRef.`,
      );
    }
  }
}

function findDebugTimeForTimeOverride(timeOverride: {
  bracket: string;
  moonAboveHorizon: boolean;
}): Date | null {
  const bracket = timeOverride.bracket as TimeBracket;
  const start = new Date();

  for (let day = 0; day < 90; day++) {
    const date = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    const midpoints = getBracketMidpoints(date);
    const candidate = midpoints[bracket];
    if (candidate && getMoonAboveHorizon(candidate) === timeOverride.moonAboveHorizon) {
      return candidate;
    }
  }

  return null;
}

async function createPlayerFromDef(
  world: World,
  def: { name: string; brief?: string; roll?: z.infer<typeof RollSchema> },
  roomId: string,
): Promise<CreatedPlayer> {
  const id = world.createEntity();
  world.addComponent(id, "Player", { name: def.name, sessionId: "" });
  world.addComponent(id, "Position", { roomId });

  let brief = "";
  if (def.brief) {
    brief = def.brief;
    world.addComponent(id, "CharacterBrief", { brief });
  } else if (def.roll) {
    const { generateCharacterBrief } = await import(
      "../src/game/characterBriefGenerator.js"
    );
    const roll = def.roll as CharacterRoll;
    brief = await generateCharacterBrief(roll);
    world.addComponent(id, "CharacterBrief", { brief });
    world.addComponent(id, "CharacterRoll", roll);
  }

  return { id, name: def.name, brief };
}

function createItemFromDef(
  world: World,
  item: z.infer<typeof ItemSchema>,
  roomId: string,
): string {
  const id = world.createEntity();
  world.addComponent(id, "Position", { roomId });
  world.addComponent(id, "Description", { short: item.shortDescription });
  world.addComponent(id, "Presence", { description: item.presence });
  world.addComponent(id, "ItemBrief", { brief: item.brief });
  if (item.state) {
    world.addComponent(id, "ItemState", item.state as Record<string, string | boolean | number>);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatBriefInline(brief: string): string {
  return brief
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

function getRoomYamlItemNames(world: World, roomId: string, excludeIds: Set<string>): string[] {
  const names: string[] = [];
  const allWithPosition = world.getEntitiesWithComponent("Position");
  for (const id of allWithPosition) {
    if (excludeIds.has(id)) continue;
    const pos = world.getComponent(id, "Position") as { roomId: string } | undefined;
    if (pos?.roomId !== roomId) continue;
    const presence = world.getComponent(id, "Presence");
    if (!presence) continue;
    const desc = world.getComponent(id, "Description") as { short: string } | undefined;
    if (desc) names.push(desc.short);
  }
  return names;
}

function buildWorldStateSection(
  scenario: ScenarioData,
  resolvedRoomId: string,
  roomName: string,
  world: World,
  currentPlayer: CreatedPlayer,
  otherPlayers: CreatedPlayer[],
  scenarioItemIds: string[],
): string[] {
  const lines: string[] = [];
  lines.push("## World state");
  lines.push("");
  lines.push(`**Room:** ${scenario.roomKey} (${roomName})`);

  if (scenario.overrides?.time) {
    const t = scenario.overrides.time;
    const aboveHorizon = t.moonAboveHorizon ? "above horizon" : "below horizon";
    lines.push(`**Time:** ${t.bracket}, ${t.moonPhase} moon (${aboveHorizon}) [overridden]`);
  } else {
    lines.push("**Time:** (default — no override)");
  }

  const zoneRef = world.getComponent(resolvedRoomId, "WeatherZoneRef") as
    | { zoneId: string }
    | undefined;
  if (scenario.overrides?.weather && zoneRef) {
    const w = scenario.overrides.weather;
    lines.push(`**Weather:** ${w.tempC}°C, ${w.precipState}, ${w.pressureMb} mb ${w.pressureTrend} [overridden]`);
  } else if (!zoneRef) {
    lines.push("**Weather:** N/A (indoor — no weather zone)");
  } else {
    lines.push("**Weather:** (default — no override)");
  }

  lines.push("");
  lines.push(`**Current player:** ${currentPlayer.name}`);
  lines.push(formatBriefInline(currentPlayer.brief));

  if (otherPlayers.length > 0) {
    lines.push("");
    lines.push(`**Other players:** ${otherPlayers.map((p) => p.name).join(", ")}`);
    for (const p of otherPlayers) {
      lines.push(formatBriefInline(p.brief));
    }
  }

  if (scenario.items && scenario.items.length > 0) {
    lines.push("");
    lines.push(`**Items (scenario-added):** ${scenario.items.map((i) => i.shortDescription).join(", ")}`);
    for (const item of scenario.items) {
      lines.push(`> ${item.shortDescription}: ${item.brief.split("\n")[0] ?? ""}...`);
    }
  }

  const roomItemNames = getRoomYamlItemNames(world, resolvedRoomId, new Set(scenarioItemIds));
  if (roomItemNames.length > 0) {
    lines.push("");
    lines.push(`**Items (from room YAML):** ${roomItemNames.join(", ")}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Main probe runner
// ---------------------------------------------------------------------------

export async function runSenseProbe(options: {
  world: World;
  scenario: ScenarioData;
  scenarioStem?: string;
  outputDir?: string;
}): Promise<{ outputPath: string; successCount: number; failureCount: number }> {
  const { world, scenario } = options;
  const outDir = options.outputDir ?? path.join(process.cwd(), "tmp", "probe-runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stem = options.scenarioStem ?? "sense";

  const model = process.env["OPENROUTER_MODEL"] ?? "google/gemini-2.0-flash-lite-001";

  const resolvedRoomId = world.getEntityByKey(scenario.roomKey);
  if (!resolvedRoomId) {
    throw new Error(`Room key "${scenario.roomKey}" not found in world. Has content been loaded?`);
  }
  const roomComp = world.getComponent(resolvedRoomId, "Room") as { name: string } | undefined;
  const roomName = roomComp?.name ?? scenario.roomKey;

  applyOverrides(world, scenario, resolvedRoomId);

  const currentPlayer = await createPlayerFromDef(world, scenario.currentPlayer, resolvedRoomId);

  const otherPlayers: CreatedPlayer[] = [];
  if (scenario.otherPlayers) {
    for (const p of scenario.otherPlayers) {
      otherPlayers.push(await createPlayerFromDef(world, p, resolvedRoomId));
    }
  }

  const scenarioItemIds: string[] = [];
  if (scenario.items) {
    for (const item of scenario.items) {
      scenarioItemIds.push(createItemFromDef(world, item, resolvedRoomId));
    }
  }

  const callResults: CallResult[] = [];

  for (const call of scenario.calls) {
    const callInput = call.input ?? "look";
    const results: CallResult["results"] = [];
    let prompts: { system: string; user: string } | null = null;

    for (let iter = 1; iter <= call.count; iter++) {
      try {
        let response: string;

        if (call.role === "describe-room") {
          response = await world.description.describe(resolvedRoomId, currentPlayer.id, callInput);
        } else {
          response = await world.description.describeSense(resolvedRoomId, currentPlayer.id, callInput);
        }

        if (iter === 1 && world.description.lastPrompt) {
          prompts = {
            system: world.description.lastPrompt.system,
            user: world.description.lastPrompt.user,
          };
        }

        results.push({ iteration: iter, type: "success", value: response });
      } catch (err) {
        results.push({ iteration: iter, type: "failure", value: String(err) });
      }
    }

    callResults.push({
      role: call.role,
      input: callInput,
      count: call.count,
      prompts,
      results,
    });
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `sense-${stem}-${timestamp}.md`);

  const lines: string[] = [];
  lines.push(`# Sense Probe — ${timestamp}`);
  lines.push("");
  lines.push(`**Scenario:** ${stem}.yaml`);
  lines.push(`**Description:** ${scenario.description}`);
  lines.push(`**Model:** ${model}`);
  lines.push("");

  lines.push(...buildWorldStateSection(
    scenario,
    resolvedRoomId,
    roomName,
    world,
    currentPlayer,
    otherPlayers,
    scenarioItemIds,
  ));
  lines.push("");
  lines.push("---");
  lines.push("");

  for (let ci = 0; ci < callResults.length; ci++) {
    const cr = callResults[ci]!;
    const label = cr.role === "describe-room"
      ? `${cr.role} (×${cr.count})`
      : `${cr.role} — "${cr.input}" (×${cr.count})`;
    lines.push(`## Call ${ci + 1}: ${label}`);
    lines.push("");

    if (cr.prompts) {
      lines.push("### System prompt");
      lines.push("");
      lines.push("```");
      lines.push(cr.prompts.system);
      lines.push("```");
      lines.push("");
      lines.push("### User prompt");
      lines.push("");
      lines.push("```");
      lines.push(cr.prompts.user);
      lines.push("```");
      lines.push("");
    }

    for (const r of cr.results) {
      const errTag = r.type === "failure" ? " — ERROR" : "";
      lines.push(`### Iteration ${r.iteration}${errTag}`);
      lines.push("");
      if (r.type === "failure") {
        lines.push("```");
        lines.push(r.value);
        lines.push("```");
      } else {
        lines.push(r.value);
      }
      lines.push("");
    }

    if (ci < callResults.length - 1) {
      lines.push("---");
      lines.push("");
    }
  }

  fs.writeFileSync(outFile, lines.join("\n"), "utf-8");

  const totalIterations = callResults.reduce((s, cr) => s + cr.results.length, 0);
  const successCount = callResults.reduce((s, cr) => s + cr.results.filter((r) => r.type === "success").length, 0);
  const failureCount = callResults.reduce((s, cr) => s + cr.results.filter((r) => r.type === "failure").length, 0);

  return { outputPath: outFile, successCount, failureCount };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error(
      "Usage: npx tsx scripts/probe-sense.ts <scenario.yaml>",
    );
    process.exit(1);
  }

  const scenarioPath = args[0]!;
  const yamlText = fs.readFileSync(scenarioPath, "utf-8");
  const parsed = parseYaml(yamlText);
  const scenario = ScenarioSchema.parse(parsed);
  const scenarioStem = path.basename(scenarioPath, path.extname(scenarioPath));

  const world = createWorld();
  const result = await runSenseProbe({ world, scenario, scenarioStem });

  const relativePath = path.relative(process.cwd(), result.outputPath);
  const totalIterations = result.successCount + result.failureCount;
  console.log(
    `Wrote ${relativePath} | Iterations: ${totalIterations} | Success: ${result.successCount} | Failure: ${result.failureCount}`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((err) => {
    console.error(`Fatal: ${err}`);
    process.exit(1);
  });
}
