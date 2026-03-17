# Frittertopia

A MUD (Multi-User Dungeon) — a persistent shared text world. TypeScript engine, YAML content, SQLite persistence, WebSocket transport. The engine simulates a world; content files tell it which world.

Built by one person, played by family and friends and whoever wanders in. This is also an art project. It develops like a garden, not a product. New things get added because they're interesting. The world doesn't need to be coherent before it can be expanded.

## Commands

```bash
npm install        # install dependencies
npm run build      # compile TypeScript → dist/
npm run dev        # run with tsx (no build step)
npm run reset      # delete DB, start fresh
npm test           # vitest, tests are in tests/
```

Server listens on port 3000 (or `PORT` env var). Connect with any WebSocket client.

## Tech

- **Runtime**: Node 22 via nvm (Node 18 is incompatible)
- **Language**: TypeScript (strict mode, `exactOptionalPropertyTypes: true`)
- **Database**: SQLite via better-sqlite3 (WAL mode, stored at `data/world.db`)
- **Content**: YAML with Zod validation
- **Transport**: WebSockets (ws library)
- **Testing**: Vitest — 8 test files in `tests/`

## Hard Constraints

- **Terminal-only UI.** Server-side ANSI formatting over WebSocket. No browser client. No JSON message protocol. All output is pre-formatted text at 88-90 character width. Do not suggest browser UIs, React, or client-side rendering.
- **ECS discipline.** No component contains logic. No system contains state. Systems are functions that run each tick on entities with matching component sets.
- **Content never requires engine changes.** New YAML files in `content/` are discovered recursively. New behavior = one new component + one new system, no modifications to existing systems.
- **ActionResult is plain strings.** Intentionally simple to minimize test breakage. Output is composed narrative.
- **Simplicity by default.** Use the simplest standard approach unless a more complex choice would meaningfully limit gameplay, content creation, or future development. When that tradeoff exists, explain it before proceeding.

## Architecture: Entity-Component-System

Entities are unique IDs. Components are typed data bags. Systems run each tick on entities with matching component sets.

**Dual-key entities**: UUID internally, human-readable string keys for content authoring (e.g., `monastery.kitchen`).

**Component registration**: Zod-validated schemas in ComponentRegistry. Singleton components per entity.

**Two update paths**:
- `addComponent` — external/validated, used by content loading and player actions
- `setComponent` — system updates, fast path, skips validation

**Current components** (registered in `src/game/components.ts`):
- `Description` — `{short, long}` strings
- `Position` — `{roomId}` (entity ref)
- `Room` — `{name}`
- `Exits` — `{exits: Record<direction, roomId>}` (entity refs)
- `Player` — `{name, sessionId}`
- `Presence` — `{description}` (how items appear in rooms)
- `VisitedRooms` — `{rooms: string[]}` (entity IDs)
- `Sequence` — beats with timing, completion placement, deflect message

**Current systems**: SequenceSystem (animates multi-beat narrative sequences, blocks player input during playback).

## Project Structure

```
src/
  main.ts                    — boot: world → components → content → server, auto-save every 5min
  engine/
    ComponentRegistry.ts     — component type registration, Zod schemas, ref annotations
    EntityManager.ts         — entity CRUD, key lookup, component storage, multi-component queries
    EventBus.ts              — typed events, Zod-validated payloads, queued within-tick processing
    TickLoop.ts              — ordered system execution, 250ms tick interval
    World.ts                 — facade owning all engine pieces
    Persistence.ts           — SQLite save/load, UUID↔key translation, merge onto YAML baseline
    Parser.ts                — text → intent, verb aliases, direction shortcuts
    ActionResolver.ts        — intent → ActionResult, handles move/look/say
    ContentLoader.ts         — YAML loading, two-pass ref resolution, recursive directory scan
  game/
    components.ts            — all component schemas
    systems/
      SequenceSystem.ts      — sequence playback, beat timing, completion events
  server/
    Server.ts                — WebSocket server, session/name management, room broadcasts
    format.ts                — ANSI formatting (rooms=bold white, items=yellow, exits=cyan,
                               speech=green, players=magenta, system=dim white)
content/
  world/monastery/
    rooms.yaml               — 6 rooms: courtyard, kitchen, corridor, chapel, dormitory, herb garden
    items.yaml               — 4 presence entities: broom, candle, blanket, rosemary bush
  sequences/
    fog-arrival.yaml         — new player arrival sequence (fog narrative → monastery courtyard)
tests/
  engine.test.ts             — ComponentRegistry, EntityManager, EventBus, TickLoop, World
  content-loader.test.ts     — YAML parsing, ref resolution, error handling
  persistence.test.ts        — save/load, key translation, orphan handling
  parser.test.ts             — direction shortcuts, aliases, say capture
  action-resolver.test.ts    — move/look/say, visited rooms
  server.test.ts             — connection flow, name validation, sessions
  sequence.test.ts           — playback, timing, completion, deflection
  format.test.ts             — ANSI formatting, word wrapping
```

## Content Pipeline

All game content is YAML. ContentLoader does two passes:

1. **First pass**: create entities and load components, collecting unresolved entity references
2. **Second pass**: resolve refs (e.g., exit targets) using human-readable string keys

Reference paths are declared in ComponentRegistry (e.g., `"roomId"` for Position, `"exits.*"` for Exits). Invalid content fails loudly with file/entity/component context.

YAML content is always the authoritative source. On startup, content loads first, then saved DB state merges on top (per-component overwrite for content entities, full recreation for player entities).

## Persistence

SQLite full-snapshot. Two tables: `entities(id, key)` and `components(entity_id, component_type, data)`. Transaction-wrapped saves. On load, validates player positions and cleans up orphaned references. Auto-saves every 5 minutes.

## Connection Flow

1. WebSocket connects → server prompts for name
2. Name validated (2-20 chars, letters only), checked for duplicates
3. Returning player restored or new player created
4. New players get fog-arrival sequence (narrative beats over ~15s) → placed in starting room
5. Player input: parse → resolve → send result to player, broadcast to room

## How to Add Things

**New rooms/items**: Add YAML files anywhere under `content/`. Use human-readable keys for entity refs. No engine changes.

**New verb**: Register alias in Parser if needed, add handler case in ActionResolver.

**New behavior**: Register a new component schema in `components.ts`, write a new system in `game/systems/`, add it to the tick loop in `main.ts`.

**New content type**: Register component schema with ref annotations if it references entities. ContentLoader handles the rest.

## Design Notes

- The parser is extensible through registration, not hardcoding.
- The event bus is open to any listener. Events: `sequence_beat`, `sequence_complete`.
- Zone-based activation is designed but deferred — only simulate zones with nearby players, freeze inactive zones.

## Creative Direction

**Tone**: Lonely but not sad. Dreamlike but concrete. No irony, no tutorials, no fourth-wall breaks. Writing is the art direction.

**Death**: Fair or at least interesting. "I pushed too deep and the storm caught me" is a good death. "The game killed me and I don't know why" is a failed design. Players reincarnate in fog, return to the monastery.

**Survival**: Minecraft-level difficulty. You need to think about it but it's not the whole point. Weather, hunger, cold, injury — the monastery is warm and has food, and that means something because the mountain doesn't.

**NPCs**: Two layers. Simulation (needs, state machines, schedules — runs whether players interact or not) and scripted dialogue (authored trees that reference simulation state).

**The world**: No detailed history. Ruins suggest advanced predecessors. Mysteriously anachronistic technology. The world grows in whatever direction is interesting. Consistency emerges over time.

**Aesthetic DNA**: The Long Dark, Myst, Stalker, A Canticle for Leibowitz, FF8, Minecraft, Kingdom Come: Deliverance, the Talos Principle, *old MUDs*.
