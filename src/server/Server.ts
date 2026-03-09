import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { World } from "../engine/World.js";
import { Parser } from "../engine/Parser.js";
import { ActionResolver } from "../engine/ActionResolver.js";

interface Session {
  ws: WebSocket;
  sessionId: string;
  playerId?: string;
  state: "awaiting_name" | "playing";
}

export class GameServer {
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, Session>();
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

  private handleNameInput(session: Session, name: string): void {
    const startingRoom = this.findStartingRoom();
    if (!startingRoom) {
      this.send(session.ws, "Error: No starting room found.");
      return;
    }

    const playerId = this.world.createEntity();
    this.world.addComponent(playerId, "Player", {
      name,
      sessionId: session.sessionId,
    });
    this.world.addComponent(playerId, "Position", { roomId: startingRoom });

    session.playerId = playerId;
    session.state = "playing";

    const lookOutput = this.resolver.composeLook(startingRoom, playerId);
    this.send(session.ws, `Welcome, ${name}.\n\n${lookOutput}`);

    // Notify others in the room
    this.broadcastToRoom(startingRoom, `${name} appears from the fog.`, playerId);
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
          `${player.name} fades into the fog.`,
          session.playerId
        );
      }

      this.world.deleteEntity(session.playerId);
    }

    this.sessions.delete(session.sessionId);
  }

  private findStartingRoom(): string | undefined {
    // Try the keyed starting room first
    const keyed = this.world.getEntityByKey(this.startingRoomKey);
    if (keyed) return keyed;

    // Fall back to the first room entity
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
      const pos = this.world.getComponent(id, "Position") as { roomId: string };
      if (pos.roomId !== roomId) continue;

      const player = this.world.getComponent(id, "Player") as {
        name: string;
        sessionId: string;
      };
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
