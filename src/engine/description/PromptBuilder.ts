import type { RoomContext } from "./ContextBuilder.js";

export class PromptBuilder {
  buildSystemPrompt(): string {
    return (
      "You are describing rooms in a text-based game world. " +
      "Write atmospheric, second-person present-tense descriptions in 2-3 sentences. " +
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

    return [
      `Room: ${context.roomName}`,
      `Brief: ${context.roomBrief}`,
      `Time: ${context.timeOfDay}`,
      `Weather: ${context.weather}`,
      `Visit: ${visitLabel}`,
      `Present: ${presentLine}`,
    ].join("\n");
  }
}
