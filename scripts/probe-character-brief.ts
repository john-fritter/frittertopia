import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import { promptBuilder } from "../src/engine/description/PromptBuilder.js";
import { rollCharacter } from "../src/game/characterGenerator.js";
import type { CharacterRoll } from "../src/game/characterGenerator.js";

const ScenarioSchema = z.object({
  description: z.string(),
  roll: z.object({
    gender: z.string(),
    age: z.string(),
    height: z.string(),
    build: z.string(),
    skin: z.string(),
    eyes: z.string(),
    hair: z.string(),
    fantasticalFeature: z.string().nullable(),
    skinMarks: z.array(z.string()),
  }).strict(),
}).strict();

export { ScenarioSchema };

export const GENDERS = ["man", "woman", "nonbinary person"] as const;

function uniformPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function formatRollAsYaml(roll: CharacterRoll): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(roll)) {
    if (v === null) {
      lines.push(`${k}: null`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        const items = v.map((s: string) => `"${s}"`).join(", ");
        lines.push(`${k}: [${items}]`);
      }
    } else {
      lines.push(`${k}: "${String(v)}"`);
    }
  }
  return lines;
}

function writeReport(options: {
  lines: string[];
  records: Array<{ iteration: number; type: "success" | "failure"; value: string; roll?: CharacterRoll }>;
  outputDir: string;
  timestamp: string;
}): string {
  const outFile = path.join(options.outputDir, `character-brief-${options.timestamp}.md`);
  fs.mkdirSync(options.outputDir, { recursive: true });

  for (const rec of options.records) {
    options.lines.push(`### Iteration ${rec.iteration}${rec.type === "failure" ? " — ERROR" : ""}`);
    options.lines.push("");
    if (rec.roll) {
      options.lines.push("#### Roll");
      options.lines.push("");
      options.lines.push("```yaml");
      options.lines.push(...formatRollAsYaml(rec.roll));
      options.lines.push("```");
      options.lines.push("");
      options.lines.push("#### User prompt");
      options.lines.push("");
      options.lines.push("```");
      options.lines.push(promptBuilder.buildCharacterUserPrompt(rec.roll));
      options.lines.push("```");
      options.lines.push("");
    }
    if (rec.type === "failure") {
      options.lines.push("#### Error");
      options.lines.push("");
      options.lines.push("```");
      options.lines.push(rec.value);
      options.lines.push("```");
      options.lines.push("");
    } else {
      if (rec.roll) {
        options.lines.push("#### Brief");
        options.lines.push("");
      }
      options.lines.push(rec.value);
      options.lines.push("");
    }
  }

  fs.writeFileSync(outFile, options.lines.join("\n"), "utf-8");

  const successCount = options.records.filter((r) => r.type === "success").length;
  const failureCount = options.records.filter((r) => r.type === "failure").length;

  return outFile;
}

export async function runProbe(options: {
  scenarioPath: string;
  count: number;
  generateFn: (roll: CharacterRoll) => Promise<string>;
  outputDir?: string;
}): Promise<{ outputPath: string; successCount: number; failureCount: number }> {
  const { scenarioPath, count, generateFn } = options;

  const yamlText = fs.readFileSync(scenarioPath, "utf-8");
  const parsed = parseYaml(yamlText);
  const scenario = ScenarioSchema.parse(parsed);
  const roll = scenario.roll as CharacterRoll;
  const scenarioName = path.basename(scenarioPath, path.extname(scenarioPath));

  const systemPrompt = promptBuilder.buildSystemPrompt("character-brief", false);
  const userPrompt = promptBuilder.buildCharacterUserPrompt(roll);

  const model = process.env["OPENROUTER_MODEL"] ?? "google/gemini-2.0-flash-lite-001";

  const records: Array<{ iteration: number; type: "success" | "failure"; value: string }> = [];

  for (let i = 1; i <= count; i++) {
    try {
      const brief = await generateFn(roll);
      records.push({ iteration: i, type: "success", value: brief });
    } catch (err) {
      records.push({ iteration: i, type: "failure", value: String(err) });
    }
  }

  const outDir = options.outputDir ?? path.join(process.cwd(), "tmp", "probe-runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const lines: string[] = [];
  lines.push(`# Character Brief Probe — ${timestamp}`);
  lines.push("");
  lines.push(`**Scenario:** ${scenarioName}.yaml`);
  lines.push(`**Description:** ${scenario.description}`);
  lines.push(`**Iterations:** ${count}`);
  lines.push(`**Model:** ${model}`);
  lines.push("");
  lines.push("## Input");
  lines.push("");
  lines.push("```yaml");
  lines.push(...formatRollAsYaml(roll));
  lines.push("```");
  lines.push("");
  lines.push("## Prompt sent");
  lines.push("");
  lines.push("### System prompt");
  lines.push("");
  lines.push("```");
  lines.push(systemPrompt);
  lines.push("```");
  lines.push("");
  lines.push("### User prompt");
  lines.push("");
  lines.push("```");
  lines.push(userPrompt);
  lines.push("```");
  lines.push("");
  lines.push("## Results");
  lines.push("");

  const outFile = writeReport({ lines, records, outputDir: outDir, timestamp });

  const successCount = records.filter((r) => r.type === "success").length;
  const failureCount = records.filter((r) => r.type === "failure").length;

  return { outputPath: outFile, successCount, failureCount };
}

export async function runRandomProbe(options: {
  count: number;
  generateFn: (roll: CharacterRoll) => Promise<string>;
  outputDir?: string;
  genders?: readonly string[];
}): Promise<{ outputPath: string; successCount: number; failureCount: number }> {
  const { count, generateFn } = options;
  const genders = options.genders ?? GENDERS;

  const model = process.env["OPENROUTER_MODEL"] ?? "google/gemini-2.0-flash-lite-001";
  const systemPrompt = promptBuilder.buildSystemPrompt("character-brief", false);

  const records: Array<{ iteration: number; type: "success" | "failure"; value: string; roll: CharacterRoll }> = [];

  for (let i = 1; i <= count; i++) {
    const gender = uniformPick(genders);
    const roll = rollCharacter(gender);
    try {
      const brief = await generateFn(roll);
      records.push({ iteration: i, type: "success", value: brief, roll });
    } catch (err) {
      records.push({ iteration: i, type: "failure", value: String(err), roll });
    }
  }

  const outDir = options.outputDir ?? path.join(process.cwd(), "tmp", "probe-runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const lines: string[] = [];
  lines.push(`# Character Brief Probe — ${timestamp}`);
  lines.push("");
  lines.push(`**Mode:** random`);
  lines.push(`**Iterations:** ${count}`);
  lines.push(`**Model:** ${model}`);
  lines.push("");
  lines.push("## Prompt sent");
  lines.push("");
  lines.push("The system prompt is the same for every iteration. The user prompt changes with each random roll and is shown under that iteration.");
  lines.push("");
  lines.push("### System prompt");
  lines.push("");
  lines.push("```");
  lines.push(systemPrompt);
  lines.push("```");
  lines.push("");
  lines.push("## Results");
  lines.push("");

  const outFile = writeReport({ lines, records, outputDir: outDir, timestamp });

  const successCount = records.filter((r) => r.type === "success").length;
  const failureCount = records.filter((r) => r.type === "failure").length;

  return { outputPath: outFile, successCount, failureCount };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error(
      "Usage: npx tsx scripts/probe-character-brief.ts <scenario.yaml> <count>\n" +
      "       npx tsx scripts/probe-character-brief.ts random <count>"
    );
    process.exit(1);
  }

  const rawCount = args[1]!;
  const count = parseInt(rawCount, 10);
  if (isNaN(count) || count < 1) {
    console.error("Error: <count> must be a positive integer");
    process.exit(1);
  }

  const { generateCharacterBrief } = await import(
    "../src/game/characterBriefGenerator.js"
  );

  if (args[0] === "random") {
    const result = await runRandomProbe({
      count,
      generateFn: generateCharacterBrief,
    });
    const relativePath = path.relative(process.cwd(), result.outputPath);
    console.log(`Wrote ${relativePath}`);
    console.log(
      `Iterations: ${count} | Success: ${result.successCount} | Failure: ${result.failureCount}`
    );
    return;
  }

  const scenarioPath = args[0]!;
  const result = await runProbe({
    scenarioPath,
    count,
    generateFn: generateCharacterBrief,
  });

  const relativePath = path.relative(process.cwd(), result.outputPath);
  console.log(`Wrote ${relativePath}`);
  console.log(
    `Iterations: ${count} | Success: ${result.successCount} | Failure: ${result.failureCount}`
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
