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
