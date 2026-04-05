import type { RoomContext } from "./ContextBuilder.js";

export class PromptBuilder {
  buildSystemPrompt(): string {
    return (
      "You are describing rooms in a text-based game world. " +
      "Write atmospheric, second-person present-tense descriptions in 2-4 sentences. " +
      "Describe only what is documented in the room brief. " +
      "You may embellish sensory details — light, texture, sound, smell — but never invent objects, exits, characters, or anything a player could interact with. " +
      "If other entities are present, weave their presence into the description naturally."
    );
  }

  buildTargetSystemPrompt(): string {
    return (
      "You are describing a specific feature or detail that a player is examining in a text-based game world. " +
      "Write an atmospheric, second-person present-tense description in 1-3 sentences. " +
      "Focus on the specific thing the player is looking at, drawing from the room brief. " +
      "If the brief contains a bracketed section matching the target, use those details. " +
      "If the target is something plausibly present but not specifically detailed, describe it briefly using context from the brief. " +
      "If the target is not something that could reasonably be in this room, respond with a short, natural message indicating there's nothing notable to see."
    );
  }

  buildTargetUserPrompt(context: RoomContext, target: string): string {
    const lines = [
      `Room: ${context.roomName}`,
      `Brief: ${context.roomBrief}`,
      `Time: ${context.timeOfDay}`,
      `Weather: ${context.weather}`,
      `Target: ${target}`,
    ];

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
      `Weather: ${context.weather}`,
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
