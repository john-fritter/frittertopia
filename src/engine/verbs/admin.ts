import type { World } from "../World.js";
import type { ActionResult } from "../ActionResolver.js";
import type { Parser } from "../Parser.js";
import {
  formatBold,
  formatCyan,
  formatDim,
  formatSystem,
} from "../../server/format.js";
import {
  setDebugTime,
  getDebugTime,
  getCurrentTime,
  getTimeBracket,
  getMoonData,
  getBracketMidpoints,
  makeBendLocalTime,
  type TimeBracket,
} from "../../game/solar.js";
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
} from "../../game/weather.js";
import { composeLook, formatPromptBlock } from "./gameplay.js";
import { resolveTarget, markVisited } from "./helpers/entityMatching.js";
import { generateCharacterBrief } from "../../game/characterBriefGenerator.js";
import type { CharacterRoll } from "../../game/characterGenerator.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderInspectField(
  world: World,
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
    const refKey = world.entities.getKeyForEntity(value);
    const roomComp = refKey
      ? (world.getComponent(value, "Room") as { name: string } | undefined)
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
      renderInspectField(world, k, v, lines, `${indent}  `);
    }
  } else {
    lines.push(`${indent}${formatCyan(field)}: ${JSON.stringify(value)}`);
  }
}

function syncWorldTime(world: World): void {
  const timeEntityId = world.getEntityByKey("world.time");
  if (!timeEntityId) return;
  const now = getDebugTime() ?? new Date();
  const bracket = getTimeBracket(now);
  const moon = getMoonData(now);
  world.setComponent(timeEntityId, "TimeOfDay", {
    bracket,
    moonFraction: moon.fraction,
    moonPhase: moon.phase,
    updatedAt: now.toISOString(),
  });
}

function syncWeatherState(world: World): void {
  const zoneIds = world.getEntitiesWithComponent("WeatherZone");
  for (const zoneId of zoneIds) {
    const state = world.getComponent(zoneId, "WeatherState") as
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
    world.setComponent(zoneId, "WeatherState", {
      ...state,
      tempC: getDebugTempC() ?? state.tempC,
      pressureMb: getDebugPressureMb() ?? state.pressureMb,
      precipState: debugPrec ?? state.precipState,
      precipStateElapsedMs: debugPrec ? 0 : state.precipStateElapsedMs,
    });
  }
}

export function handleAdminDestroy(
  world: World,
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
  const playerIds = world.getEntitiesWithComponent("Player");
  let targetId: string | undefined;
  let targetName: string | undefined;

  for (const id of playerIds) {
    const player = world.getComponent(id, "Player") as {
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
  world.emit("player_destroyed", { playerId: targetId });

  // Remove the entity from the world
  world.deleteEntity(targetId);

  return { toPlayer: formatDim(`Destroyed player: ${targetName}`) };
}

export function handleAdminInspect(
  world: World,
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

  const entityId = resolveTarget(world, target, playerId);
  if (!entityId) {
    return { toPlayer: formatDim(`Nothing found: ${target}`) };
  }

  const key = world.entities.getKeyForEntity(entityId);
  const components = world.entities.getComponentsForEntity(entityId);

  const lines: string[] = [];
  const label = key ? `${key} / id: ${entityId}` : `id: ${entityId}`;
  lines.push(formatBold(`[Inspecting: ${target}]`) + `  (${label})`);
  lines.push(formatDim("─".repeat(24)));

  for (const [typeName, data] of components) {
    lines.push("");
    lines.push(formatBold(typeName));
    for (const [field, value] of Object.entries(data)) {
      renderInspectField(world, field, value, lines, "  ");
    }
  }

  return { toPlayer: lines.join("\n") };
}

export async function handleAdminTeleport(
  world: World,
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

  const roomId = world.getEntityByKey(target);
  if (!roomId) {
    return { toPlayer: formatDim(`No room found: ${target}`) };
  }

  // Verify it's actually a room
  const room = world.getComponent(roomId, "Room");
  if (!room) {
    return { toPlayer: formatDim(`No room found: ${target}`) };
  }

  const position = world.getComponent(playerId, "Position") as
    | { roomId: string }
    | undefined;
  const oldRoomId = position?.roomId;

  const player = world.getComponent(playerId, "Player") as
    | { name: string; sessionId: string }
    | undefined;
  const playerName = player?.name ?? "Someone";

  // Move the player
  world.setComponent(playerId, "Position", { roomId });
  markVisited(world, playerId, roomId);

  const lookOutput = await composeLook(world, roomId, playerId, true);

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

export function handleAdminPlayers(
  world: World,
  target: string | undefined
): ActionResult {
  if (target === "help") {
    return { toPlayer: [
      formatBold("@players — List all player entities with status and location."),
      "",
      formatDim("  @players    Show all players, sorted online-first then alphabetically"),
      "",
      formatDim("  Shows: name, online/offline status, current room name"),
    ].join("\n") };
  }

  const playerIds = world.getEntitiesWithComponent("Player");

  let online = 0;
  let offline = 0;
  const rows: Array<{ name: string; status: string; room: string }> = [];

  for (const id of playerIds) {
    const player = world.getComponent(id, "Player") as {
      name: string;
      sessionId: string;
    };
    const isOnline = player.sessionId !== "";
    if (isOnline) online++; else offline++;

    const pos = world.getComponent(id, "Position") as
      | { roomId: string }
      | undefined;
    let roomLabel = "—";
    if (pos) {
      const roomKey = world.entities.getKeyForEntity(pos.roomId);
      const roomComp = world.getComponent(pos.roomId, "Room") as
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

export function handleAdminTime(
  world: World,
  target: string | undefined
): ActionResult {
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
    syncWorldTime(world);
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
    syncWorldTime(world);
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
    syncWorldTime(world);
    const bracket = getTimeBracket(t);
    return { toPlayer: formatDim(`Time set: ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} Bend time  (${bracket})`) };
  }

  const brackets = BRACKET_NAMES.join(", ");
  return {
    toPlayer: formatDim(`Usage: @time [${brackets} | HH:MM | reset]`),
  };
}

export function handleAdminWeather(
  world: World,
  target: string | undefined
): ActionResult {
  const PRECIP_STATES: PrecipState[] = [
    "clear", "overcast", "rain", "storm", "snow", "fog", "sleet",
  ];

  if (!target) {
    const override = getDebugPrecipState();
    const zoneIds = world.getEntitiesWithComponent("WeatherZone");
    if (zoneIds.length === 0) {
      return { toPlayer: formatDim("No weather zones loaded.") };
    }
    const lines: string[] = [];
    for (const zoneId of zoneIds) {
      const zone = world.getComponent(zoneId, "WeatherZone") as
        | { climate: string }
        | undefined;
      const state = world.getComponent(zoneId, "WeatherState") as
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
    syncWeatherState(world);
    const zoneIds = world.getEntitiesWithComponent("WeatherZone");
    const firstState = zoneIds.length > 0
      ? (world.getComponent(zoneIds[0]!, "WeatherState") as { precipState: PrecipState } | undefined)
      : undefined;
    const current = firstState?.precipState ?? "unknown";
    return { toPlayer: formatDim(`Weather override cleared — simulation restored (${current})`) };
  }

  if (PRECIP_STATES.includes(arg as PrecipState)) {
    setDebugPrecipState(arg as PrecipState);
    syncWeatherState(world);
    return { toPlayer: formatDim(`Weather set: ${arg}`) };
  }

  return {
    toPlayer: formatDim(`Usage: @weather [${PRECIP_STATES.join(" | ")} | reset]`),
  };
}

export function handleAdminTemperature(
  world: World,
  target: string | undefined
): ActionResult {
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
    const zoneIds = world.getEntitiesWithComponent("WeatherZone");
    if (zoneIds.length === 0) {
      return { toPlayer: formatDim("No weather zones loaded.") };
    }
    const lines: string[] = [];
    for (const zoneId of zoneIds) {
      const zone = world.getComponent(zoneId, "WeatherZone") as
        | { climate: string }
        | undefined;
      const state = world.getComponent(zoneId, "WeatherState") as
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
    syncWeatherState(world);
    return { toPlayer: formatDim("Temperature override cleared — simulation restored") };
  }

  if (arg in BRACKET_MIDPOINTS) {
    const tempC = BRACKET_MIDPOINTS[arg]!;
    setDebugTempC(tempC);
    syncWeatherState(world);
    const f = celsiusToFahrenheit(tempC).toFixed(1);
    return { toPlayer: formatDim(`Temperature set: ${arg}  (${tempC}°C / ${f}°F)`) };
  }

  const parsed = parseFloat(arg);
  if (!isNaN(parsed) && /^-?\d+(\.\d+)?$/.test(arg)) {
    setDebugTempC(parsed);
    syncWeatherState(world);
    const bracket = computeTempBracket(parsed);
    const f = celsiusToFahrenheit(parsed).toFixed(1);
    return { toPlayer: formatDim(`Temperature set: ${parsed}°C / ${f}°F  (${bracket})`) };
  }

  const brackets = Object.keys(BRACKET_MIDPOINTS).join(" | ");
  return {
    toPlayer: formatDim(`Usage: @temperature [${brackets} | <°C> | reset]`),
  };
}

export function handleAdminPressure(
  world: World,
  target: string | undefined
): ActionResult {
  if (!target) {
    const override = getDebugPressureMb();
    const zoneIds = world.getEntitiesWithComponent("WeatherZone");
    if (zoneIds.length === 0) {
      return { toPlayer: formatDim("No weather zones loaded.") };
    }
    const lines: string[] = [];
    for (const zoneId of zoneIds) {
      const zone = world.getComponent(zoneId, "WeatherZone") as
        | { climate: string }
        | undefined;
      const state = world.getComponent(zoneId, "WeatherState") as
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
    syncWeatherState(world);
    return { toPlayer: formatDim("Pressure override cleared — simulation restored") };
  }

  const parsed = parseFloat(arg);
  if (!isNaN(parsed) && /^\d+(\.\d+)?$/.test(arg)) {
    if (parsed < 900 || parsed > 1100) {
      return { toPlayer: formatDim("Pressure out of range. Use 900–1100 mb.") };
    }
    setDebugPressureMb(parsed);
    syncWeatherState(world);
    return { toPlayer: formatDim(`Pressure set: ${parsed} mb`) };
  }

  return {
    toPlayer: formatDim("Usage: @pressure [<mb> | reset]  (typical range 960–1040)"),
  };
}

export function handleAdminSysinfo(
  world: World,
  startTime: number,
  target: string | undefined
): ActionResult {
  if (target === "help") {
    return { toPlayer: [
      formatBold("@sysinfo — Show server and world statistics."),
      "",
      formatDim("  @sysinfo    Show ticks, uptime, entity counts, time, and LLM debug state"),
    ].join("\n") };
  }

  const uptimeMs = Date.now() - startTime;
  const totalSec = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const uptimeStr =
    minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;

  const allIds = world.entities.getAllEntityIds();
  const roomCount = world.getEntitiesWithComponent("Room").length;
  const playerIds = world.getEntitiesWithComponent("Player");
  const onlineCount = playerIds.filter((id) => {
    const p = world.getComponent(id, "Player") as { sessionId: string };
    return p.sessionId !== "";
  }).length;

  const bracket = getTimeBracket();
  const isDebug = getDebugTime() !== null;
  const bracketStr = bracket + (isDebug ? formatDim(" [debug]") : "");
  const llmDebug = world.description.debugMode ? "on" : "off";

  const COL = 16;
  const row = (label: string, value: string): string =>
    `  ${formatCyan(label.padEnd(COL))}${value}`;

  const lines: string[] = [
    formatBold("System"),
    formatDim("─".repeat(26)),
    row("ticks", String(world.getTickCount())),
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

export function handleAdminPrompt(
  world: World,
  target: string | undefined
): ActionResult {
  if (target === "help") {
    return { toPlayer: [
      formatBold("@prompt — Show the most recent LLM prompt sent this session."),
      "",
      formatDim("  @prompt    Display the last system + user prompt sent to the LLM"),
      "",
      formatDim("  Resets each server restart. Use @llm on to see prompts inline."),
    ].join("\n") };
  }

  const p = world.description.lastPrompt;
  if (!p) {
    return { toPlayer: formatDim("No LLM prompt has been sent yet this session.") };
  }
  return { toPlayer: formatPromptBlock(p) };
}

export function handleAdminLlm(
  world: World,
  target: string | undefined
): ActionResult {
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
    world.description.setDebugMode(true);
    return { toPlayer: formatDim("LLM debug on — prompts will appear with each description.") };
  }
  if (arg === "off") {
    world.description.setDebugMode(false);
    return { toPlayer: formatDim("LLM debug off.") };
  }
  const state = world.description.debugMode ? "on" : "off";
  return { toPlayer: formatDim(`LLM debug mode: ${state}`) + (arg ? `  ${formatDim("(use @llm on / @llm off)")}` : "") };
}

export function handleAdminBrief(
  world: World,
  target: string | undefined,
  playerId: string,
): ActionResult {
  if (target === "help") {
    return {
      toPlayer: [
        formatBold("@brief — Show stored character roll and brief for a player."),
        "",
        formatDim("  @brief         Show your own character roll and brief"),
        formatDim("  @brief <name>  Show the named player's character roll and brief"),
      ].join("\n"),
    };
  }

  let targetId = playerId;
  let displayName: string;

  if (target) {
    const playerIds = world.getEntitiesWithComponent("Player");
    let found = false;
    for (const id of playerIds) {
      const p = world.getComponent(id, "Player") as { name: string } | undefined;
      if (p?.name.toLowerCase() === target.toLowerCase()) {
        targetId = id;
        displayName = p.name;
        found = true;
        break;
      }
    }
    if (!found) return { toPlayer: formatDim(`No player found: ${target}`) };
  } else {
    const selfPlayer = world.getComponent(playerId, "Player") as { name: string } | undefined;
    displayName = selfPlayer?.name ?? "(self)";
  }

  const roll = world.getComponent(targetId, "CharacterRoll");
  const brief = world.getComponent(targetId, "CharacterBrief") as { brief: string } | undefined;

  const lines: string[] = [];
  lines.push(formatBold(`[Brief: ${displayName!}]`));
  lines.push(formatDim("─".repeat(24)));

  if (!roll && !brief) {
    lines.push(formatDim("  No character data."));
    return { toPlayer: lines.join("\n") };
  }

  if (roll) {
    lines.push("");
    lines.push(formatBold("CharacterRoll"));
    for (const [field, value] of Object.entries(roll)) {
      lines.push(`  ${formatCyan(field)}: ${JSON.stringify(value)}`);
    }
  }

  if (brief) {
    lines.push("");
    lines.push(formatBold("CharacterBrief"));
    lines.push(`  ${brief.brief}`);
  }

  return { toPlayer: lines.join("\n") };
}

export function handleAdminBriefs(
  world: World,
  target: string | undefined,
  playerId: string,
): ActionResult {
  if (target === "help") {
    return {
      toPlayer: [
        formatBold("@briefs — Show all character briefs for players in the current room."),
        "",
        formatDim("  @briefs    List player briefs for everyone in your current room"),
      ].join("\n"),
    };
  }

  const position = world.getComponent(playerId, "Position") as { roomId: string } | undefined;
  if (!position) return { toPlayer: formatDim("You aren't anywhere.") };

  const lines: string[] = [];
  lines.push(formatBold("Player Briefs — Current Room"));
  lines.push(formatDim("─".repeat(30)));

  let count = 0;
  const playerIds = world.getEntitiesWithComponent("Player");
  for (const id of playerIds) {
    const pos = world.getComponent(id, "Position") as { roomId: string } | undefined;
    if (!pos || pos.roomId !== position.roomId) continue;

    const player = world.getComponent(id, "Player") as { name: string } | undefined;
    const brief = world.getComponent(id, "CharacterBrief") as { brief: string } | undefined;
    if (!player) continue;

    const isSelf = id === playerId;
    lines.push("");
    lines.push(formatBold(player.name) + (isSelf ? formatDim(" (you)") : ""));
    if (brief) {
      lines.push(`  ${brief.brief}`);
    } else {
      lines.push(formatDim("  (no brief)"));
    }
    count++;
  }

  if (count === 0) {
    lines.push(formatDim("  No players in this room."));
  }

  return { toPlayer: lines.join("\n") };
}

export async function handleAdminRegenBrief(
  world: World,
  target: string | undefined,
  playerId: string,
): Promise<ActionResult> {
  if (target === "help") {
    return {
      toPlayer: [
        formatBold("@regenerate-brief — Regenerate a player's character brief using the current prompt."),
        "",
        formatDim("  @regenerate-brief         Regenerate your own brief"),
        formatDim("  @regenerate-brief <name>  Regenerate the named player's brief"),
      ].join("\n"),
    };
  }

  let targetId = playerId;
  let displayName: string;

  if (target) {
    const playerIds = world.getEntitiesWithComponent("Player");
    let found = false;
    for (const id of playerIds) {
      const p = world.getComponent(id, "Player") as { name: string } | undefined;
      if (p?.name.toLowerCase() === target.toLowerCase()) {
        targetId = id;
        displayName = p.name;
        found = true;
        break;
      }
    }
    if (!found) return { toPlayer: formatDim(`No player found: ${target}`) };
  } else {
    const selfPlayer = world.getComponent(playerId, "Player") as { name: string } | undefined;
    displayName = selfPlayer?.name ?? "(self)";
  }

  const roll = world.getComponent(targetId, "CharacterRoll") as CharacterRoll | undefined;
  if (!roll) {
    return { toPlayer: formatDim(`${displayName!} has no CharacterRoll — cannot regenerate brief.`) };
  }

  const newBrief = await generateCharacterBrief(roll);
  world.setComponent(targetId, "CharacterBrief", { brief: newBrief });

  return {
    toPlayer: [
      formatBold(`[Brief regenerated: ${displayName!}]`),
      formatDim("─".repeat(30)),
      "",
      newBrief,
    ].join("\n"),
  };
}

export function handleAdminHelp(parser: Parser, target: string | undefined): ActionResult {
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

  lines.push("");
  for (const cmd of parser.getAdminVerbList()) {
    const name = cmd.usage;
    const visiblePrefix = name.length + 3;
    const dotsNeeded = Math.max(3, DESC_COL - visiblePrefix - 3);
    const dots = ".".repeat(dotsNeeded);
    lines.push(
      `  ${formatCyan(name)} ${formatDim(dots)}   ${cmd.description}`
    );
  }

  lines.push("");
  lines.push(formatDim("Type @<command> help for more detail."));

  return { toPlayer: lines.join("\n") };
}
