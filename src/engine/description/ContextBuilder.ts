import type { World } from "../World.js";
import { getMoonAboveHorizon } from "../../game/solar.js";
import {
  celsiusToFahrenheit,
  computeTempBracket,
  computePressureTrend,
  type TempBracket,
  type PressureTrend,
  type PressurePoint,
} from "../../game/weather.js";

export interface ItemBriefEntry {
  short: string;
  brief: string;
  /** ItemState key/values, excluding internal decay fields like placedAt. */
  state?: Record<string, unknown>;
  /** "in room" or "carried by {playerName}". */
  location: string;
}

export interface RoomContext {
  roomName: string;
  /** Full brief text sent to the LLM. Uses RoomBrief.brief if present, otherwise Description.short. */
  roomBrief: string;
  /** Short description, always available — used for fallback rendering. */
  roomShort: string;
  /** Items and NPCs in the room that have a Presence component. */
  entitiesPresent: { name: string; description: string }[];
  /** Names of other players currently in the room. */
  otherPlayers: string[];
  isFirstVisit: boolean;
  /** Time-of-day bracket from world.time entity; falls back to "day". */
  timeOfDay: string;
  /** Moon phase name from world.time entity; falls back to "new". */
  moonPhase: string;
  /** Whether the moon is above the horizon right now. */
  moonAboveHorizon: boolean;
  /** Precipitation state, or "clear" for indoor/weatherless rooms. */
  weather: string;
  /** Raw temperature in Celsius — present only for rooms with a WeatherZoneRef. */
  tempC?: number;
  /** Raw temperature in Fahrenheit — present only for rooms with a WeatherZoneRef. */
  tempF?: number;
  /** Human-readable temperature bracket — present only for rooms with a WeatherZoneRef. */
  tempBracket?: TempBracket;
  /** Raw atmospheric pressure in hPa — present only for rooms with a WeatherZoneRef. */
  pressureMb?: number;
  /** Pressure trend label — present only for rooms with a WeatherZoneRef. */
  pressureTrend?: PressureTrend;
  /** Mechanical exits: direction → target room name. */
  exits?: Record<string, string>;
  /** Character briefs for entities present in the room, including the current player. */
  characterBriefs: { name: string; brief: string }[];
  /** Name of the current player — used in sense prompts to attribute self-references. */
  currentPlayerName?: string;
  /** ItemBrief entries for items physically present in the current room. */
  roomItemBriefs: ItemBriefEntry[];
  /** ItemBrief entries for items in the current player's inventory. */
  inventoryItemBriefs: ItemBriefEntry[];
}

export class ContextBuilder {
  constructor(private world: World) {}

  buildContext(roomId: string, playerId: string): RoomContext {
    const room = this.world.getComponent(roomId, "Room") as
      | { name: string }
      | undefined;
    const roomName = room?.name ?? "Unknown Room";

    const description = this.world.getComponent(roomId, "Description") as
      | { short: string }
      | undefined;
    const roomShort = description?.short ?? "";

    const roomBriefComp = this.world.getComponent(roomId, "RoomBrief") as
      | { brief: string }
      | undefined;
    const roomBrief = roomBriefComp?.brief ?? roomShort;

    const inRoom = this.world
      .getEntitiesWithComponent("Position")
      .filter((id) => {
        const pos = this.world.getComponent(id, "Position") as
          | { roomId: string }
          | undefined;
        return pos?.roomId === roomId && id !== playerId;
      });

    const entitiesPresent: { name: string; description: string }[] = [];
    const otherPlayers: string[] = [];
    const characterBriefs: { name: string; brief: string }[] = [];
    const roomItemBriefs: ItemBriefEntry[] = [];

    // Include the current player's own brief so the storyteller knows who they are describing the world to.
    const selfPlayer = this.world.getComponent(playerId, "Player") as
      | { name: string }
      | undefined;
    const selfBrief = this.world.getComponent(playerId, "CharacterBrief") as
      | { brief: string }
      | undefined;
    if (selfPlayer && selfBrief) {
      characterBriefs.push({ name: selfPlayer.name, brief: selfBrief.brief });
    }

    for (const id of inRoom) {
      const brief = this.world.getComponent(id, "CharacterBrief") as
        | { brief: string }
        | undefined;
      const player = this.world.getComponent(id, "Player") as
        | { name: string }
        | undefined;
      if (player) {
        otherPlayers.push(player.name);
        if (brief) characterBriefs.push({ name: player.name, brief: brief.brief });
        continue;
      }
      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        const desc = this.world.getComponent(id, "Description") as
          | { short: string }
          | undefined;
        const name = desc?.short ?? "something";
        entitiesPresent.push({ name, description: presence.description });
        if (brief) characterBriefs.push({ name, brief: brief.brief });
      }

      const itemBriefComp = this.world.getComponent(id, "ItemBrief") as
        | { brief: string }
        | undefined;
      if (itemBriefComp) {
        const desc = this.world.getComponent(id, "Description") as
          | { short: string }
          | undefined;
        const itemState = this.world.getComponent(id, "ItemState") as
          | Record<string, unknown>
          | undefined;
        roomItemBriefs.push({
          short: desc?.short ?? "unknown",
          brief: itemBriefComp.brief,
          ...(itemState !== undefined && { state: itemState }),
          location: "in room",
        });
      }
    }

    const inventoryItemBriefs: ItemBriefEntry[] = [];
    const inventory = this.world.getComponent(playerId, "Inventory") as
      | { itemIds: string[] }
      | undefined;
    if (inventory) {
      const carrierName = selfPlayer?.name ?? "you";
      for (const itemId of inventory.itemIds) {
        const itemBriefComp = this.world.getComponent(itemId, "ItemBrief") as
          | { brief: string }
          | undefined;
        if (!itemBriefComp) continue;
        const desc = this.world.getComponent(itemId, "Description") as
          | { short: string }
          | undefined;
        const itemState = this.world.getComponent(itemId, "ItemState") as
          | Record<string, unknown>
          | undefined;
        inventoryItemBriefs.push({
          short: desc?.short ?? "unknown",
          brief: itemBriefComp.brief,
          ...(itemState !== undefined && { state: itemState }),
          location: `carried by ${carrierName}`,
        });
      }
    }

    const visited = this.world.getComponent(playerId, "VisitedRooms") as
      | { rooms: string[] }
      | undefined;
    const isFirstVisit = !visited?.rooms.includes(roomId);

    let timeOfDay = "day";
    let moonPhase = "new";

    const timeEntityId = this.world.getEntityByKey("world.time");
    if (timeEntityId) {
      const tod = this.world.getComponent(timeEntityId, "TimeOfDay") as
        | { bracket: string; moonPhase: string }
        | undefined;
      if (tod) {
        timeOfDay = tod.bracket;
        moonPhase = tod.moonPhase;
      }
    }
    const moonAboveHorizon = getMoonAboveHorizon();

    const exitsComp = this.world.getComponent(roomId, "Exits") as
      | { exits: Record<string, string> }
      | undefined;
    let exits: Record<string, string> = {};
    if (exitsComp) {
      exits = {};
      for (const [direction, targetId] of Object.entries(exitsComp.exits)) {
        const targetRoom = this.world.getComponent(targetId, "Room") as
          | { name: string }
          | undefined;
        exits[direction] = targetRoom?.name ?? targetId;
      }
    }

    // Weather — only for rooms that reference a weather zone
    const weatherZoneRef = this.world.getComponent(roomId, "WeatherZoneRef") as
      | { zoneId: string }
      | undefined;

    type WeatherFields = Pick<
      RoomContext,
      "weather" | "tempC" | "tempF" | "tempBracket" | "pressureMb" | "pressureTrend"
    >;

    let weatherFields: WeatherFields = { weather: "clear" };
    if (weatherZoneRef) {
      const ws = this.world.getComponent(weatherZoneRef.zoneId, "WeatherState") as
        | {
            tempC: number;
            pressureMb: number;
            precipState: string;
            pressureHistory: PressurePoint[];
          }
        | undefined;
      if (ws) {
        weatherFields = {
          weather: ws.precipState,
          tempC: ws.tempC,
          tempF: Math.round(celsiusToFahrenheit(ws.tempC)),
          tempBracket: computeTempBracket(ws.tempC),
          pressureMb: Math.round(ws.pressureMb),
          pressureTrend: computePressureTrend(ws.pressureHistory),
        };
      }
    }

    return {
      roomName,
      roomBrief,
      roomShort,
      entitiesPresent,
      otherPlayers,
      isFirstVisit,
      timeOfDay,
      moonPhase,
      moonAboveHorizon,
      ...weatherFields,
      exits,
      characterBriefs,
      currentPlayerName: selfPlayer?.name,
      roomItemBriefs,
      inventoryItemBriefs,
    };
  }
}
