import { LLMClient } from "../engine/LLMClient.js";
import type { CharacterRoll } from "./characterGenerator.js";

export const client = new LLMClient();

const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are the storyteller for Frittertopia. This is an internal working note — never shown to the player. Keep it under 75 words.

Write in plain prose. No headers, no sections, no bullet points.

Describe the character as a body at rest: what they look like standing still. No movement description. No posture description. No personality inference.  Do not comment on how noticeable they are.

Use only the physical traits provided. You may invent hairstyle and, where plausible, facial hair. Do not add scars, marks, callouses, hands, clothing, or any other feature not listed.

If the character has a tattoo or tattoos, describe what they actually depict and where they are. Invent the design — don't note that it was unspecified.

If a detail wasn't provided, omit it rather than noting its absence.

The character must be able to walk on land, breathe, eat, drink, speak, fit through a normal doorway, wear clothing, carry a pack, and die. If the provided traits produce something that can't do these things, find the nearest version that can. Note any adjustment in one sentence at the end, then stop.`;

function inchesToReadable(inches: number): string {
  const feet = Math.floor(inches / 12);
  const remaining = inches % 12;
  return `${feet}'${remaining}"`;
}

function buildUserPrompt(roll: CharacterRoll): string {
  const lines = [
    `Gender: ${roll.gender}`,
    `Age: ${roll.age}`,
    `Height: ${inchesToReadable(roll.height)}`,
    `Build: ${roll.build}`,
    `Skin: ${roll.skin}`,
    `Eyes: ${roll.eyes}`,
    `Hair: ${roll.hair}`,
    `Fantastical feature: ${roll.fantasticalFeature ?? "none"}`,
  ];
  if (roll.skinMarks.length > 0) {
    lines.push(`Skin marks: ${roll.skinMarks.join(", ")}`);
  }
  return lines.join("\n");
}

function buildFallback(roll: CharacterRoll): string {
  const parts = [
    `${roll.gender}, ${roll.age} years old.`,
    `${inchesToReadable(roll.height)}, ${roll.build} build.`,
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
  const user = buildUserPrompt(roll);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let result;
    try {
      result = await client.generate(SYSTEM_PROMPT, user);
    } catch {
      continue;
    }
    if (result.ok) return result.text;
  }

  return buildFallback(roll);
}
