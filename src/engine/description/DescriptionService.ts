import type { World } from "../World.js";
import { ContextBuilder } from "./ContextBuilder.js";
import { DescriptionCache } from "./DescriptionCache.js";
import { PromptBuilder } from "./PromptBuilder.js";

export class DescriptionService {
  private readonly contextBuilder: ContextBuilder;
  private readonly promptBuilder: PromptBuilder;
  readonly cache: DescriptionCache;

  constructor(private world: World) {
    this.contextBuilder = new ContextBuilder(world);
    this.promptBuilder = new PromptBuilder();
    this.cache = new DescriptionCache();
  }

  async describeRoom(roomId: string, playerId: string): Promise<string> {
    const cached = this.cache.get(playerId, roomId);
    if (cached !== null) return cached;

    const ctx = this.contextBuilder.buildContext(roomId, playerId);
    const systemPrompt = this.promptBuilder.buildSystemPrompt();
    const userPrompt = this.promptBuilder.buildUserPrompt(ctx);

    let result;
    try {
      result = await this.world.llm.generate(systemPrompt, userPrompt);
    } catch {
      return this.fallback(ctx);
    }

    if (result.ok) {
      this.cache.set(playerId, roomId, result.text);
      return result.text;
    }

    return this.fallback(ctx);
  }

  private fallback(ctx: { roomName: string; roomShort: string }): string {
    const name = ctx.roomName.toLowerCase();
    return `The shapes of ${name} surround you, but the details won't quite resolve. The rest is fog.`;
  }
}
