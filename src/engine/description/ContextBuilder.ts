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

    for (const id of inRoom) {
      const player = this.world.getComponent(id, "Player") as
        | { name: string }
        | undefined;
      if (player) {
        otherPlayers.push(player.name);
        continue;
      }
      const presence = this.world.getComponent(id, "Presence") as
        | { description: string }
        | undefined;
      if (presence) {
        const desc = this.world.getComponent(id, "Description") as
          | { short: string }
          | undefined;
        entitiesPresent.push({
          name: desc?.short ?? "something",
          description: presence.description,
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
    };
  }
}
