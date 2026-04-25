import { LLMClient } from "../engine/LLMClient.js";
import type { CharacterRoll } from "./characterGenerator.js";

export const client = new LLMClient();

const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are the storyteller for Frittertopia, a dreamlike persistent world. You are generating an internal character brief for a new arrival. The brief is never shown to the player. It is your working reference document — plain descriptive language, not prose, not second person. Its only purpose is physical continuity: ensuring this character is described consistently every time they appear.

Write a short physical description that incorporates the provided traits. Be specific. Include at least one detail about how this person moves or holds themselves that feels consistent with their physical form. The storyteller who reads this brief should be able to pick this character out of a crowd.

Do not invent personality. Do not invent history. Do not invent preferences unless they fall naturally from the physical form. Fill in details like hairstyle, minor marks, and texture that weren't specified but are needed to make the description feel inhabited. Keep it under 150 words.

The character must be a bipedal humanoid that is able to walk on land, breathe, eat, drink, speak, fit through a normal doorway, wear clothing, carry a pack, and die. If the provided traits create something that can't do these things, find the nearest version that can and describe that instead.`;

function inchesToReadable(inches: number): string {
  const feet = Math.floor(inches / 12);
  const remaining = inches % 12;
  return `${feet}'${remaining}"`;
}

function buildUserPrompt(roll: CharacterRoll): string {
  return [
    `Gender: ${roll.gender}`,
    `Age: ${roll.age}`,
    `Height: ${inchesToReadable(roll.height)}`,
    `Build: ${roll.build}`,
    `Skin: ${roll.skin}`,
    `Eyes: ${roll.eyes}`,
    `Hair: ${roll.hair}`,
    `Weird feature: ${roll.weirdFeature ?? "none"}`,
  ].join("\n");
}

function buildFallback(roll: CharacterRoll): string {
  const parts = [
    `${roll.gender}, ${roll.age} years old.`,
    `${inchesToReadable(roll.height)}, ${roll.build} build.`,
    `Skin: ${roll.skin}. Eyes: ${roll.eyes}. Hair: ${roll.hair}.`,
  ];
  if (roll.weirdFeature !== null) {
    parts.push(`Notable: ${roll.weirdFeature}.`);
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
