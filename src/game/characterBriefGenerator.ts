import { LLMClient } from "../engine/LLMClient.js";
import { promptBuilder } from "../engine/description/PromptBuilder.js";
import type { CharacterRoll } from "./characterGenerator.js";

export const client = new LLMClient();

const MAX_RETRIES = 3;

function buildFallback(roll: CharacterRoll): string {
  const lines = [
    `${roll.gender}, ${roll.age}, ${roll.height} height, ${roll.build} build.`,
    `${roll.skin} skin, ${roll.eyes} eyes, ${roll.hair} hair.`,
  ];
  if (roll.fantasticalFeature !== null) {
    lines.push(`${roll.fantasticalFeature}.`);
  }
  if (roll.skinMarks.length > 0) {
    lines.push(roll.skinMarks.join(", ") + ".");
  }
  return lines.join("\n");
}

export async function generateCharacterBrief(roll: CharacterRoll): Promise<string> {
  const system = promptBuilder.buildSystemPrompt("character-brief", false);
  const user = promptBuilder.buildCharacterUserPrompt(roll);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let result;
    try {
      result = await client.generate(system, user);
    } catch {
      continue;
    }
    if (result.ok) return result.text;
  }

  return buildFallback(roll);
}
