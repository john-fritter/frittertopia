import type { RoomContext } from "./ContextBuilder.js";
import type { MatchedEntity } from "./DescriptionService.js";

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
  buildSystemPrompt(): string {
    return (
      "You are describing rooms in a text-based game world. " +
      "Write atmospheric, second-person present-tense descriptions in 2-4 sentences. " +
      "Describe only what is documented in the room brief. " +
      "You may embellish sensory details — light, texture, sound, smell — but never invent objects, exits, characters, or anything a player could interact with. " +
      "If other entities are present, weave their presence into the description naturally. " +
      "If the player's command specifies a sense (listen, smell, etc.), focus the description through that sense."
    );
  }

  buildTargetSystemPrompt(): string {
    return (
      "You are describing a specific feature or detail that a player is interacting with in a text-based game world. " +
      "Write an atmospheric, second-person present-tense description in 1-3 sentences. " +
      "Focus on the specific thing the player is engaging with, drawing from the room brief. " +
      "If the brief contains a bracketed section matching the target, use those details. " +
      "If the target is something plausibly present but not specifically detailed, describe it briefly using context from the brief. " +
      "If the player's command specifies a sense (listen, smell, touch, taste), describe the target through that sense. " +
      "If the interaction is implausible, respond with a short, natural message."
    );
  }

  buildTargetUserPrompt(context: RoomContext, target: string, entity?: MatchedEntity, command?: string): string {
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

    if (command) lines.push(`Command: ${command}`);

    return lines.join("\n");
  }

  buildUserPrompt(context: RoomContext, command?: string): string {
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

    if (command) lines.push(`Command: ${command}`);

    return lines.join("\n");
  }
}
