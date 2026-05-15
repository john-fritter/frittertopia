# Frittertopia — notes for Claude

A MUD. TypeScript ECS engine, YAML content, SQLite persistence, WebSocket transport, LLM-generated room descriptions cached per-player. Built by one person, played by friends. Develops like a garden, not a product.

For a developer-facing overview of the architecture and how to add things, see **README.md** (kept current). This file is for *you* — what to remember between sessions, where the sharp edges are, and what's authoritative.

## Run / test

```bash
npm install                # Node 22 required (Node 18 will fail on better-sqlite3)
npm run dev                # tsx, no build
npm run build              # tsc → dist/
npm run reset              # drop data/world.db, fresh start
npm test                   # vitest, 22 test files in tests/
```

Server listens on `PORT` (default 3000). Connect with `npx wscat -c ws://localhost:3000`.

## Hard constraints (do not relitigate)

- **Terminal-only UI.** Server-side ANSI over WebSocket. No JSON protocol, no browser client, no React. All output is pre-formatted text at 88–90 cols. Don't suggest browser UIs.
- **ECS discipline.** No component contains logic. No system contains persistent state — use a singleton entity (see `world.time`) if you need state across ticks.
- **Content never requires engine changes.** New YAML in `content/` is auto-discovered. New behavior = one component + one system, not edits to existing systems.
- **`ActionResult` is plain strings** (`{ toPlayer, toRoom?, toOtherRoom? }`). Intentionally simple to minimize test breakage.
- **Simplicity by default.** Pick the more complex approach only when it meaningfully unlocks gameplay or content. Explain the tradeoff first.

## Tech facts

- **Runtime**: Node 22 (via nvm; Node 18 incompatible with better-sqlite3 ABI).
- **TypeScript**: strict mode, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, NodeNext modules. Output to `dist/`.
- **Imports**: ESM with explicit `.js` suffixes (TypeScript NodeNext requirement, even when source is `.ts`).
- **Zod**: imported as `from "zod/v4"` everywhere. Stick to that.
- **DB**: SQLite via better-sqlite3, WAL mode, single file `data/world.db`.
- **LLM**: OpenRouter, default `google/gemini-2.0-flash-lite-001`, override via `OPENROUTER_MODEL`. 10 s timeout, never throws — returns `{ ok: false, error }`. Without a key, the server warns once and falls back to a stub for every description call.

## Layout (current, exhaustive)

```
src/
  main.ts                                — boot: world → components → systems → singleton time entity → content load → DB load → server.start, auto-save 5min, SIGINT/SIGTERM
  engine/
    World.ts                             — facade owning ComponentRegistry, EntityManager, EventBus, LLMClient, DescriptionService, TickLoop
    ComponentRegistry.ts                 — Zod-validated component registration with optional ref-path annotations
    EntityManager.ts                     — UUID + optional human key; addComponent (validated) vs setComponent (fast path)
    EventBus.ts                          — Zod-validated typed events; queued within-tick, flushed at end
    TickLoop.ts                          — runs systems in registration order; 250 ms default
    Parser.ts                            — text → Intent; bare directions, "say" captures rest, verb aliases + help metadata
    ActionResolver.ts                    — verbs: move, look, say, take, drop, inventory, help; admin: @destroy, @inspect, @teleport, @help (gated)
    ContentLoader.ts                     — recursive YAML walker, two-pass ref resolution by string keys
    Persistence.ts                       — SQLite snapshot save/load, UUID↔key translation for Position/VisitedRooms/Exits; restores keyless Item instances in addition to Player entities
    LLMClient.ts                         — OpenRouter wrapper, Result-style return, AbortController timeout
    description/
      DescriptionService.ts              — describeRoom / describeTarget; caches room results; LLM-fail fallback
      ContextBuilder.ts                  — RoomContext: brief, presence list, players, exits, isFirstVisit, time, weather, character briefs, item briefs (roomItemBriefs for room, inventoryItemBriefs for current player's carried items)
      PromptBuilder.ts                   — system + user prompts (room, target, and character-brief variants); loads from content/prompts/ files with inline fallbacks; buildRoomUserPrompt adds "Item details:" block; buildSenseUserPrompt adds fenced "ITEM DETAILS: <<<>>>" block
      DescriptionCache.ts                — (playerId, roomId) → text, 5-min TTL, invalidate(roomId) and invalidatePlayer(id)
      index.ts
  game/
    components.ts                        — registers ALL component schemas — see "Components" below
    characterGenerator.ts                — rollCharacter(gender): pure stat roller; TABLES export has all brackets and weird/normal pools; normal distributions for age/height/build, 15% weird chance for appearance traits
    characterBriefGenerator.ts           — generateCharacterBrief(roll): calls LLM with character-brief prompt role, 3 retries, fallback to formatted text
    solar.ts                             — getTimeBracket, getMoonData, setDebugTime; LOCATION = Bend, Oregon (44.06, -121.31)
    weather.ts                           — weather simulation helpers
    systems/
      SequenceSystem.ts                  — advances Sequence beats, emits sequence_beat / sequence_complete, places player on done
      TimeOfDaySystem.ts                 — recomputes bracket + moon every 60 s of wall-clock; updates world.time entity
      WeatherSystem.ts                   — drives WeatherState per-zone each tick
      ItemDecaySystem.ts                 — checks every 10 s; sets placedAt on first tick for room items with ItemTemplate; deletes entity when decayMs has elapsed (default 60 min); items in inventory (no Position) are ignored
  server/
    Server.ts                            — WebSocketServer; username/password auth, character creation flow, returning-player reattach, broadcasts; ADMIN_PLAYERS env or first-player-gets-admin
    auth.ts                              — bcrypt account table (accounts in SQLite, separate from ECS): createAccountTable, findAccountByUsername, createAccount, verifyPassword
    format.ts                            — ANSI: bold-white room name, yellow items, cyan exits, green say, magenta players, dim-white system, 88-col wrap
content/
  world/monastery/
    rooms/{courtyard,kitchen,corridor,chapel,dormitory,herb-garden}.yaml
    items.yaml                           — broom, candle, blanket, rosemary bush; Coleman lantern (key: monastery.lantern; carryable, slot: hand, ItemBrief, ItemState: lit/oil, ItemTemplate: decayMs 1 hr)
  sequences/
    fog-arrival.yaml                     — Sequence template (key: sequence.fog-arrival), cloned per new player
  prompts/
    world.md                             — world-level context fed to all LLM calls
    storyteller.md                       — voice and style layer
    describe-room.md                     — room-entry description role prompt
    describe.md                          — target-look description role prompt
    character-brief.md                   — character appearance brief role prompt
    brief-generator.md                   — brief-generator layer prompt
    roles/                               — role-specific overrides loaded by PromptBuilder
tests/
  engine.test.ts            content-loader.test.ts    persistence.test.ts
  parser.test.ts            action-resolver.test.ts   server.test.ts
  sequence.test.ts          format.test.ts            help.test.ts
  admin.test.ts             llm-client.test.ts        description-service.test.ts
  auth.test.ts              solar.test.ts             promptBuilder.test.ts
  characterGenerator.test.ts  characterBriefGenerator.test.ts  characterCreation.test.ts
  weather.test.ts           where.test.ts             items.test.ts
  weather-notifications.test.ts
```

## Probes (`scripts/`)

Volume-test harnesses that exercise the LLM prompt stack against the real model.
Outputs timestamped markdown to `tmp/probe-runs/` (gitignored).

**Character brief probe** (`scripts/probe-character-brief.ts`):
- **Pinned scenario mode**: `npx tsx scripts/probe-character-brief.ts <scenario.yaml> <count>` — same `CharacterRoll` N times. Scenarios live in `scripts/scenarios/`.
- **Random mode**: `npx tsx scripts/probe-character-brief.ts random <count>` — fresh `rollCharacter()` each iteration, choosing from `man`/`woman`/`nonbinary person`. The primary use case for volume testing.

Requires `OPENROUTER_API_KEY`. Without one, every iteration returns a formatted fallback.

## Components currently registered (`src/game/components.ts`)

| Component | Shape | Notes |
| --- | --- | --- |
| `Description` | `{ short }` | Terse label. **Schema is `short` only** — items.yaml authors a `long` field that is currently ignored. If you want `long` back, register it. |
| `RoomBrief` | `{ brief }` | Long authored brief. Fed to the LLM as ground truth, never shown raw. Bracketed `[name]` sections are picked up by target-look prompts. |
| `Position` | `{ roomId }` | Ref to a room. |
| `Room` | `{ name }` | |
| `Exits` | `{ exits: Record<dir, roomId> }` | Refs `exits.*`. |
| `Player` | `{ name, sessionId }` | `sessionId` is `""` while offline. |
| `Presence` | `{ description }` | How an item appears in a room listing. |
| `VisitedRooms` | `{ rooms: string[] }` | First-visit triggers full LLM description; revisits get `Description.short`. |
| `Admin` | `{ level }` | Set by Server (env list or first-player). |
| `SkyDescriptions` | `{ brackets: { [bracket]: { sky, window, sound, moon? } } }` | Authored on rooms; **not yet read by the renderer**. |
| `TimeOfDay` | `{ bracket, moonFraction, moonPhase, updatedAt }` | Singleton on entity keyed `world.time`. |
| `Sequence` | `{ beats[], currentBeat, elapsed, onComplete{placeInRoom?}, deflectMessage }` | While present on a player, blocks input — `ActionResolver.resolve` returns `deflectMessage` for any verb. |
| `CharacterRoll` | `{ gender, age, height, build, skin, eyes, hair, fantasticalFeature, skinMarks[] }` | Rolled once at character creation; persisted. All fields are bracket strings, not numbers. |
| `CharacterBrief` | `{ brief }` | LLM-generated prose summary of the CharacterRoll, stored on the player entity. |
| `WeatherZone` | `{ climate, tempCurve, pressureDrift, precipitationBias, accumulation? }` | Authored on room/zone entities. Drives WeatherSystem. |
| `WeatherState` | `{ tempC, pressureMb, precipState, ... }` | Simulated weather state, updated each tick by WeatherSystem. |
| `WeatherZoneRef` | `{ zoneId }` | Ref to a WeatherZone entity. |
| `WeatherChangeNotifications` | `{ transitions: Record<string, string> }` | Optional, authored on zone entities. Keys are `"{from}_{to}"` or `"{to}"`. Server checks this before its built-in fallback table; transitions with no authored text and no fallback entry are silently skipped. |
| `Item` | `{ carryable, equippable, consumable, slot? }` | Presence on an entity makes it an item. `carryable: false` blocks `take`. `slot` is e.g. `"hand"` (used when equippable, not yet enforced by a verb). |
| `ItemBrief` | `{ brief }` | Rich prose description fed to the LLM storyteller. Collected by `ContextBuilder` into `roomItemBriefs` / `inventoryItemBriefs` and rendered into both room and sense prompts. `placedAt` is filtered out of `ItemState` before the storyteller sees state values. |
| `ItemState` | `Record<string, string \| boolean \| number>` | Arbitrary key/value bag. `placedAt: number` is written by `ItemDecaySystem` (and cleared on `take`) — internal, not shown to the LLM. Other keys (e.g. `lit`, `oil`) are shown. |
| `ItemTemplate` | `{ decayMs? }` | Marks an item as governed by `ItemDecaySystem`. `decayMs` defaults to 60 min if absent. Items with this component but no `Position` (i.e. in inventory) are never decayed. |
| `Inventory` | `{ itemIds: string[] }` | On players. Ref array (`itemIds[]`). Max carry limit of 6 enforced by `handleTake`. |

Currently registered events: `sequence_beat`, `sequence_complete`, `player_destroyed` (all in `main.ts`); `weather_state_change` (registered by `GameServer` constructor — payload `{ zoneId, from, to }`).

## Things that look done but aren't (don't be fooled)

- **`SkyDescriptions`** — registered, authored on rooms, never read by the renderer or the prompt layer.
- **`Item.equippable` / `Item.slot`** — the field exists on the schema and the Coleman lantern authors it, but there is no `equip` or `wear` verb and no slot-enforcement system. The field is reserved for a future equip system.
- **`Item.consumable`** — same: field registered, no `use` or `eat` verb yet.

## Connection flow (reference)

1. WS connect → server prompts for username.
2. Username validated (2–20 letters). If account exists → prompt for password; if new → prompt for password + confirm. Max 3 failed attempts before disconnect.
3. Returning player with `CharacterRoll` → Player entity reattached, `sessionId` updated; if mid-`Sequence`, let it continue without re-describing the room; otherwise describe current room.
4. Returning player without `CharacterRoll` (disconnected mid-creation) → resume at gender prompt.
5. New player → create entity, prompt for gender → `rollCharacter(gender)` → `generateCharacterBrief(roll)` → store `CharacterRoll` and `CharacterBrief` on entity → `attachSequenceFromTemplate("sequence.fog-arrival")` clones the template's `Sequence` onto the player; **no `Position` yet**. SequenceSystem places them in `starting.room` when the last beat fires. Fallback: if the template is missing, place directly.
6. Game input: `Parser.parse` → `ActionResolver.resolve` → server sends `toPlayer` / broadcasts `toRoom` / `toOtherRoom`.

Auth state machine session states: `awaiting_username` → `awaiting_password` (returning) or `awaiting_new_password` → `awaiting_password_confirm` (new) → `awaiting_gender` (new only) → `playing`.

`Server` constructor takes `startingRoomKey` (default `"starting.room"`) and `sequenceTemplateKey` (default `"sequence.fog-arrival"`) — useful for tests.

## Persistence rules

- `saveWorld`: single transaction, `DELETE` then re-`INSERT` everything. Translates UUIDs → keys for `Position.roomId`, `VisitedRooms.rooms`, `Exits.exits.*`.
- `loadSavedState`: per-entity merge. Content entities (key matches a YAML entity) get DB components written over YAML; player entities (no YAML key) are recreated wholesale with the saved UUID. **Keyless `Item` instances** (runtime-spawned items with no YAML key) are also recreated wholesale — this includes items carried in player inventories. Orphaned keyed entities (key no longer in YAML) are warned and discarded.
- After load, every player's `Position.roomId` is checked; if the room no longer exists, they get moved to `starting.room` (or `Position` is removed if even that's gone). `VisitedRooms` is filtered to existing entities.
- **Renaming a YAML key is a breaking change for existing saves.** UUID churn across restarts is fine.
- `Inventory` refs (item UUIDs) round-trip correctly: keyless item UUIDs have no key translation (they pass through as raw UUIDs on both save and load), so as long as the item entity is also restored, the inventory stays coherent.

## Working with this codebase

- **Add a verb**: register in `ActionResolver.registerVerbs()` (with `description`/`usage`/`category` for help), add a `case` in `resolve()`. Admin verbs: prefix with `@`, gate via `adminGate(playerId, () => ...)`, omit metadata so they don't show in `help`.
- **Add a component**: register in `src/game/components.ts`. If it references entities, declare ref paths (`["fieldName"]` or `["fieldName.*"]` for record patterns). ContentLoader and Persistence handle them automatically.
- **Add a system**: pure `SystemFn = (entities, events) => void` in `src/game/systems/`. Register in `src/main.ts` with `world.addSystem(...)`. Order matters — they run in registration order each tick.
- **Add an event**: `world.registerEvent("name", zodSchema)` in `main.ts`. Emit from systems, subscribe from the server.
- **Add content**: drop YAML anywhere under `content/`. Keys are global — `monastery.kitchen`, `sequence.fog-arrival`, etc.

When you author a `RoomBrief`, bracketed `[name]` sections are how `look at <name>` finds detail text — `PromptBuilder.buildTargetSystemPrompt` instructs the LLM to use them. Don't strip them.

## Tooling notes

- **No vitest binary in the sandbox by default** — `npm install` first. CI / dev machines are fine.
- **GitHub access**: only `john-fritter/frittertopia`. Use `mcp__github__*` tools, not `gh`.
- **Working branch**: sessions are typically scoped to one feature branch — check the system prompt for the assigned branch name.

## Creative direction (don't drift)

### Embrace limitations, don't apologize for them

The LLM is inconsistent. That's the point. The world is dreamlike, foggy, Lynchian — a setting where a shadow lingers a beat too long, where a potato might appear on a table if the moment calls for it. The LLM's tendency to invent texture and hallucinate detail is an *asset* here, not a problem to suppress.

Don't fight this with over-constraining prompts. The system prompt is an art direction tool, not a correctness enforcer. Constrain the LLM when something is breaking gameplay (inventing exits that don't exist, contradicting hard facts about the world). Otherwise, let it be strange. The world is strange.

### The AI storyteller — the design's big idea

The engine's job is to resolve truth mechanically. The LLM's job is to interpret that truth into narrative. These two layers stay separate deliberately.

**Structured game state → AI storyteller → what the player experiences.**

Currently this only covers `look`. The roadmap extends it everywhere:

- **Sequences**: replace preauthored beats with AI-generated narrative driven by flags and player state
- **Combat and actions**: engine resolves what happened mechanically; AI describes it
- **Object interactions**: a thermometer returns a temperature; a map reveals coordinates; binoculars show distance — the AI narrates what these mean in context
- **Hidden reveals**: room/item briefs can contain stage directions the AI only surfaces under conditions — `(only visible in moonlight)`, `(reveal if player has examined the altar)`. The `[bracket]` syntax already does this for `look at`; the same principle extends to conditions
- **Per-room stage directions**: tone, style, what to foreground. The `RoomBrief` carries instructions to the AI that shape how it tells the story of that place
- **Player-unlocked storyteller behaviors**: finding or accomplishing certain things expands what the AI knows or changes how it speaks — progression isn't just mechanical, it changes the voice of the world
- **NPCs**: either fully played by AI agents or voiced-only — not decided yet. But the world's characters will be interpreted, not just scripted

The consistent thread: the world has structured truth underneath, and the AI is the interface between that truth and the player. When you add a system, think about what information it surfaces and how the AI storyteller would use it.

### The world as a character

The long arc is a world that responds to you — not through scripted events but through the AI having access to more truth as you discover it. Survival mechanics matter because they create real contrast: the monastery is warm and has food; the mountain doesn't. That contrast is something the AI can work with. Hidden things in the world, when found, don't just reward the player mechanically — they might change what the AI is allowed to say.

### Tone and aesthetics

- **Tone**: lonely but not sad; dreamlike but concrete. No irony, no tutorials, no fourth-wall breaks. Writing is the art direction.
- **Death**: fair or interesting. Players reincarnate in fog and walk back to the monastery.
- **Survival**: Minecraft-difficulty. Weather, hunger, cold, injury matter; the monastery is warm and has food, which means something because the mountain doesn't.
- **NPCs (planned, not built)**: two layers — simulation (needs, schedules, runs whether players are there or not) and authored dialogue trees that reference simulation state.
- **The world**: no detailed history. Ruins suggest advanced predecessors. Mysteriously anachronistic tech. Consistency emerges; it doesn't have to be coherent before it's expanded.
- **Aesthetic DNA**: The Long Dark, Myst, Stalker, *A Canticle for Leibowitz*, FF8, Minecraft, Kingdom Come: Deliverance, The Talos Principle, *old MUDs*.

## Deferred / designed but not built

- Zone-based activation (only simulate zones with nearby players).
- NPC simulation layer.
- Reading `SkyDescriptions` in descriptions.
- Equip/wear/use/eat verbs (item schema fields are reserved).
- Item spawn system (items must currently be authored in YAML or created via admin commands; there is no runtime loot drop or respawn mechanism beyond the YAML baseline).
<br>
## Working with Gizmo

Gizmo is John's resident Hermes agent on fritter.lol — the server this code runs on. Gizmo replaces the old Cleo/OpenClaw operational role. Gizmo has Slack presence, persistent memory, repository access, shell access on the host, and can coordinate deployment, service checks, testing, repo hygiene, and routine operational work.

### Why this matters

You (Claude) are John's design and planning partner for Frittertopia. Gizmo is the execution agent on the server. John connects the two of you by carrying prompts, briefs, and results through Slack; don't assume either agent has seen work unless John says so or it is committed in the repo.

The intended split is:

- **Claude:** creative design, architecture discussion, mechanics, tone, prompts, and implementation briefs.
- **Gizmo:** repo execution, OpenCode orchestration, tests/builds, branch cleanup, PR creation when John asks, and server-side verification/deployment tasks.
- **OpenCode:** coding worker delegated by Gizmo for non-trivial implementation prompts.

When John gives Gizmo a Frittertopia coding prompt, Gizmo creates a feature branch, runs `opencode run` in this repo with this `CLAUDE.md` as context, then runs `npm test && npm run build` and reports the changed files and results. Gizmo should not rewrite the prompt or add taste/architecture review unless John asks for that separately.

### How to hand off to Gizmo

When you build or design something that needs on-server deployment, testing, verification, or follow-up implementation, create a handoff doc:

**Location:** `handoffs/<YYYY-MM-DD>-<short-slug>.md`

**Conventions:**
- **Address Gizmo directly** — second person, "you." Gizmo reads these through the repo or from John.
- **Be self-contained.** State what changed, prerequisites, exact commands, how to test, how to verify, and what to do if something breaks.
- **Flag uncertainty.** If you can't test against the real server, mark "verify this" rather than stating it as fact.
- **Reference env vars by name, never by value.** Secrets stay out of the repo.
- **Give exact commands** where possible. Gizmo can run commands, but precise handoffs reduce mistakes.
- **Note ownership.** If you add scripts or operational procedures, say who should maintain them going forward.

After writing a handoff doc, commit it. John can tell Gizmo to pull and execute.

### What Gizmo can handle on request

- Pulling and restarting the Frittertopia service/container after a push.
- Checking logs (`docker logs`, `journalctl`) and service health.
- Running `npm test`, `npm run build`, and smoke checks.
- Creating feature branches, delegating coding prompts to OpenCode, and reporting results.
- Opening PRs against `main` when John asks.
- Simple config changes such as env var names, ports, or service settings when John has provided the needed values.
- Routine operational responses to alerts.

### What needs an explicit handoff or John approval

- New deployment procedures or changes to how the container/service is built.
- Database migrations or schema changes.
- Anything requiring new env vars, secrets, or credential rotation.
- Changes to Docker setup, Caddy routing, public service exposure, or deployment workflow.
- Verification steps that depend on specific expected output or real-player behavior.
- Destructive operations against production data, media, configs, or volumes.

### Reverse handoffs: Gizmo to Claude

Gizmo may discover issues on the server that need design or code changes — bugs, config problems, missing error handling, deployment hazards, or test failures. Gizmo should write a concise problem report and give it to John. When John brings such a report to you, treat it as operational context from the live server, not a design request in isolation.

### What Gizmo knows about this project

Gizmo has read this `CLAUDE.md` and can read the repo, README, tests, and local operational notes when asked. Gizmo does not automatically carry full repo context into every conversation; if a handoff depends on specific code, include file paths and commands rather than assuming it is loaded.

### Secrets and credentials

- The `OPENROUTER_API_KEY` for LLM descriptions is stored in `.env` on the host (not in git). Gizmo can verify that env vars exist, but secrets must never be written into the repo.
- Never put API keys, passwords, or tokens in committed files. Handoff docs reference env var names only.

### Communication

All communication between Claude and Gizmo goes through John in Slack or through committed handoff docs. Keep handoff docs and briefs clear and concise — John may be reading them on his phone.
