import type { Intent, VerbHelpData } from "./Parser.js";
import { Parser } from "./Parser.js";
import type { World } from "./World.js";
import type { MatchedEntity } from "./description/DescriptionService.js";
import {
  formatRoom,
  formatSelfSay,
  formatSay,
  formatArrival,
  formatDeparture,
  formatSystem,
  formatBold,
  formatCyan,
  formatDim,
  type RoomData,
  type RoomExit,
} from "../server/format.js";
import {
  setDebugTime,
  getDebugTime,
  getCurrentTime,
  getTimeBracket,
  getMoonData,
  getBracketMidpoints,
  makeBendLocalTime,
  type TimeBracket,
} from "../game/solar.js";
import {
  setDebugPrecipState,
  getDebugPrecipState,
  setDebugTempC,
  getDebugTempC,
  setDebugPressureMb,
  getDebugPressureMb,
  computeTempBracket,
  computePressureTrend,
  celsiusToFahrenheit,
  type PrecipState,
} from "../game/weather.js";

export interface ActionResult {
  toPlayer: string;
  toRoom?: { roomId: string; text: string; excludePlayer?: string };
  toOtherRoom?: { roomId: string; text: string };
}

const CATEGORY_ORDER = ["movement", "interaction", "senses", "communication", "system"];
const CATEGORY_NAMES: Record<string, string> = {
  movement: "Movement",
  interaction: "Interaction",
  senses: "Senses",
  communication: "Communication",
  system: "System",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      usage: "touch <target>",
      category: "senses",
    });
    this.parser.registerVerb("taste", {
      aliases: [],
      description: "Taste a specific target",
      usage: "taste <target>",
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
      description: "Learn about available commands",
      usage: "help, help <command>, help <category>",
      category: "system",
    });

    // Admin commands — no metadata so they don't appear in help
    this.parser.registerVerb("@destroy");
    this.parser.registerVerb("@inspect");
    this.parser.registerVerb("@teleport");
    this.parser.registerVerb("@help");
    this.parser.registerVerb("@players");
    this.parser.registerVerb("@time");
    this.parser.registerVerb("@weather");
    this.parser.registerVerb("@temperature");
    this.parser.registerVerb("@pressure");
    this.parser.registerVerb("@sysinfo");
    this.parser.registerVerb("@prompt");
    this.parser.registerVerb("@llm");
  }

  async resolve(intent: Intent, playerId: string): Promise<ActionResult> {
    const sequence = this.world.getComponent(playerId, "Sequence") as
      | { deflectMessage: string }
      | undefined;
    if (sequence) {
      return { toPlayer: formatSystem(sequence.deflectMessage) };
    }

    switch (intent.verb) {
      case "move":
        return await this.handleMove(intent.target, playerId);
      case "look":
        return await this.handleLook(intent.target, playerId);
      case "listen":
        return await this.handleSense(intent.target, playerId, "listen");
      case "smell":
        return await this.handleSense(intent.target, playerId, "smell");
      case "touch":
        return await this.handleSense(intent.target, playerId, "touch");
      case "taste":
        return await this.handleSense(intent.target, playerId, "taste");
      case "say":
        return this.handleSay(intent.target, playerId);
      case "help":
        return this.handleHelp(intent.target);
      case "@destroy":
        return await this.adminGate(playerId, () =>
          this.handleAdminDestroy(intent.target, playerId)
        );
      case "@inspect":
        return await this.adminGate(playerId, () =>
          this.handleAdminInspect(intent.target, playerId)
        );
      case "@teleport":
        return await this.adminGate(playerId, () =>
          this.handleAdminTeleport(intent.target, playerId)
        );
      case "@help":
        return await this.adminGate(playerId, () => this.handleAdminHelp(intent.target));
      case "@players":
        return await this.adminGate(playerId, () =>
          this.handleAdminPlayers(intent.target)
        );
      case "@time":
        return await this.adminGate(playerId, () =>
          this.handleAdminTime(intent.target)
        );
      case "@weather":
        return await this.adminGate(playerId, () =>
          this.handleAdminWeather(intent.target)
        );
      case "@temperature":
        return await this.adminGate(playerId, () =>
          this.handleAdminTemperature(intent.target)
        );
      case "@pressure":
        return await this.adminGate(playerId, () =>
          this.handleAdminPressure(intent.target)
        );
      case "@sysinfo":
        return await this.adminGate(playerId, () => this.handleAdminSysinfo(intent.target));
      case "@prompt":
        return await this.adminGate(playerId, () => this.handleAdminPrompt(intent.target));
      case "@llm":
        return await this.adminGate(playerId, () =>
          this.handleAdminLlm(intent.target)
        );
      default:
        return { toPlayer: "I don't understand that." };
    }
  }

  private async handleMove(
    direction: string | undefined,
    playerId: string
  ): Promise<ActionResult> {
    if (!direction) return { toPlayer: "Go where?" };

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    const exits = this.world.getComponent(position.roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;
    if (!exits || !(direction in exits.exits)) {
      return { toPlayer: "You can't go that way." };
    }

    const newRoomId = exits.exits[direction]!;
    const oldRoomId = position.roomId;

    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    const playerName = player?.name ?? "Someone";

    // Move the player
    this.world.setComponent(playerId, "Position", { roomId: newRoomId });

    // Build the look output BEFORE marking visited (first visit gets long desc)
    const lookOutput = await this.composeLook(newRoomId, playerId);

    // Now mark the new room as visited
    this.markVisited(playerId, newRoomId);

    return {
      toPlayer: lookOutput,
      toRoom: {
        roomId: oldRoomId,
        text: formatDeparture(playerName, direction),
        excludePlayer: playerId,
      },
      toOtherRoom: {
        roomId: newRoomId,
        text: formatArrival(playerName),
      },
    };
  }

  private async handleLook(
    target: string | undefined,
    playerId: string
  ): Promise<ActionResult> {
    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    if (!target) {
      // Explicit look always shows long description
      return { toPlayer: await this.composeLook(position.roomId, playerId, true) };
    }

    const entity = this.matchEntityInRoom(target, position.roomId);
    const description = await this.world.description.describeTarget(
      position.roomId,
      playerId,
      target,
      entity
    );
    let output = description;
    if (this.world.description.debugMode && this.world.description.lastPrompt) {
      output += "\n\n" + this.formatPromptBlock(this.world.description.lastPrompt);
    }
    return { toPlayer: output };
  }

  private async handleSense(
    target: string | undefined,
    playerId: string,
    sense: "listen" | "smell" | "touch" | "taste"
  ): Promise<ActionResult> {
    if (!target && sense === "touch") return { toPlayer: "Touch what?" };
    if (!target && sense === "taste") return { toPlayer: "You're not going to taste the room." };

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    const roomId = position.roomId;

    if (!target) {
      const text = await this.world.description.describeRoom(roomId, playerId, sense);
      return { toPlayer: text };
    }

    const entity = this.matchEntityInRoom(target, roomId);
    const text = await this.world.description.describeTarget(roomId, playerId, target, entity, sense);
    return { toPlayer: text };
  }

  private handleSay(
    message: string | undefined,
    playerId: string
  ): ActionResult {
    if (!message) return { toPlayer: "Say what?" };

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (!position) return { toPlayer: "You aren't anywhere." };

    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    const playerName = player?.name ?? "Someone";

    return {
      toPlayer: formatSelfSay(message),
      toRoom: {
        roomId: position.roomId,
        text: formatSay(playerName, message),
        excludePlayer: playerId,
      },
    };
  }

  async composeLook(roomId: string, playerId: string, forceLong = false): Promise<string> {
    const room = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    const desc = this.world.getComponent(roomId, "Description") as
      | { short: string }
      | undefined;
    const exits = this.world.getComponent(roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;

    const visitedRooms = this.getVisitedRooms(playerId);
    const hasVisited = visitedRooms.has(roomId);

    // First visit or explicit look → AI description; revisit → short
    let description: string;
    if (forceLong || !hasVisited) {
      description = await this.world.description.describeRoom(roomId, playerId);
    } else {
      description = desc?.short ?? "You see nothing special.";
    }

    // Build exits with room names for visited rooms only
    const exitList: RoomExit[] = [];
    if (exits) {
      for (const [direction, targetRoomId] of Object.entries(exits.exits)) {
        const exit: RoomExit = { direction };
        if (visitedRooms.has(targetRoomId)) {
          const targetRoom = this.world.getComponent(targetRoomId, "Room") as
            | { name: string }
            | undefined;
          if (targetRoom) {
            exit.roomName = targetRoom.name;
          }
        }
        exitList.push(exit);
      }
    }

    // Collect items and players in the room
    const items: string[] = [];
    const players: string[] = [];

    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      if (id === playerId) continue;
      if (id === roomId) continue;
      const pos = this.world.getComponent(id, "Position") as {
        roomId: string;
      };
      if (pos.roomId !== roomId) continue;

      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        items.push(presence.description);
        continue;
      }

      const otherPlayer = this.world.getComponent(id, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (otherPlayer && otherPlayer.sessionId) {
        players.push(otherPlayer.name);
      }
    }

    const roomData: RoomData = {
      name: room?.name ?? "Unknown Room",
      description,
      exits: exitList,
    };
    if (items.length > 0) roomData.items = items;
    if (players.length > 0) roomData.players = players;

    let output = formatRoom(roomData);
    if (this.world.description.debugMode && this.world.description.lastPrompt) {
      output += "\n\n" + this.formatPromptBlock(this.world.description.lastPrompt);
    }
    return output;
  }

  private handleHelp(target: string | undefined): ActionResult {
    const helpData = this.parser.getHelpData();

    if (!target) {
      return { toPlayer: this.formatHelpOverview(helpData) };
    }

    // Check if target matches a verb or alias
    const verb = helpData.find(
      (v) => v.verb === target || v.aliases.includes(target)
    );
    if (verb) {
      return { toPlayer: this.formatHelpDetail(verb) };
    }

    // Check if target matches a category
    const categoryVerbs = helpData.filter((v) => v.category === target);
    if (categoryVerbs.length > 0) {
      return {
        toPlayer: this.formatHelpCategory(target, categoryVerbs),
      };
    }

    return {
      toPlayer: formatDim(
        `Nothing known about '${target}'. Type 'help' for a list of commands.`
      ),
    };
  }

  private formatHelpOverview(helpData: VerbHelpData[]): string {
    const DESC_COL = 38;
    const lines: string[] = [];

    lines.push(formatBold("Available Commands"));
    lines.push(formatDim("─".repeat(18)));

    for (const cat of CATEGORY_ORDER) {
      const verbs = helpData.filter((v) => v.category === cat);
      if (verbs.length === 0) continue;

      lines.push("");
      lines.push(formatBold(CATEGORY_NAMES[cat] ?? cat));

      for (const verb of verbs) {
        const visiblePrefix = verb.verb.length + 3; // "  " + verb + " "
        const dotsNeeded = Math.max(3, DESC_COL - visiblePrefix - 3);
        const dots = ".".repeat(dotsNeeded);
        lines.push(
          `  ${formatCyan(verb.verb)} ${formatDim(dots)}   ${verb.description}`
        );
      }
    }

    lines.push("");
    lines.push(formatDim("Type 'help <command>' for details."));

    return lines.join("\n");
  }

  private formatHelpDetail(verb: VerbHelpData): string {
    const lines: string[] = [];
    lines.push(formatBold(verb.verb));
    lines.push(formatDim("─".repeat(verb.verb.length)));
    lines.push(verb.description + ".");
    lines.push("");
    lines.push(`Usage: ${formatCyan(verb.usage)}`);
    return lines.join("\n");
  }

  private formatHelpCategory(
    category: string,
    verbs: VerbHelpData[]
  ): string {
    const lines: string[] = [];
    lines.push(formatBold(CATEGORY_NAMES[category] ?? category));
    lines.push(formatDim("─".repeat((CATEGORY_NAMES[category] ?? category).length)));

    for (const verb of verbs) {
      lines.push("");
      lines.push(`  ${formatCyan(verb.verb)} — ${verb.description}`);
      lines.push(`  Usage: ${formatCyan(verb.usage)}`);
    }

    return lines.join("\n");
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

  private handleAdminDestroy(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    if (!target) return { toPlayer: formatDim("Usage: @destroy <player>") };

    if (target === "help") {
      return { toPlayer: [
        formatBold("@destroy — Remove a player entity from the world."),
        "",
        formatDim("  @destroy <player>    Destroy the named player and disconnect them"),
        "",
        formatDim("  Cannot destroy yourself. Player name is case-insensitive."),
      ].join("\n") };
    }

    // Find player by name (case-insensitive)
    const playerIds = this.world.getEntitiesWithComponent("Player");
    let targetId: string | undefined;
    let targetName: string | undefined;

    for (const id of playerIds) {
      const player = this.world.getComponent(id, "Player") as {
        name: string;
        sessionId: string;
      };
      if (player.name.toLowerCase() === target.toLowerCase()) {
        targetId = id;
        targetName = player.name;
        break;
      }
    }

    if (!targetId || !targetName) {
      return { toPlayer: formatDim(`No player found: ${target}`) };
    }

    if (targetId === playerId) {
      return { toPlayer: formatDim("You can't destroy yourself.") };
    }

    // Emit event so Server can disconnect the session
    this.world.emit("player_destroyed", { playerId: targetId });

    // Remove the entity from the world
    this.world.deleteEntity(targetId);

    return { toPlayer: formatDim(`Destroyed player: ${targetName}`) };
  }

  private handleAdminInspect(
    target: string | undefined,
    playerId: string
  ): ActionResult {
    if (!target) return { toPlayer: formatDim("Usage: @inspect <target>") };

    if (target === "help") {
      return { toPlayer: [
        formatBold("@inspect — Show all components and fields for any entity."),
        "",
        formatDim("  @inspect <player>      Inspect by player name"),
        formatDim("  @inspect <entity-key>  Inspect by entity string key (e.g. starting.room)"),
        "",
        formatDim("  Also matches entities by keyword in your current room."),
      ].join("\n") };
    }

    const entityId = this.resolveTarget(target, playerId);
    if (!entityId) {
      return { toPlayer: formatDim(`Nothing found: ${target}`) };
    }

    const key = this.world.entities.getKeyForEntity(entityId);
    const components = this.world.entities.getComponentsForEntity(entityId);

    const lines: string[] = [];
    const label = key ? `${key} / id: ${entityId}` : `id: ${entityId}`;
    lines.push(formatBold(`[Inspecting: ${target}]`) + `  (${label})`);
    lines.push(formatDim("─".repeat(24)));

    for (const [typeName, data] of components) {
      lines.push("");
      lines.push(formatBold(typeName));
      for (const [field, value] of Object.entries(data)) {
        this.renderInspectField(field, value, lines, "  ");
      }
    }

    return { toPlayer: lines.join("\n") };
  }

  private renderInspectField(
    field: string,
    value: unknown,
    lines: string[],
    indent: string
  ): void {
    if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${indent}${formatCyan(field)}:`);
      for (const line of value.split("\n")) {
        if (line.trim()) lines.push(`${indent}  ${line}`);
      }
    } else if (typeof value === "string" && UUID_RE.test(value)) {
      const refKey = this.world.entities.getKeyForEntity(value);
      const roomComp = refKey
        ? (this.world.getComponent(value, "Room") as { name: string } | undefined)
        : undefined;
      const hint = [refKey, roomComp?.name].filter(Boolean).join(" / ");
      lines.push(
        `${indent}${formatCyan(field)}: ${JSON.stringify(value)}` +
          (hint ? " " + formatDim(`(${hint})`) : "")
      );
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      lines.push(`${indent}${formatCyan(field)}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        this.renderInspectField(k, v, lines, `${indent}  `);
      }
    } else {
      lines.push(`${indent}${formatCyan(field)}: ${JSON.stringify(value)}`);
    }
  }

  private async handleAdminTeleport(
    target: string | undefined,
    playerId: string
  ): Promise<ActionResult> {
    if (!target) return { toPlayer: formatDim("Usage: @teleport <room-id>") };

    if (target === "help") {
      return { toPlayer: [
        formatBold("@teleport — Move instantly to any room."),
        "",
        formatDim("  @teleport <room-key>    Teleport to a room by its entity key"),
        "",
        formatDim("  Sends vanish/appear messages to old and new rooms."),
        formatDim("  Example: @teleport monastery.kitchen"),
      ].join("\n") };
    }

    const roomId = this.world.getEntityByKey(target);
    if (!roomId) {
      return { toPlayer: formatDim(`No room found: ${target}`) };
    }

    // Verify it's actually a room
    const room = this.world.getComponent(roomId, "Room");
    if (!room) {
      return { toPlayer: formatDim(`No room found: ${target}`) };
    }

    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    const oldRoomId = position?.roomId;

    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    const playerName = player?.name ?? "Someone";

    // Move the player
    this.world.setComponent(playerId, "Position", { roomId });
    this.markVisited(playerId, roomId);

    const lookOutput = await this.composeLook(roomId, playerId, true);

    const result: ActionResult = { toPlayer: lookOutput };

    if (oldRoomId) {
      result.toRoom = {
        roomId: oldRoomId,
        text: formatDim(`${playerName} vanishes.`),
        excludePlayer: playerId,
      };
    }

    result.toOtherRoom = {
      roomId,
      text: formatDim(`${playerName} appears.`),
    };

    return result;
  }

  private handleAdminPlayers(target: string | undefined): ActionResult {
    if (target === "help") {
      return { toPlayer: [
        formatBold("@players — List all player entities with status and location."),
        "",
        formatDim("  @players    Show all players, sorted online-first then alphabetically"),
        "",
        formatDim("  Shows: name, online/offline status, current room name"),
      ].join("\n") };
    }

    const playerIds = this.world.getEntitiesWithComponent("Player");

    let online = 0;
    let offline = 0;
    const rows: Array<{ name: string; status: string; room: string }> = [];

    for (const id of playerIds) {
      const player = this.world.getComponent(id, "Player") as {
        name: string;
        sessionId: string;
      };
      const isOnline = player.sessionId !== "";
      if (isOnline) online++; else offline++;

      const pos = this.world.getComponent(id, "Position") as
        | { roomId: string }
        | undefined;
      let roomLabel = "—";
      if (pos) {
        const roomKey = this.world.entities.getKeyForEntity(pos.roomId);
        const roomComp = this.world.getComponent(pos.roomId, "Room") as
          | { name: string }
          | undefined;
        roomLabel = roomComp?.name ?? roomKey ?? pos.roomId;
      }

      rows.push({
        name: player.name,
        status: isOnline ? "online" : "offline",
        room: roomLabel,
      });
    }

    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const lines: string[] = [];
    const summary = `${online} online · ${offline} offline`;
    lines.push(formatBold("Players") + formatDim(`  (${summary})`));
    lines.push(formatDim("─".repeat(40)));

    if (rows.length === 0) {
      lines.push(formatDim("  No players."));
    } else {
      const nameW = Math.max(8, ...rows.map((r) => r.name.length)) + 2;
      const statusW = 8;
      for (const row of rows) {
        const namePad = row.name.padEnd(nameW);
        const statusPad = row.status.padEnd(statusW);
        const statusFmt =
          row.status === "online"
            ? formatCyan(statusPad)
            : formatDim(statusPad);
        lines.push(`  ${formatBold(namePad)}${statusFmt}${row.room}`);
      }
    }

    return { toPlayer: lines.join("\n") };
  }

  private handleAdminTime(target: string | undefined): ActionResult {
    if (!target) {
      const now = getCurrentTime();
      const bracket = getTimeBracket();
      const timeStr = now.toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      if (getDebugTime()) {
        return {
          toPlayer:
            formatDim(`Time: ${bracket}`) +
            `  ${formatDim(`(${timeStr} Bend time — debug override)`)}`,
        };
      }
      return { toPlayer: formatDim(`Time: ${bracket}  (${timeStr} Bend time)`) };
    }

    if (target === "help") {
      return { toPlayer: [
        formatBold("@time — Show or set the game world debug time."),
        "",
        formatDim("  @time              Show current bracket and Bend clock time"),
        formatDim("  @time <bracket>    Jump to the midpoint of a time bracket"),
        formatDim("  @time HH:MM        Set a specific time (00:00–23:59)"),
        formatDim("  @time reset        Clear debug override, restore real clock"),
        "",
        formatDim("  Brackets: deep_night, night, dawn, morning, midday, afternoon, dusk, evening"),
      ].join("\n") };
    }

    const arg = target.trim().toLowerCase();

    if (arg === "clear" || arg === "reset") {
      setDebugTime(null);
      this.syncWorldTime();
      this.world.description.cache.invalidateAll();
      const bracket = getTimeBracket();
      return { toPlayer: formatDim(`Time cleared — real clock restored (${bracket})`) };
    }

    // Try bracket name
    const BRACKET_NAMES: TimeBracket[] = [
      "deep_night", "night", "dawn", "morning",
      "midday", "afternoon", "dusk", "evening",
    ];
    if (BRACKET_NAMES.includes(arg as TimeBracket)) {
      const midpoints = getBracketMidpoints();
      const t = midpoints[arg as TimeBracket];
      if (!t) {
        return { toPlayer: formatDim(`Bracket '${arg}' doesn't occur today (astronomical conditions).`) };
      }
      setDebugTime(t);
      this.syncWorldTime();
      this.world.description.cache.invalidateAll();
      const timeStr = t.toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return { toPlayer: formatDim(`Time set: ${arg}  (${timeStr} Bend time)`) };
    }

    // Try HH:MM
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(arg);
    if (timeMatch) {
      const hh = parseInt(timeMatch[1]!, 10);
      const mm = parseInt(timeMatch[2]!, 10);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return { toPlayer: formatDim("Invalid time. Use HH:MM (00:00–23:59).") };
      }
      const t = makeBendLocalTime(hh, mm);
      setDebugTime(t);
      this.syncWorldTime();
      this.world.description.cache.invalidateAll();
      const bracket = getTimeBracket(t);
      return { toPlayer: formatDim(`Time set: ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} Bend time  (${bracket})`) };
    }

    const brackets = BRACKET_NAMES.join(", ");
    return {
      toPlayer: formatDim(`Usage: @time [${brackets} | HH:MM | reset]`),
    };
  }

  private syncWorldTime(): void {
    const timeEntityId = this.world.getEntityByKey("world.time");
    if (!timeEntityId) return;
    const now = getDebugTime() ?? new Date();
    const bracket = getTimeBracket(now);
    const moon = getMoonData(now);
    this.world.setComponent(timeEntityId, "TimeOfDay", {
      bracket,
      moonFraction: moon.fraction,
      moonPhase: moon.phase,
      updatedAt: now.toISOString(),
    });
  }

  private syncWeatherState(): void {
    const zoneIds = this.world.getEntitiesWithComponent("WeatherZone");
    for (const zoneId of zoneIds) {
      const state = this.world.getComponent(zoneId, "WeatherState") as
        | {
            tempC: number;
            pressureMb: number;
            precipState: PrecipState;
            precipStateElapsedMs: number;
            precipStateDurationMs: number;
            tempNoise: number;
            pressureNoise: number;
            pressureHistory: { time: number; value: number }[];
            snowDepth: number;
          }
        | undefined;
      if (!state) continue;
      const debugPrec = getDebugPrecipState();
      this.world.setComponent(zoneId, "WeatherState", {
        ...state,
        tempC: getDebugTempC() ?? state.tempC,
        pressureMb: getDebugPressureMb() ?? state.pressureMb,
        precipState: debugPrec ?? state.precipState,
        precipStateElapsedMs: debugPrec ? 0 : state.precipStateElapsedMs,
      });
    }
    this.world.description.cache.invalidateAll();
  }

  private handleAdminWeather(target: string | undefined): ActionResult {
    const PRECIP_STATES: PrecipState[] = [
      "clear", "overcast", "rain", "storm", "snow", "fog", "sleet",
    ];

    if (!target) {
      const override = getDebugPrecipState();
      const zoneIds = this.world.getEntitiesWithComponent("WeatherZone");
      if (zoneIds.length === 0) {
        return { toPlayer: formatDim("No weather zones loaded.") };
      }
      const lines: string[] = [];
      for (const zoneId of zoneIds) {
        const zone = this.world.getComponent(zoneId, "WeatherZone") as
          | { climate: string }
          | undefined;
        const state = this.world.getComponent(zoneId, "WeatherState") as
          | { precipState: PrecipState }
          | undefined;
        const zoneName = zone?.climate ?? zoneId;
        const precipStr = state?.precipState ?? "unknown";
        lines.push(`  ${formatBold(zoneName)}: ${precipStr}`);
      }
      if (override) {
        lines.push(formatDim(`(debug override: ${override})`));
      } else {
        lines.push(formatDim("(real simulation)"));
      }
      return { toPlayer: lines.join("\n") };
    }

    if (target === "help") {
      return { toPlayer: [
        formatBold("@weather — Show or override precipitation state."),
        "",
        formatDim("  @weather              Show current state for all weather zones"),
        formatDim("  @weather <state>      Set precipitation override"),
        formatDim("  @weather reset        Clear override, restore simulation"),
        "",
        formatDim("  States: clear, overcast, rain, storm, snow, fog, sleet"),
      ].join("\n") };
    }

    const arg = target.trim().toLowerCase();

    if (arg === "clear" || arg === "reset") {
      setDebugPrecipState(null);
      this.syncWeatherState();
      const zoneIds = this.world.getEntitiesWithComponent("WeatherZone");
      const firstState = zoneIds.length > 0
        ? (this.world.getComponent(zoneIds[0]!, "WeatherState") as { precipState: PrecipState } | undefined)
        : undefined;
      const current = firstState?.precipState ?? "unknown";
      return { toPlayer: formatDim(`Weather override cleared — simulation restored (${current})`) };
    }

    if (PRECIP_STATES.includes(arg as PrecipState)) {
      setDebugPrecipState(arg as PrecipState);
      this.syncWeatherState();
      return { toPlayer: formatDim(`Weather set: ${arg}`) };
    }

    return {
      toPlayer: formatDim(`Usage: @weather [${PRECIP_STATES.join(" | ")} | reset]`),
    };
  }

  private handleAdminTemperature(target: string | undefined): ActionResult {
    const BRACKET_MIDPOINTS: Record<string, number> = {
      frigid: -15,
      cold: -5,
      cool: 5,
      mild: 15,
      warm: 24,
      hot: 32,
    };

    if (!target) {
      const override = getDebugTempC();
      const zoneIds = this.world.getEntitiesWithComponent("WeatherZone");
      if (zoneIds.length === 0) {
        return { toPlayer: formatDim("No weather zones loaded.") };
      }
      const lines: string[] = [];
      for (const zoneId of zoneIds) {
        const zone = this.world.getComponent(zoneId, "WeatherZone") as
          | { climate: string }
          | undefined;
        const state = this.world.getComponent(zoneId, "WeatherState") as
          | { tempC: number }
          | undefined;
        const zoneName = zone?.climate ?? zoneId;
        if (state) {
          const bracket = computeTempBracket(state.tempC);
          const f = celsiusToFahrenheit(state.tempC).toFixed(1);
          lines.push(`  ${formatBold(zoneName)}: ${state.tempC.toFixed(1)}°C / ${f}°F  (${bracket})`);
        } else {
          lines.push(`  ${formatBold(zoneName)}: no data`);
        }
      }
      if (override !== null) {
        lines.push(formatDim(`(debug override: ${override.toFixed(1)}°C)`));
      } else {
        lines.push(formatDim("(real simulation)"));
      }
      return { toPlayer: lines.join("\n") };
    }

    if (target === "help") {
      return { toPlayer: [
        formatBold("@temperature — Show or override temperature."),
        "",
        formatDim("  @temperature              Show current temp for all weather zones"),
        formatDim("  @temperature <bracket>    Set temperature by bracket name"),
        formatDim("  @temperature <°C>         Set temperature as a numeric value"),
        formatDim("  @temperature reset        Clear override, restore simulation"),
        "",
        formatDim("  Brackets: frigid, cold, cool, mild, warm, hot"),
      ].join("\n") };
    }

    const arg = target.trim().toLowerCase();

    if (arg === "clear" || arg === "reset") {
      setDebugTempC(null);
      this.syncWeatherState();
      return { toPlayer: formatDim("Temperature override cleared — simulation restored") };
    }

    if (arg in BRACKET_MIDPOINTS) {
      const tempC = BRACKET_MIDPOINTS[arg]!;
      setDebugTempC(tempC);
      this.syncWeatherState();
      const f = celsiusToFahrenheit(tempC).toFixed(1);
      return { toPlayer: formatDim(`Temperature set: ${arg}  (${tempC}°C / ${f}°F)`) };
    }

    const parsed = parseFloat(arg);
    if (!isNaN(parsed) && /^-?\d+(\.\d+)?$/.test(arg)) {
      setDebugTempC(parsed);
      this.syncWeatherState();
      const bracket = computeTempBracket(parsed);
      const f = celsiusToFahrenheit(parsed).toFixed(1);
      return { toPlayer: formatDim(`Temperature set: ${parsed}°C / ${f}°F  (${bracket})`) };
    }

    const brackets = Object.keys(BRACKET_MIDPOINTS).join(" | ");
    return {
      toPlayer: formatDim(`Usage: @temperature [${brackets} | <°C> | reset]`),
    };
  }

  private handleAdminPressure(target: string | undefined): ActionResult {
    if (!target) {
      const override = getDebugPressureMb();
      const zoneIds = this.world.getEntitiesWithComponent("WeatherZone");
      if (zoneIds.length === 0) {
        return { toPlayer: formatDim("No weather zones loaded.") };
      }
      const lines: string[] = [];
      for (const zoneId of zoneIds) {
        const zone = this.world.getComponent(zoneId, "WeatherZone") as
          | { climate: string }
          | undefined;
        const state = this.world.getComponent(zoneId, "WeatherState") as
          | { pressureMb: number; pressureHistory: { time: number; value: number }[] }
          | undefined;
        const zoneName = zone?.climate ?? zoneId;
        if (state) {
          const trend = computePressureTrend(state.pressureHistory);
          lines.push(`  ${formatBold(zoneName)}: ${state.pressureMb.toFixed(1)} mb  (${trend})`);
        } else {
          lines.push(`  ${formatBold(zoneName)}: no data`);
        }
      }
      if (override !== null) {
        lines.push(formatDim(`(debug override: ${override.toFixed(1)} mb)`));
      } else {
        lines.push(formatDim("(real simulation)"));
      }
      return { toPlayer: lines.join("\n") };
    }

    if (target === "help") {
      return { toPlayer: [
        formatBold("@pressure — Show or override barometric pressure."),
        "",
        formatDim("  @pressure           Show current pressure for all weather zones"),
        formatDim("  @pressure <mb>      Set pressure in millibars (900–1100)"),
        formatDim("  @pressure reset     Clear override, restore simulation"),
        "",
        formatDim("  Typical range: 960–1040 mb"),
      ].join("\n") };
    }

    const arg = target.trim().toLowerCase();

    if (arg === "clear" || arg === "reset") {
      setDebugPressureMb(null);
      this.syncWeatherState();
      return { toPlayer: formatDim("Pressure override cleared — simulation restored") };
    }

    const parsed = parseFloat(arg);
    if (!isNaN(parsed) && /^\d+(\.\d+)?$/.test(arg)) {
      if (parsed < 900 || parsed > 1100) {
        return { toPlayer: formatDim("Pressure out of range. Use 900–1100 mb.") };
      }
      setDebugPressureMb(parsed);
      this.syncWeatherState();
      return { toPlayer: formatDim(`Pressure set: ${parsed} mb`) };
    }

    return {
      toPlayer: formatDim("Usage: @pressure [<mb> | reset]  (typical range 960–1040)"),
    };
  }

  private handleAdminSysinfo(target: string | undefined): ActionResult {
    if (target === "help") {
      return { toPlayer: [
        formatBold("@sysinfo — Show server and world statistics."),
        "",
        formatDim("  @sysinfo    Show ticks, uptime, entity counts, time, and LLM debug state"),
      ].join("\n") };
    }

    const uptimeMs = Date.now() - this.startTime;
    const totalSec = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const uptimeStr =
      minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;

    const allIds = this.world.entities.getAllEntityIds();
    const roomCount = this.world.getEntitiesWithComponent("Room").length;
    const playerIds = this.world.getEntitiesWithComponent("Player");
    const onlineCount = playerIds.filter((id) => {
      const p = this.world.getComponent(id, "Player") as { sessionId: string };
      return p.sessionId !== "";
    }).length;

    const bracket = getTimeBracket();
    const isDebug = getDebugTime() !== null;
    const bracketStr = bracket + (isDebug ? formatDim(" [debug]") : "");
    const llmDebug = this.world.description.debugMode ? "on" : "off";

    const COL = 16;
    const row = (label: string, value: string): string =>
      `  ${formatCyan(label.padEnd(COL))}${value}`;

    const lines: string[] = [
      formatBold("System"),
      formatDim("─".repeat(26)),
      row("ticks", String(this.world.getTickCount())),
      row("uptime", uptimeStr),
      row(
        "entities",
        `${allIds.length}  (${roomCount} rooms · ${playerIds.length} players)`
      ),
      row("online", `${onlineCount} / ${playerIds.length}`),
      row("time", bracketStr),
      row("llm debug", llmDebug),
    ];

    return { toPlayer: lines.join("\n") };
  }

  private handleAdminPrompt(target: string | undefined): ActionResult {
    if (target === "help") {
      return { toPlayer: [
        formatBold("@prompt — Show the most recent LLM prompt sent this session."),
        "",
        formatDim("  @prompt    Display the last system + user prompt sent to the LLM"),
        "",
        formatDim("  Resets each server restart. Use @llm on to see prompts inline."),
      ].join("\n") };
    }

    const p = this.world.description.lastPrompt;
    if (!p) {
      return { toPlayer: formatDim("No LLM prompt has been sent yet this session.") };
    }
    return { toPlayer: this.formatPromptBlock(p) };
  }

  private handleAdminLlm(target: string | undefined): ActionResult {
    if (target === "help") {
      return { toPlayer: [
        formatBold("@llm — Toggle inline LLM prompt display."),
        "",
        formatDim("  @llm        Show current debug mode state"),
        formatDim("  @llm on     Enable LLM debug mode (prompts shown with descriptions)"),
        formatDim("  @llm off    Disable LLM debug mode"),
      ].join("\n") };
    }

    const arg = target?.trim().toLowerCase();
    if (arg === "on") {
      this.world.description.setDebugMode(true);
      return { toPlayer: formatDim("LLM debug on — prompts will appear with each description.") };
    }
    if (arg === "off") {
      this.world.description.setDebugMode(false);
      return { toPlayer: formatDim("LLM debug off.") };
    }
    const state = this.world.description.debugMode ? "on" : "off";
    return { toPlayer: formatDim(`LLM debug mode: ${state}`) + (arg ? `  ${formatDim("(use @llm on / @llm off)")}` : "") };
  }

  private formatPromptBlock(p: { system: string; user: string; context: string }): string {
    const bar = formatDim("─".repeat(50));
    const lines = [
      formatBold("Last LLM Prompt") + formatDim(`  [${p.context}]`),
      bar,
      formatBold("SYSTEM"),
      "",
      p.system,
      "",
      formatBold("USER"),
      "",
      p.user,
      bar,
    ];
    return lines.join("\n");
  }

  private handleAdminHelp(target: string | undefined): ActionResult {
    if (target === "help") {
      return { toPlayer: [
        formatBold("@help — Show all admin commands."),
        "",
        formatDim("  @help    Display the full admin command reference"),
        "",
        formatDim("  Type @<command> help for details on any command."),
      ].join("\n") };
    }

    const DESC_COL = 38;
    const lines: string[] = [];

    lines.push(formatBold("Admin Commands"));
    lines.push(formatDim("─".repeat(14)));

    const commands = [
      { name: "@players", desc: "List all players with status and location" },
      { name: "@destroy <player>", desc: "Remove a player and their data" },
      { name: "@inspect <target>", desc: "Show all component data for an entity" },
      { name: "@teleport <room-id>", desc: "Move to any room" },
      { name: "@time [bracket|HH:MM|reset]", desc: "Show or set the debug time" },
      { name: "@weather [state|reset]", desc: "Show or override precipitation state" },
      { name: "@temperature [bracket|°C|reset]", desc: "Show or override temperature" },
      { name: "@pressure [mb|reset]", desc: "Show or override barometric pressure" },
      { name: "@sysinfo", desc: "Show ticks, uptime, entity counts" },
      { name: "@prompt", desc: "Show the last LLM prompt sent" },
      { name: "@llm [on|off]", desc: "Toggle inline LLM prompt display" },
      { name: "@help", desc: "Show this list" },
    ];

    lines.push("");
    for (const cmd of commands) {
      const visiblePrefix = cmd.name.length + 3;
      const dotsNeeded = Math.max(3, DESC_COL - visiblePrefix - 3);
      const dots = ".".repeat(dotsNeeded);
      lines.push(
        `  ${formatCyan(cmd.name)} ${formatDim(dots)}   ${cmd.desc}`
      );
    }

    lines.push("");
    lines.push(formatDim("Type @<command> help for more detail."));

    return { toPlayer: lines.join("\n") };
  }

  private resolveTarget(target: string, playerId: string): string | undefined {
    const lowerTarget = target.toLowerCase();

    // Check by entity key first
    const byKey = this.world.getEntityByKey(target);
    if (byKey) return byKey;

    // Check players by name
    const playerIds = this.world.getEntitiesWithComponent("Player");
    for (const id of playerIds) {
      const player = this.world.getComponent(id, "Player") as {
        name: string;
      };
      if (player.name.toLowerCase() === lowerTarget) {
        return id;
      }
    }

    // Check entities in the admin's room
    const position = this.world.getComponent(playerId, "Position") as
      | { roomId: string }
      | undefined;
    if (position) {
      const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
      for (const id of entitiesInRoom) {
        const pos = this.world.getComponent(id, "Position") as {
          roomId: string;
        };
        if (pos.roomId !== position.roomId) continue;

        const desc = this.world.getComponent(id, "Description") as
          | { short: string }
          | undefined;
        if (desc && desc.short.toLowerCase().includes(lowerTarget)) {
          return id;
        }
      }
    }

    return undefined;
  }

  private matchEntityInRoom(target: string, roomId: string): MatchedEntity | undefined {
    const ARTICLES = new Set(["the", "a", "an"]);
    const normalize = (s: string): string =>
      s.toLowerCase().split(/\s+/).filter((w) => !ARTICLES.has(w)).join(" ");

    const normalized = normalize(target);

    let bestMatch: MatchedEntity | undefined;
    let bestScore = 0;

    const entitiesInRoom = this.world.getEntitiesWithComponent("Position");
    for (const id of entitiesInRoom) {
      const pos = this.world.getComponent(id, "Position") as { roomId: string };
      if (pos.roomId !== roomId) continue;

      const desc = this.world.getComponent(id, "Description") as
        | { short: string }
        | undefined;
      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      const player = this.world.getComponent(id, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      const key = this.world.entities.getKeyForEntity(id);

      // Build candidate texts to match against
      const texts: string[] = [];
      if (desc) texts.push(normalize(desc.short));
      if (presence) texts.push(normalize(presence.description));
      if (player) texts.push(normalize(player.name));
      if (key) {
        // "monastery.rosemary-bush" → "rosemary bush"
        const keyLeaf = key.split(".").pop()?.replace(/-/g, " ") ?? "";
        texts.push(normalize(keyLeaf));
      }

      let score = 0;
      for (const text of texts) {
        if (text === normalized) {
          score = Math.max(score, 3); // exact
        } else if (text.includes(normalized)) {
          score = Math.max(score, 2); // substring
        } else if (normalized.split(/\s+/).some((w) => text.includes(w))) {
          score = Math.max(score, 1); // word overlap
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          ...(desc && { short: desc.short }),
          ...(presence && { presence: presence.description }),
          ...(player && { playerName: player.name }),
        };
      }
    }

    return bestMatch;
  }

  private getVisitedRooms(playerId: string): Set<string> {
    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    return new Set(visited?.rooms ?? []);
  }

  private markVisited(playerId: string, roomId: string): void {
    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    if (visited) {
      if (!visited.rooms.includes(roomId)) {
        this.world.setComponent(playerId, "VisitedRooms", {
          rooms: [...visited.rooms, roomId],
        });
      }
    } else {
      this.world.setComponent(playerId, "VisitedRooms", { rooms: [roomId] });
    }
  }
}
