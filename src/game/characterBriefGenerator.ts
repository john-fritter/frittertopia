import { LLMClient } from "../engine/LLMClient.js";
import { promptBuilder } from "../engine/description/PromptBuilder.js";
import type { CharacterRoll } from "./characterGenerator.js";

export const client = new LLMClient();

const MAX_RETRIES = 3;

function buildFallback(roll: CharacterRoll): string {
  const parts = [
    `${roll.gender}, ${roll.age}.`,
    `${roll.height} height, ${roll.build} build.`,
    `Skin: ${roll.skin}. Eyes: ${roll.eyes}. Hair: ${roll.hair}.`,
  ];
  if (roll.fantasticalFeature !== null) {
    parts.push(`Fantastical feature: ${roll.fantasticalFeature}.`);
  }
  if (roll.skinMarks.length > 0) {
    parts.push(`Marks: ${roll.skinMarks.join(", ")}.`);
  }
  return parts.join(" ");
}

export async function generateCharacterBrief(roll: CharacterRoll): Promise<string> {
  const system = promptBuilder.buildSystemPrompt("character-brief");
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
