import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { World } from "../engine/World.js";
import { Parser } from "../engine/Parser.js";
import { ActionResolver } from "../engine/ActionResolver.js";
import { formatSystem } from "./format.js";

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

  constructor(
    private world: World,
    private startingRoomKey = "starting.room"
  ) {
    this.resolver = new ActionResolver(world);
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

      session.playerId = existingId;
      session.state = "playing";
      this.activePlayers.set(playerKey, session.sessionId);

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
      const startingRoom = this.findStartingRoom();
      if (!startingRoom) {
        this.send(session.ws, "Error: No starting room found.");
        return;
      }

      const playerId = this.world.createEntity(playerKey);
      this.world.addComponent(playerId, "Player", {
        name,
        sessionId: session.sessionId,
      });
      this.world.addComponent(playerId, "Position", { roomId: startingRoom });
      this.world.addComponent(playerId, "VisitedRooms", {
        rooms: [startingRoom],
      });

      session.playerId = playerId;
      session.state = "playing";
      this.activePlayers.set(playerKey, session.sessionId);

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
