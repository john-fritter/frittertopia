import type { World } from "../World.js";
import { ContextBuilder } from "./ContextBuilder.js";
import { DescriptionCache } from "./DescriptionCache.js";
import { PromptBuilder } from "./PromptBuilder.js";

export type Sense = "look" | "listen" | "smell" | "touch" | "taste";

export interface MatchedEntity {
  short?: string;
  presence?: string;
  playerName?: string;
}

export interface StoredPrompt {
  system: string;
  user: string;
  context: string;
}

export class DescriptionService {
  private readonly contextBuilder: ContextBuilder;
  private readonly promptBuilder: PromptBuilder;
  readonly cache: DescriptionCache;

  lastPrompt: StoredPrompt | null = null;
  debugMode = false;

  constructor(private world: World) {
    this.contextBuilder = new ContextBuilder(world);
    this.promptBuilder = new PromptBuilder();
    this.cache = new DescriptionCache();
  }

  setDebugMode(on: boolean): void {
    this.debugMode = on;
  }

  async describeRoom(roomId: string, playerId: string, sense: Sense = "look"): Promise<string> {
    const cached = this.cache.get(playerId, roomId, sense);
    if (cached !== null) return cached;

    const ctx = this.contextBuilder.buildContext(roomId, playerId);
    const systemPrompt = this.promptBuilder.buildSystemPrompt(sense);
    const userPrompt = this.promptBuilder.buildUserPrompt(ctx);

    this.lastPrompt = {
      system: systemPrompt,
      user: userPrompt,
      context: `room: ${this.world.entities.getKeyForEntity(roomId) ?? roomId}`,
    };

    let result;
    try {
      result = await this.world.llm.generate(systemPrompt, userPrompt);
    } catch {
      return this.fallback(ctx);
    }

    if (result.ok) {
      this.cache.set(playerId, roomId, sense, result.text);
      return result.text;
    }

    return this.fallback(ctx);
  }

  async describeTarget(
    roomId: string,
    playerId: string,
    target: string,
    entity?: MatchedEntity,
    sense: Sense = "look"
  ): Promise<string> {
    const ctx = this.contextBuilder.buildContext(roomId, playerId);
    const systemPrompt = this.promptBuilder.buildTargetSystemPrompt(sense);
    const userPrompt = this.promptBuilder.buildTargetUserPrompt(ctx, target, entity);

    this.lastPrompt = {
      system: systemPrompt,
      user: userPrompt,
      context: `target: ${target} in ${this.world.entities.getKeyForEntity(roomId) ?? roomId}`,
    };

    let result;
    try {
      result = await this.world.llm.generate(systemPrompt, userPrompt);
    } catch {
      return this.targetFallback(entity);
    }

    if (result.ok) {
      return result.text;
    }

    return this.targetFallback(entity);
  }

  private targetFallback(entity?: MatchedEntity): string {
    if (entity) {
      return entity.presence ?? entity.short ?? entity.playerName ?? "You don't see anything notable.";
    }
    return "You don't see anything notable.";
  }

  private fallback(ctx: { roomName: string; roomShort: string }): string {
    const name = ctx.roomName.toLowerCase();
    return `The shapes of ${name} surround you, but the details won't quite resolve. The rest is fog.`;
  }
}
