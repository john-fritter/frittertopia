import type { Intent, VerbHelpData } from "./Parser.js";
import { Parser } from "./Parser.js";
import type { World } from "./World.js";
import {
  handleMove,
  handleLook,
  handleSense,
  handleSay,
  handleHelp,
  handleWhere,
} from "./verbs/gameplay.js";
import {
  handleAdminDestroy,
  handleAdminInspect,
  handleAdminTeleport,
  handleAdminPlayers,
  handleAdminTime,
  handleAdminWeather,
  handleAdminTemperature,
  handleAdminPressure,
  handleAdminSysinfo,
  handleAdminPrompt,
  handleAdminLlm,
  handleAdminBrief,
  handleAdminBriefs,
  handleAdminHelp,
} from "./verbs/admin.js";
import { formatSystem } from "../server/format.js";

export interface ActionResult {
  toPlayer: string;
  toRoom?: { roomId: string; text: string; excludePlayer?: string };
  toOtherRoom?: { roomId: string; text: string };
}

export class ActionResolver {
  private parser: Parser;
  private readonly startTime = Date.now();

  constructor(private world: World, parser?: Parser) {
    this.parser = parser ?? new Parser();
    this.registerVerbs();
  }

  private registerVerbs(): void {
    this.parser.registerVerb("move", {
      aliases: ["go"],
      description: "Move in a direction",
      usage: "north, south, east, west, up, down, go <direction>",
      category: "movement",
    });
    this.parser.registerVerb("look", {
      aliases: ["l", "examine", "x"],
      description: "Look around the room or examine something specific",
      usage: "look, look at <target>, examine <target>, l, x",
      category: "interaction",
    });
    this.parser.registerVerb("listen", {
      aliases: [],
      description: "Listen to the room or a specific target",
      usage: "listen, listen to <target>",
      category: "senses",
    });
    this.parser.registerVerb("smell", {
      aliases: ["sniff"],
      description: "Smell the room or a specific target",
      usage: "smell, smell <target>",
      category: "senses",
    });
    this.parser.registerVerb("touch", {
      aliases: ["feel"],
      description: "Touch a specific target",
      usage: "touch <target>, feel <target>",
      category: "senses",
    });
    this.parser.registerVerb("taste", {
      aliases: [],
      description: "Taste a specific target",
      usage: "taste <target>",
      category: "senses",
    });
    this.parser.registerVerb("where", {
      aliases: [],
      description: "Survey the room: short description, exits, who and what is here",
      usage: "where",
      category: "senses",
    });
    this.parser.registerVerb("say", {
      aliases: ["'"],
      description: "Say something out loud",
      usage: "say <message>, '<message>",
      category: "communication",
    });
    this.parser.registerVerb("help", {
      aliases: ["?", "commands"],
      description: "Get help with commands",
      usage: "help, help <command>, help <category>",
      category: "system",
    });
    this.parser.registerVerb("@players",     { isAdmin: true, description: "List all players with status and location", usage: "@players" });
    this.parser.registerVerb("@destroy",     { isAdmin: true, description: "Remove a player and their data",             usage: "@destroy <player>" });
    this.parser.registerVerb("@inspect",     { isAdmin: true, description: "Show all component data for an entity",      usage: "@inspect <target>" });
    this.parser.registerVerb("@teleport",    { isAdmin: true, description: "Move to any room",                           usage: "@teleport <room-id>" });
    this.parser.registerVerb("@time",        { isAdmin: true, description: "Show or set the debug time",                 usage: "@time [bracket|HH:MM|reset]" });
    this.parser.registerVerb("@weather",     { isAdmin: true, description: "Show or override precipitation state",       usage: "@weather [state|reset]" });
    this.parser.registerVerb("@temperature", { isAdmin: true, description: "Show or override temperature",               usage: "@temperature [bracket|\u00b0C|reset]" });
    this.parser.registerVerb("@pressure",    { isAdmin: true, description: "Show or override barometric pressure",       usage: "@pressure [mb|reset]" });
    this.parser.registerVerb("@sysinfo",     { isAdmin: true, description: "Show ticks, uptime, entity counts",          usage: "@sysinfo" });
    this.parser.registerVerb("@prompt",      { isAdmin: true, description: "Show the last LLM prompt sent",              usage: "@prompt" });
    this.parser.registerVerb("@llm",         { isAdmin: true, description: "Toggle inline LLM prompt display",           usage: "@llm [on|off]" });
    this.parser.registerVerb("@brief",       { isAdmin: true, description: "Show character roll and brief for a player", usage: "@brief [player]" });
    this.parser.registerVerb("@briefs",      { isAdmin: true, description: "Show all player briefs in current room",     usage: "@briefs" });
    this.parser.registerVerb("@as",          { isAdmin: true, description: "Run a command as another player",            usage: "@as <player> <command>" });
    this.parser.registerVerb("@help",        { isAdmin: true, description: "Show this list",                             usage: "@help" });
  }

  async resolve(intent: Intent, playerId: string): Promise<ActionResult> {
    const sequence = this.world.getComponent(playerId, "Sequence") as
      | { deflectMessage: string }
      | undefined;
    if (sequence) {
      return { toPlayer: formatSystem(sequence.deflectMessage) };
    }

    const rawInput = intent.rawInput ?? (intent.target ? `${intent.verb} ${intent.target}` : intent.verb);

    switch (intent.verb) {
      case "move":
        return await handleMove(this.world, intent.target, playerId);
      case "look":
        return await handleLook(this.world, rawInput, intent.target, playerId);
      case "listen":
        return await handleSense(this.world, rawInput, intent.target, playerId, "listen");
      case "smell":
        return await handleSense(this.world, rawInput, intent.target, playerId, "smell");
      case "touch":
        return await handleSense(this.world, rawInput, intent.target, playerId, "touch");
      case "taste":
        return await handleSense(this.world, rawInput, intent.target, playerId, "taste");
      case "where":
        return handleWhere(this.world, playerId);
      case "say":
        return handleSay(this.world, intent.target, playerId);
      case "help":
        return handleHelp(this.parser, intent.target);
      case "@destroy":
        return await this.adminGate(playerId, () =>
          handleAdminDestroy(this.world, intent.target, playerId)
        );
      case "@inspect":
        return await this.adminGate(playerId, () =>
          handleAdminInspect(this.world, intent.target, playerId)
        );
      case "@teleport":
        return await this.adminGate(playerId, () =>
          handleAdminTeleport(this.world, intent.target, playerId)
        );
      case "@help":
        return await this.adminGate(playerId, () => handleAdminHelp(this.parser, intent.target));
      case "@players":
        return await this.adminGate(playerId, () =>
          handleAdminPlayers(this.world, intent.target)
        );
      case "@time":
        return await this.adminGate(playerId, () =>
          handleAdminTime(this.world, intent.target)
        );
      case "@weather":
        return await this.adminGate(playerId, () =>
          handleAdminWeather(this.world, intent.target)
        );
      case "@temperature":
        return await this.adminGate(playerId, () =>
          handleAdminTemperature(this.world, intent.target)
        );
      case "@pressure":
        return await this.adminGate(playerId, () =>
          handleAdminPressure(this.world, intent.target)
        );
      case "@sysinfo":
        return await this.adminGate(playerId, () =>
          handleAdminSysinfo(this.world, this.startTime, intent.target)
        );
      case "@prompt":
        return await this.adminGate(playerId, () =>
          handleAdminPrompt(this.world, intent.target)
        );
      case "@llm":
        return await this.adminGate(playerId, () =>
          handleAdminLlm(this.world, intent.target)
        );
      case "@brief":
        return await this.adminGate(playerId, () =>
          handleAdminBrief(this.world, intent.target, playerId)
        );
      case "@briefs":
        return await this.adminGate(playerId, () =>
          handleAdminBriefs(this.world, intent.target, playerId)
        );
      case "@as": {
        return await this.adminGate(playerId, async () => {
          const t = intent.target;
          if (!t) return { toPlayer: formatSystem("Usage: @as <player> <command>") };
          const spaceIdx = t.indexOf(" ");
          if (spaceIdx < 0) return { toPlayer: formatSystem("Usage: @as <player> <command>") };
          const targetName = t.slice(0, spaceIdx);
          const subInput = t.slice(spaceIdx + 1).trim();
          if (!subInput) return { toPlayer: formatSystem("Usage: @as <player> <command>") };

          const playerIds = this.world.getEntitiesWithComponent("Player");
          let targetId: string | undefined;
          for (const id of playerIds) {
            const p = this.world.getComponent(id, "Player") as { name: string } | undefined;
            if (p?.name.toLowerCase() === targetName.toLowerCase()) {
              targetId = id;
              break;
            }
          }
          if (!targetId) return { toPlayer: formatSystem(`No player found: ${targetName}`) };

          const subIntent = this.parser.parse(subInput);
          const result = await this.resolve(subIntent, targetId);
          return { toPlayer: `[as ${targetName}]\n${result.toPlayer}` };
        });
      }
      default:
        return { toPlayer: "I don't understand that." };
    }
  }

  private isAdmin(playerId: string): boolean {
    return this.world.getComponent(playerId, "Admin") !== undefined;
  }

  private async adminGate(
    playerId: string,
    handler: () => ActionResult | Promise<ActionResult>
  ): Promise<ActionResult> {
    if (!this.isAdmin(playerId)) {
      return { toPlayer: "You don't have permission to do that." };
    }
    return await handler();
  }
}
