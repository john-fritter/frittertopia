import type { RoomContext } from "./ContextBuilder.js";
import type { MatchedEntity } from "./DescriptionService.js";
import type { Sense } from "./DescriptionService.js";

function formatWeatherLine(context: RoomContext): string {
  if (context.tempF === undefined) return `Weather: ${context.weather}`;
  const parts: string[] = [context.weather];
  parts.push(`${context.tempF}°F (${context.tempBracket ?? ""})`);
  if (context.pressureMb !== undefined && context.pressureTrend !== undefined) {
    parts.push(`${context.pressureMb} mb ${context.pressureTrend}`);
  }
  return `Weather: ${parts.join(", ")}`;
}

export class PromptBuilder {
  buildSystemPrompt(sense: Sense = "look"): string {
    if (sense === "listen") {
      return (
        "You are describing a room in a text-based game world through sound alone. " +
        "Write an atmospheric, second-person present-tense description in 2-4 sentences focusing entirely on what can be heard — ambient sounds, resonance, silence, the texture of the quiet. " +
        "Do not describe visual details. " +
        "You may embellish sonic texture but never invent characters, events, or interactive elements not documented in the room brief."
      );
    }
    if (sense === "smell") {
      return (
        "You are describing a room in a text-based game world through smell alone. " +
        "Write an atmospheric, second-person present-tense description in 2-4 sentences focusing entirely on what can be smelled — ambient scents, materials, age, the character of the air. " +
        "Do not describe visual details. " +
        "You may embellish olfactory detail but never invent objects, characters, or interactive elements not documented in the room brief."
      );
    }
    // look (default), touch, taste — room-level touch/taste are blocked in the verb layer,
    // but define prompts for completeness
    return (
      "You are describing rooms in a text-based game world. " +
      "Write atmospheric, second-person present-tense descriptions in 2-4 sentences. " +
      "Describe only what is documented in the room brief. " +
      "You may embellish sensory details — light, texture, sound, smell — but never invent objects, exits, characters, or anything a player could interact with. " +
      "If other entities are present, weave their presence into the description naturally."
    );
  }

  buildTargetSystemPrompt(sense: Sense = "look"): string {
    if (sense === "listen") {
      return (
        "You are describing a specific feature or detail in a text-based game world as it is heard — its sound, resonance, or acoustic presence. " +
        "Write in second-person present-tense in 1-3 sentences, drawing from the room brief. " +
        "If the target has no plausible sonic quality, respond naturally with a short message."
      );
    }
    if (sense === "smell") {
      return (
        "You are describing a specific feature or detail in a text-based game world as it smells — its scent, odor, or aromatic character. " +
        "Write in second-person present-tense in 1-3 sentences, drawing from the room brief. " +
        "If the target has no plausible scent, respond naturally with a short message."
      );
    }
    if (sense === "touch") {
      return (
        "You are describing a specific feature or detail in a text-based game world as it feels to the touch — texture, temperature, surface character, weight. " +
        "Write in second-person present-tense in 1-3 sentences, drawing from the room brief. " +
        "If touching it would be implausible, respond naturally with a short message."
      );
    }
    if (sense === "taste") {
      return (
        "You are describing a specific feature or detail in a text-based game world as it tastes — flavour, texture in the mouth, aftertaste. " +
        "Write in second-person present-tense in 1-3 sentences, drawing from the room brief. " +
        "If tasting it would be implausible or inadvisable, respond naturally with a short message."
      );
    }
    // look (default)
    return (
      "You are describing a specific feature or detail that a player is examining in a text-based game world. " +
      "Write an atmospheric, second-person present-tense description in 1-3 sentences. " +
      "Focus on the specific thing the player is looking at, drawing from the room brief. " +
      "If the brief contains a bracketed section matching the target, use those details. " +
      "If the target is something plausibly present but not specifically detailed, describe it briefly using context from the brief. " +
      "If the target is not something that could reasonably be in this room, respond with a short, natural message indicating there's nothing notable to see."
    );
  }

  buildTargetUserPrompt(context: RoomContext, target: string, entity?: MatchedEntity): string {
    const lines = [
      `Room: ${context.roomName}`,
      `Brief: ${context.roomBrief}`,
      `Time: ${context.timeOfDay}`,
      `Moon: ${context.moonPhase}, ${context.moonAboveHorizon ? "above horizon" : "below horizon"}`,
      formatWeatherLine(context),
      `Target: ${target}`,
    ];

    if (entity) {
      const parts: string[] = [];
      if (entity.short) parts.push(`description: ${entity.short}`);
      if (entity.presence) parts.push(`presence: ${entity.presence}`);
      if (entity.playerName) parts.push(`name: ${entity.playerName}`);
      if (parts.length > 0) lines.push(`Entity data: ${parts.join(", ")}`);
    }

    return lines.join("\n");
  }

  buildUserPrompt(context: RoomContext): string {
    const visitLabel = context.isFirstVisit ? "first visit" : "returning";

    const presentParts: string[] = [
      ...context.entitiesPresent.map((e) => `${e.name}: ${e.description}`),
      ...context.otherPlayers.map((name) => `${name} (player)`),
    ];
    const presentLine =
      presentParts.length > 0 ? presentParts.join(", ") : "empty";

    const lines = [
      `Room: ${context.roomName}`,
      `Brief: ${context.roomBrief}`,
      `Time: ${context.timeOfDay}`,
      `Moon: ${context.moonPhase}, ${context.moonAboveHorizon ? "above horizon" : "below horizon"}`,
      formatWeatherLine(context),
      `Visit: ${visitLabel}`,
      `Present: ${presentLine}`,
    ];

    if (context.exits && Object.keys(context.exits).length > 0) {
      const exitParts = Object.entries(context.exits)
        .map(([dir, name]) => `${dir} → ${name}`)
        .join(", ");
      lines.push(`Exits: ${exitParts}`);
    }

    return lines.join("\n");
  }
}
