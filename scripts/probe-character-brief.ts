import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import { promptBuilder } from "../src/engine/description/PromptBuilder.js";
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

  interface IterationRecord {
    iteration: number;
    type: "success" | "failure";
    value: string;
  }

  const records: IterationRecord[] = [];

  for (let i = 1; i <= count; i++) {
    try {
      const brief = await generateFn(roll);
      records.push({ iteration: i, type: "success", value: brief });
    } catch (err) {
      records.push({ iteration: i, type: "failure", value: String(err) });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = options.outputDir ?? path.join(process.cwd(), "tmp", "probe-runs");
  const outFile = path.join(outDir, `character-brief-${timestamp}.md`);
  fs.mkdirSync(outDir, { recursive: true });

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
  for (const [k, v] of Object.entries(scenario.roll)) {
    if (v === null) {
      lines.push(`${k}: null`);
    } else if (Array.isArray(v)) {
      const items = v.map((s: string) => `"${s}"`).join(", ");
      lines.push(`${k}: [${items}]`);
    } else {
      lines.push(`${k}: "${String(v)}"`);
    }
  }
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

  for (const rec of records) {
    if (rec.type === "failure") {
      lines.push(`### Iteration ${rec.iteration} — ERROR`);
      lines.push("");
      lines.push("```");
      lines.push(rec.value);
      lines.push("```");
      lines.push("");
    } else {
      lines.push(`### Iteration ${rec.iteration}`);
      lines.push("");
      lines.push(rec.value);
      lines.push("");
    }
  }

  fs.writeFileSync(outFile, lines.join("\n"), "utf-8");

  const successCount = records.filter((r) => r.type === "success").length;
  const failureCount = records.filter((r) => r.type === "failure").length;

  return {
    outputPath: outFile,
    successCount,
    failureCount,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error(
      "Usage: npx tsx scripts/probe-character-brief.ts <scenario.yaml> <count>"
    );
    process.exit(1);
  }

  const scenarioPath = args[0]!;
  const rawCount = args[1]!;
  const count = parseInt(rawCount, 10);
  if (isNaN(count) || count < 1) {
    console.error("Error: <count> must be a positive integer");
    process.exit(1);
  }

  const { generateCharacterBrief } = await import(
    "../src/game/characterBriefGenerator.js"
  );

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
