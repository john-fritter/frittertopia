import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { World } from "../engine/World.js";
import { Parser } from "../engine/Parser.js";
import { ActionResolver } from "../engine/ActionResolver.js";
import { formatSystem, formatSequence, formatArrival } from "./format.js";

interface Session {
  ws: WebSocket;
  sessionId: string;
  playerId?: string;
  state: "awaiting_name" | "playing";
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
    private startingRoomKey = "starting.room",
    private sequenceTemplateKey = "sequence.fog-arrival"
  ) {
    this.resolver = new ActionResolver(world, this.parser);

    const adminEnv = process.env["ADMIN_PLAYERS"];
    if (adminEnv) {
      this.adminNames = new Set(
        adminEnv.split(",").map((n) => n.trim().toLowerCase()).filter((n) => n)
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
      const session: Session = { ws, sessionId, state: "awaiting_name" };
      this.sessions.set(sessionId, session);

      this.send(ws, "What is your name?");

      ws.on("message", (data) => {
        const input = data.toString().trim();
        if (!input) return;

        if (session.state === "awaiting_name") {
          this.handleNameInput(session, input);
        } else {
          this.handleGameInput(session, input);
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

    this.world.onEvent("sequence_complete", (payload) => {
      const { playerId, roomId } = payload as {
        playerId: string;
        roomId: string;
      };
      const lookOutput = this.resolver.composeLook(roomId, playerId, true);
      this.sendToPlayer(playerId, lookOutput);

      const player = this.world.getComponent(playerId, "Player") as
        | { name: string; sessionId: string }
        | undefined;
      if (player) {
        this.broadcastToRoom(
          roomId,
          formatArrival(player.name),
          playerId
        );
      }
    });

    this.world.onEvent("player_destroyed", (payload) => {
      const { playerId } = payload as { playerId: string };

      // Find and disconnect the session for this player
      for (const [sessionId, session] of this.sessions) {
        if (session.playerId === playerId) {
          this.send(
            session.ws,
            "Your character has been removed by an administrator."
          );
          session.ws.close();

          // Clean up active players tracking
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

  private validateName(name: string): string | null {
    if (name.length < 2 || name.length > 20) {
      return "Name must be 2\u201320 characters.";
    }
    if (!/^[a-zA-Z]+$/.test(name)) {
      return "Name must contain only letters.";
    }
    return null;
  }

  private handleNameInput(session: Session, name: string): void {
    const validationError = this.validateName(name);
    if (validationError) {
      this.send(session.ws, `${validationError}\nWhat is your name?`);
      return;
    }

    const playerKey = `player.${name.toLowerCase()}`;

    // Check for duplicate session
    if (this.activePlayers.has(playerKey)) {
      this.send(
        session.ws,
        "That character is already being played by someone else.\nWhat is your name?"
      );
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
      session.state = "playing";
      this.activePlayers.set(playerKey, session.sessionId);

      // If player still has an active sequence, let it continue — no room description
      const sequence = this.world.getComponent(existingId, "Sequence");
      if (sequence) {
        return;
      }

      const position = this.world.getComponent(existingId, "Position") as {
        roomId: string;
      };
      const lookOutput = this.resolver.composeLook(
        position.roomId,
        existingId,
        true
      );
      this.send(session.ws, `Welcome back, ${player.name}.\n\n${lookOutput}`);

      this.broadcastToRoom(
        position.roomId,
        formatSystem(`${player.name} appears from the fog.`),
        existingId
      );
    } else {
      // New player
      const playerId = this.world.createEntity(playerKey);
      this.world.addComponent(playerId, "Player", {
        name,
        sessionId: session.sessionId,
      });

      this.grantAdminIfEligible(playerId, name);

      session.playerId = playerId;
      session.state = "playing";
      this.activePlayers.set(playerKey, session.sessionId);

      // Try to attach fog arrival sequence from template
      if (this.attachSequenceFromTemplate(playerId)) {
        // Sequence attached — no Position, no room description.
        // The sequence system handles timed text and room placement on completion.
        return;
      }

      // Fallback: no sequence template — place directly in starting room
      const startingRoom = this.findStartingRoom();
      if (!startingRoom) {
        this.send(session.ws, "Error: No starting room found.");
        return;
      }

      this.world.addComponent(playerId, "Position", { roomId: startingRoom });
      this.world.addComponent(playerId, "VisitedRooms", {
        rooms: [startingRoom],
      });

      const lookOutput = this.resolver.composeLook(
        startingRoom,
        playerId,
        true
      );
      this.send(session.ws, `Welcome, ${name}.\n\n${lookOutput}`);

      this.broadcastToRoom(
        startingRoom,
        formatSystem(`${name} appears from the fog.`),
        playerId
      );
    }
  }

  private attachSequenceFromTemplate(playerId: string): boolean {
    const templateId = this.world.getEntityByKey(this.sequenceTemplateKey);
    if (!templateId) return false;

    const templateSeq = this.world.getComponent(templateId, "Sequence");
    if (!templateSeq) return false;

    // Deep clone to avoid shared references between players
    const seqData = JSON.parse(JSON.stringify(templateSeq));
    seqData.currentBeat = 0;
    seqData.elapsed = 0;
    this.world.addComponent(playerId, "Sequence", seqData);
    return true;
  }

  private handleGameInput(session: Session, input: string): void {
    if (!session.playerId) return;

    const intent = this.parser.parse(input);
    const result = this.resolver.resolve(intent, session.playerId);

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
      // Explicit admin list from env var
      if (this.adminNames.has(name.toLowerCase())) {
        this.world.setComponent(playerId, "Admin", { level: 1 });
      }
    } else {
      // No ADMIN_PLAYERS set — first player gets admin
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
      const position = this.world.getComponent(session.playerId, "Position") as
        | { roomId: string }
        | undefined;

      if (player && position) {
        this.broadcastToRoom(
          position.roomId,
          formatSystem(`${player.name} fades into the fog.`),
          session.playerId
        );
      }

      // Clear sessionId so player doesn't appear in room listings
      if (player) {
        this.world.setComponent(session.playerId, "Player", {
          name: player.name,
          sessionId: "",
        });
      }

      // Remove from active players tracking
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
      if (!player.sessionId) continue; // skip offline players
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
