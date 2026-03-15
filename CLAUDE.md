CLAUDE.md — Frittertopia
What This Is
A MUD (Multi-User Dungeon) — a persistent shared text world. TypeScript engine, YAML content, SQLite persistence, WebSocket transport. The engine simulates a world; content files tell it which world. Built by one person, played by family and friends and whoever wanders in.
This is also an art project. It develops like a garden, not a product. New things get added because they're interesting. The world doesn't need to be coherent before it can be expanded.
Project Location
~/src/frittertopia on a Linux server (also runs Jellyfin and the arr stack).
Tech Stack

Runtime: Node 22 via nvm (Node 18 is incompatible)
Language: TypeScript
Database: SQLite via Persistence.ts
Content: YAML with Zod validation
Transport: WebSockets
Testing: yes

Architecture: Entity-Component-System
Entities are unique IDs. Components are typed data bags. Systems are functions that run each tick on entities with matching component sets. No component contains logic. No system contains state.
Dual-key entities: UUID internally, human-readable string IDs for content authoring.
Component registration: Zod-validated schemas in ComponentRegistry. Singleton components per entity.
Two update paths:

addComponent — external/validated, used by content loading and player actions
setComponent — system updates, fast path, skips validation

World state at any moment is the complete set of entities and their component data. Serialization is a full snapshot.
Project Structure
src/
  engine/
    ComponentRegistry.ts   — Component type registration, Zod schemas, ref annotations
    EntityManager.ts       — Entity CRUD, key lookup, component storage, multi-component queries
    EventBus.ts            — Typed events, Zod-validated payloads, queued within-tick processing
    TickLoop.ts            — Ordered system execution, configurable interval
    World.ts               — Facade owning all engine pieces
    Persistence.ts         — SQLite save/load, two tables (entities, components), transaction-wrapped
    Parser.ts              — Text → structured intents, verb/alias registry, direction shortcuts
    ActionResolver.ts      — Intent resolution against world state, routed output
    ContentLoader.ts       — YAML loading, two-pass ref resolution, recursive directory discovery
  game/
    components.ts          — Core types: Description, Position, Room, Exits, Player, Presence, VisitedRooms
    format.ts              — ANSI formatting utility (bold white rooms, yellow items, cyan exits, green speech, magenta players, dim white system)
  server/
    Server.ts              — WebSocket server, session management, name prompt, room broadcasts
  main.ts                  — 16 lines: create world, register components, load content, start server

content/
  world/
    monastery/
      rooms.yaml           — 6 rooms: courtyard, kitchen, corridor, chapel, dormitory, herb garden
      items.yaml           — 4 presence entities: broom, candle, blanket, rosemary bush
Build Status
Phase 1 — Kernel: Complete. ECS, tick loop, event bus, persistence.
Phase 2 — Interface: Complete. Parser, action resolver, WebSocket server, game components.
Phase 3 — Content Pipeline: Complete. YAML loader with two-pass ref resolution, full monastery content.

Content Pipeline
All game content is YAML. The ContentLoader does two passes:

First pass creates entities and loads components, collecting unresolved entity references
Second pass resolves refs (e.g., exit targets) using human-readable string keys

Invalid content fails loudly with file/entity/component identification. Schemas are the content authoring docs.
Adding content never requires engine changes. New YAML files in content/ are discovered recursively.
Key Design Decisions
UI Is Terminal-Based
Server-side ANSI formatting over WebSocket. No browser client. No JSON message protocol. All output is pre-formatted text. Fixed-width centered column at 90 characters. This is a hard constraint — do not suggest browser UIs, React components, or client-side rendering.
ActionResult Is Plain Strings
Intentionally kept simple to minimize test breakage. Output is composed narrative: static room description + dynamic presence lines.
Persistence Is Full-Snapshot
SQLite stores complete world state. Two tables: entities and components. Transaction-wrapped saves. Validates component data against registered schemas on load.
Zone-Based Activation (Deferred)
Design calls for only simulating zones with nearby players. Inactive zones freeze and fast-forward when players arrive. Not yet implemented but the architecture supports it.
Development Principles

Default to the simplest standard approach unless a more complex choice would meaningfully limit gameplay, content creation, or future development. When that tradeoff exists, explain it before proceeding.
New content = zero engine changes. Just new YAML files.
New behavior = one new component + one new system. No modifications to existing systems.
The parser is extensible through registration, not hardcoding.
The event bus is open to any listener.

Creative Direction (for content and system design)
Tone: Lonely but not sad. Dreamlike but concrete. No irony, no tutorials, no fourth-wall breaks. Writing is the art direction.
Death: Fair or at least interesting. "I pushed too deep and the storm caught me" is a good death. "The game killed me and I don't know why" is a failed design. Players reincarnate in fog, return to the monastery.
Survival: Minecraft-level difficulty. You need to think about it but it's not the whole point. Weather, hunger, cold, injury — the monastery is warm and has food, and that means something because the mountain doesn't.
NPCs: Two layers. Simulation (needs, state machines, schedules — runs whether players interact or not) and scripted dialogue (authored trees that reference simulation state).
The world: No detailed history. Ruins suggest advanced predecessors. Mysteriously anachronistic technology. The world grows in whatever direction is interesting. Consistency emerges over time.
Aesthetic DNA: The Long Dark, Myst, Stalker, A Canticle for Leibowitz, FF8, Minecraft, Kingdom Come: Deliverance, the Talos Principle, *old MUDs*.