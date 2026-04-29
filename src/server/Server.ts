import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { World } from "../engine/World.js";
import { Parser } from "../engine/Parser.js";
import { ActionResolver } from "../engine/ActionResolver.js";
import { composeLook } from "../engine/verbs/gameplay.js";
import { formatSystem, formatSequence, formatArrival, formatDim } from "./format.js";
import { rollCharacter } from "../game/characterGenerator.js";
import { generateCharacterBrief } from "../game/characterBriefGenerator.js";
import {
  findAccountByUsername,
  createAccount,
  verifyPassword,
} from "./auth.js";

const MAX_AUTH_RETRIES = 3;

const WEATHER_FALLBACKS: Record<string, string> = {
  clear_rain: "Rain begins to fall.",
  clear_snow: "Snow begins to fall.",
  clear_storm: "A storm is building.",
  clear_fog: "Fog drifts in.",
  overcast_rain: "Rain begins to fall.",
  overcast_snow: "Snow begins to fall.",
  overcast_storm: "A storm is building.",
  rain_storm: "The rain intensifies into a storm.",
  rain_snow: "The rain turns to snow.",
  rain_sleet: "The rain turns to sleet.",
  rain_clear: "The rain stops.",
  rain_overcast: "The rain eases.",
  snow_storm: "A storm builds through the snow.",
  snow_rain: "The snow turns to rain.",
  snow_clear: "The snow stops.",
  snow_overcast: "The snow eases.",
  storm_rain: "The storm eases to rain.",
  storm_clear: "The storm passes.",
  storm_overcast: "The storm breaks.",
  storm_snow: "The storm turns to snow.",
  sleet_rain: "The sleet turns to rain.",
  sleet_snow: "The sleet turns to snow.",
  sleet_overcast: "The sleet stops.",
  sleet_clear: "The sleet stops.",
  fog_clear: "The fog lifts.",
  fog_overcast: "The fog thins.",
};

const GENDER_PROMPT =
  "Before you take shape in this world — are you a man, a woman, or something else? " +
  "You may answer however you like, or press enter to let the world decide.";

interface Session {
  ws: WebSocket;
  sessionId: string;
  playerId: string | undefined;
  state:
    | "awaiting_username"
    | "awaiting_password"
    | "awaiting_new_password"
    | "awaiting_password_confirm"
    | "awaiting_gender"
    | "playing";
  pendingUsername: string | undefined;
  pendingPassword: string | undefined;
  retries: number;
}

export class GameServer {
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, Session>();
  private activePlayers = new Map<string, string>(); // playerKey -> sessionId
  private parser = new Parser();
  private resolver: ActionResolver;
  private adminNames: Set<string> | null; // null = first-player-gets-admin
  private firstPlayerConnected = false;

  constructor(
    private world: World,
    private db: Database.Database,
    private startingRoomKey = "starting.room",
    private sequenceTemplateKey = "sequence.fog-arrival"
  ) {
    this.resolver = new ActionResolver(world, this.parser);

    world.registerEvent(
      "weather_state_change",
      z.object({ zoneId: z.string(), from: z.string(), to: z.string() })
    );

    const adminEnv = process.env["ADMIN_PLAYERS"];
    if (adminEnv) {
      this.adminNames = new Set(
        adminEnv
          .split(",")
          .map((n) => n.trim().toLowerCase())
          .filter((n) => n)
      );
    } else {
      this.adminNames = null;
    }

    this.setupEventHandlers();
  }

  start(port = 3000): void {
    this.wss = new WebSocketServer({ port });
    this.world.run();

    console.log(`Server listening on port ${port}`);

    this.wss.on("connection", (ws) => {
      const sessionId = uuidv4();
      const session: Session = {
        ws,
        sessionId,
        playerId: undefined,
        state: "awaiting_username",
        pendingUsername: undefined,
        pendingPassword: undefined,
        retries: 0,
      };
      this.sessions.set(sessionId, session);

      this.send(ws, "By what name are you known?");

      ws.on("message", (data) => {
        const input = data.toString().trim();
        if (!input && session.state !== "awaiting_gender") return;

        if (session.state === "playing") {
          void this.handleGameInput(session, input);
        } else {
          void this.handleAuthInput(session, input);
        }
      });

      ws.on("close", () => {
        this.handleDisconnect(session);
      });
    });
  }

  stop(): void {
    this.world.stop();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  getPort(): number | null {
    if (!this.wss) return null;
    const addr = this.wss.address();
    if (typeof addr === "string" || !addr) return null;
    return addr.port;
  }

  private setupEventHandlers(): void {
    this.world.onEvent("sequence_beat", (payload) => {
      const { playerId, text } = payload as {
        playerId: string;
        text: string;
      };
      this.sendToPlayer(playerId, formatSequence(text));
    });

    this.world.onEvent("sequence_complete", async (payload) => {
      const { playerId, roomId } = payload as {
        playerId: string;
        roomId: string;
      };
      const lookOutput = await composeLook(this.world, roomId, playerId, true);
      this.sendToPlayer(playerId, lookOutput);

      const player = this.world.getComponent(playerId, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (player) {
        this.broadcastToRoom(roomId, formatArrival(player.name), playerId);
      }
    });

    this.world.onEvent("weather_state_change", (payload) => {
      const { zoneId, from, to } = payload as {
        zoneId: string;
        from: string;
        to: string;
      };
      const text = this.resolveWeatherText(zoneId, from, to);
      if (!text) return;
      const formatted = formatDim(text);
      for (const playerId of this.getPlayersInZone(zoneId)) {
        this.sendToPlayer(playerId, formatted);
      }
    });

    this.world.onEvent("player_destroyed", (payload) => {
      const { playerId } = payload as { playerId: string };

      for (const [sessionId, session] of this.sessions) {
        if (session.playerId === playerId) {
          this.send(
            session.ws,
            "Your character has been removed by an administrator."
          );
          session.ws.close();

          const key = this.world.entities.getKeyForEntity(playerId);
          if (key) {
            this.activePlayers.delete(key);
          }
          this.sessions.delete(sessionId);
          break;
        }
      }
    });
  }

  private getPlayersInZone(zoneId: string): string[] {
    const players = this.world.getEntitiesWithComponents(["Player", "Position"]);
    const result: string[] = [];
    for (const playerId of players) {
      const player = this.world.getComponent(playerId, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (!player?.sessionId) continue;
      const position = this.world.getComponent(playerId, "Position") as
        | { roomId: string }
        | undefined;
      if (!position) continue;
      const zoneRef = this.world.getComponent(position.roomId, "WeatherZoneRef") as
        | { zoneId: string }
        | undefined;
      if (zoneRef?.zoneId !== zoneId) continue;
      result.push(playerId);
    }
    return result;
  }

  private resolveWeatherText(zoneId: string, from: string, to: string): string | null {
    const notifications = this.world.getComponent(zoneId, "WeatherChangeNotifications") as
      | { transitions: Record<string, string> }
      | undefined;
    if (notifications) {
      const specific = notifications.transitions[`${from}_${to}`];
      if (specific !== undefined) return specific;
      const generic = notifications.transitions[to];
      if (generic !== undefined) return generic;
    }
    return WEATHER_FALLBACKS[`${from}_${to}`] ?? null;
  }

  private sendToPlayer(playerId: string, text: string): void {
    const player = this.world.getComponent(playerId, "Player") as
      | { name: string; sessionId: string }
      | undefined;
    if (!player || !player.sessionId) return;
    const session = this.sessions.get(player.sessionId);
    if (session) {
      this.send(session.ws, text);
    }
  }

  private validateUsername(name: string): string | null {
    if (name.length < 2 || name.length > 20) {
      return "Names must be 2\u201320 characters.";
    }
    if (!/^[a-zA-Z]+$/.test(name)) {
      return "Names must contain only letters.";
    }
    return null;
  }

  private async handleAuthInput(
    session: Session,
    input: string
  ): Promise<void> {
    switch (session.state) {
      case "awaiting_username":
        await this.handleUsernameInput(session, input);
        break;
      case "awaiting_password":
        await this.handlePasswordInput(session, input);
        break;
      case "awaiting_new_password":
        this.handleNewPasswordInput(session, input);
        break;
      case "awaiting_password_confirm":
        await this.handlePasswordConfirmInput(session, input);
        break;
      case "awaiting_gender":
        await this.handleGenderInput(session, input);
        break;
    }
  }

  private async handleUsernameInput(
    session: Session,
    input: string
  ): Promise<void> {
    const validationError = this.validateUsername(input);
    if (validationError) {
      this.send(
        session.ws,
        `${validationError}\nBy what name are you known?`
      );
      return;
    }

    const playerKey = `player.${input.toLowerCase()}`;
    if (this.activePlayers.has(playerKey)) {
      this.send(
        session.ws,
        "That character is already awake somewhere else.\nBy what name are you known?"
      );
      return;
    }

    session.pendingUsername = input;
    const account = findAccountByUsername(this.db, input);

    if (account) {
      session.state = "awaiting_password";
      this.send(session.ws, "The name is known. Speak the word:");
    } else {
      session.state = "awaiting_new_password";
      this.send(
        session.ws,
        "No one answers to that name. Choose a word to be known by:"
      );
    }
  }

  private async handlePasswordInput(
    session: Session,
    input: string
  ): Promise<void> {
    const username = session.pendingUsername!;
    const account = findAccountByUsername(this.db, username);

    if (!account) {
      // Account vanished mid-session — restart
      session.state = "awaiting_username";
      session.pendingUsername = undefined;
      this.send(session.ws, "By what name are you known?");
      return;
    }

    const correct = await verifyPassword(input, account.password_hash);
    if (correct) {
      await this.completeLogin(session, account.username);
    } else {
      session.retries++;
      if (session.retries < MAX_AUTH_RETRIES) {
        this.send(session.ws, "That name and word don't match. Try again?");
      } else {
        this.send(
          session.ws,
          "The fog does not part for you. Try again later."
        );
        session.ws.close();
      }
    }
  }

  private handleNewPasswordInput(session: Session, input: string): void {
    if (!input) {
      this.send(session.ws, "A word must be spoken. Choose again:");
      return;
    }
    session.pendingPassword = input;
    session.state = "awaiting_password_confirm";
    this.send(session.ws, "Speak it once more, to be certain:");
  }

  private async handlePasswordConfirmInput(
    session: Session,
    input: string
  ): Promise<void> {
    if (input !== session.pendingPassword) {
      session.pendingPassword = undefined;
      session.state = "awaiting_new_password";
      this.send(session.ws, "The words did not match. Choose again:");
      return;
    }

    const username = session.pendingUsername!;
    const password = session.pendingPassword!;
    session.pendingPassword = undefined;

    try {
      await createAccount(this.db, username, password);
    } catch {
      // Race: another session claimed the name between check and create
      this.send(
        session.ws,
        "That name was claimed just now. By what name are you known?"
      );
      session.state = "awaiting_username";
      session.pendingUsername = undefined;
      return;
    }

    await this.completeLogin(session, username);
  }

  private async completeLogin(
    session: Session,
    username: string
  ): Promise<void> {
    const playerKey = `player.${username.toLowerCase()}`;

    // Guard against race: another session logged in during async bcrypt
    if (this.activePlayers.has(playerKey)) {
      this.send(session.ws, "That character is already awake somewhere else.");
      session.ws.close();
      return;
    }

    const existingId = this.world.getEntityByKey(playerKey);

    if (existingId) {
      // Returning player — reattach to existing entity
      const player = this.world.getComponent(existingId, "Player") as {
        name: string;
        sessionId: string;
      };

      this.world.setComponent(existingId, "Player", {
        name: player.name,
        sessionId: session.sessionId,
      });

      this.grantAdminIfEligible(existingId, player.name);

      session.playerId = existingId;
      this.activePlayers.set(playerKey, session.sessionId);

      // If character creation didn't finish (disconnected mid-flow), resume it
      if (!this.world.getComponent(existingId, "CharacterRoll")) {
        session.state = "awaiting_gender";
        this.send(session.ws, GENDER_PROMPT);
        return;
      }

      session.state = "playing";

      // If player still has an active sequence, let it continue — no room description
      const sequence = this.world.getComponent(existingId, "Sequence");
      if (sequence) return;

      const position = this.world.getComponent(existingId, "Position") as {
        roomId: string;
      };
      const lookOutput = await composeLook(
        this.world,
        position.roomId,
        existingId,
        true
      );
      this.send(
        session.ws,
        `Welcome back, ${player.name}.\n\n${lookOutput}`
      );

      this.broadcastToRoom(
        position.roomId,
        formatSystem(`${player.name} appears from the fog.`),
        existingId
      );
    } else {
      // New player — create entity and prompt for gender before world entry
      const playerId = this.world.createEntity(playerKey);
      this.world.addComponent(playerId, "Player", {
        name: username,
        sessionId: session.sessionId,
      });

      this.grantAdminIfEligible(playerId, username);

      session.playerId = playerId;
      this.activePlayers.set(playerKey, session.sessionId);

      session.state = "awaiting_gender";
      this.send(session.ws, GENDER_PROMPT);
    }
  }

  private async handleGenderInput(
    session: Session,
    input: string
  ): Promise<void> {
    const gender = input || (Math.random() < 0.5 ? "male" : "female");
    const playerId = session.playerId!;

    const roll = rollCharacter(gender);
    const brief = await generateCharacterBrief(roll);

    this.world.addComponent(
      playerId,
      "CharacterRoll",
      roll as unknown as Record<string, unknown>
    );
    this.world.addComponent(playerId, "CharacterBrief", { brief });

    session.state = "playing";

    if (this.attachSequenceFromTemplate(playerId)) {
      return;
    }

    const startingRoom = this.findStartingRoom();
    if (!startingRoom) {
      this.send(session.ws, "Error: No starting room found.");
      return;
    }

    const player = this.world.getComponent(playerId, "Player") as {
      name: string;
      sessionId: string;
    };

    this.world.addComponent(playerId, "Position", { roomId: startingRoom });
    this.world.addComponent(playerId, "VisitedRooms", {
      rooms: [startingRoom],
    });

    const lookOutput = await composeLook(
      this.world,
      startingRoom,
      playerId,
      true
    );
    this.send(session.ws, `Welcome, ${player.name}.\n\n${lookOutput}`);

    this.broadcastToRoom(
      startingRoom,
      formatSystem(`${player.name} appears from the fog.`),
      playerId
    );
  }

  private attachSequenceFromTemplate(playerId: string): boolean {
    const templateId = this.world.getEntityByKey(this.sequenceTemplateKey);
    if (!templateId) return false;

    const templateSeq = this.world.getComponent(templateId, "Sequence");
    if (!templateSeq) return false;

    const seqData = JSON.parse(JSON.stringify(templateSeq));
    seqData.currentBeat = 0;
    seqData.elapsed = 0;
    this.world.addComponent(playerId, "Sequence", seqData);
    return true;
  }

  private async handleGameInput(
    session: Session,
    input: string
  ): Promise<void> {
    if (!session.playerId) return;

    const intent = this.parser.parse(input);
    const result = await this.resolver.resolve(intent, session.playerId);

    this.send(session.ws, result.toPlayer);

    if (result.toRoom) {
      this.broadcastToRoom(
        result.toRoom.roomId,
        result.toRoom.text,
        result.toRoom.excludePlayer
      );
    }

    if (result.toOtherRoom) {
      this.broadcastToRoom(
        result.toOtherRoom.roomId,
        result.toOtherRoom.text,
        session.playerId
      );
    }
  }

  private grantAdminIfEligible(playerId: string, name: string): void {
    if (this.adminNames !== null) {
      if (this.adminNames.has(name.toLowerCase())) {
        this.world.setComponent(playerId, "Admin", { level: 1 });
      }
    } else {
      if (!this.firstPlayerConnected) {
        this.firstPlayerConnected = true;
        this.world.setComponent(playerId, "Admin", { level: 1 });
      }
    }
  }

  private handleDisconnect(session: Session): void {
    if (session.playerId) {
      const player = this.world.getComponent(session.playerId, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      const position = this.world.getComponent(
        session.playerId,
        "Position"
      ) as { roomId: string } | undefined;

      if (player && position) {
        this.broadcastToRoom(
          position.roomId,
          formatSystem(`${player.name} fades into the fog.`),
          session.playerId
        );
      }

      if (player) {
        this.world.setComponent(session.playerId, "Player", {
          name: player.name,
          sessionId: "",
        });
      }

      const key = this.world.entities.getKeyForEntity(session.playerId);
      if (key) {
        this.activePlayers.delete(key);
      }
    }

    this.sessions.delete(session.sessionId);
  }

  private findStartingRoom(): string | undefined {
    const keyed = this.world.getEntityByKey(this.startingRoomKey);
    if (keyed) return keyed;

    const rooms = this.world.getEntitiesWithComponent("Room");
    return rooms[0];
  }

  private broadcastToRoom(
    roomId: string,
    text: string,
    excludePlayerId?: string
  ): void {
    const playersInRoom = this.world.getEntitiesWithComponents([
      "Player",
      "Position",
    ]);
    for (const id of playersInRoom) {
      if (id === excludePlayerId) continue;
      const pos = this.world.getComponent(id, "Position") as {
        roomId: string;
      };
      if (pos.roomId !== roomId) continue;

      const player = this.world.getComponent(id, "Player") as {
        name: string;
        sessionId: string;
      };
      if (!player.sessionId) continue;
      const session = this.sessions.get(player.sessionId);
      if (session && session.ws.readyState === WebSocket.OPEN) {
        this.send(session.ws, text);
      }
    }
  }

  private send(ws: WebSocket, text: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(text);
    }
  }
}
