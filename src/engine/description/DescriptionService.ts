import type { World } from "../World.js";
import { ContextBuilder } from "./ContextBuilder.js";
import { promptBuilder } from "./PromptBuilder.js";

export interface StoredPrompt {
  system: string;
  user: string;
  context: string;
}

export class DescriptionService {
  private readonly contextBuilder: ContextBuilder;

  lastPrompt: StoredPrompt | null = null;
  debugMode = false;

  constructor(private world: World) {
    this.contextBuilder = new ContextBuilder(world);
  }

  setDebugMode(on: boolean): void {
    this.debugMode = on;
  }

  async describe(roomId: string, playerId: string, rawInput: string): Promise<string> {
    const ctx = this.contextBuilder.buildContext(roomId, playerId);
    const system = promptBuilder.buildSystemPrompt("describe-room");
    const user = promptBuilder.buildRoomUserPrompt(ctx, rawInput);

    this.lastPrompt = {
      system,
      user,
      context: `room: ${this.world.entities.getKeyForEntity(roomId) ?? roomId}`,
    };

    let result;
    try {
      result = await this.world.llm.generate(system, user);
    } catch {
      return this.fallback(ctx);
    }

    if (result.ok) return result.text;
    return this.fallback(ctx);
  }

  private fallback(ctx: { roomName: string }): string {
    const name = ctx.roomName.toLowerCase();
    return `The shapes of ${name} surround you, but the details won't quite resolve. The rest is fog.`;
  }
}
