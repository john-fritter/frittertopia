# TODO

A living list. Not a spec, not a roadmap. Things I want to build, roughly when
I want to build them. Moves downward when deferred, upward when it's time.

Tags: [engine] [content] [ai] [systems] [ux] [infra] [design]

---

## Now

Things being worked on or up next. Keep this short.

- [ ] **Wire real time-of-day into the context bundle** [engine]
  `TimeOfDaySystem` already writes bracket + moon data to `world.time`. The
  context bundle currently sends a `midday` placeholder. Pass through the
  real values: bracket, moon fraction, moon phase, whether the moon is above
  the horizon.

- [ ] **Kill the visibility system, give the LLM raw light information** [engine] [ai]
  The `full | reduced | minimal | none` bucketing in `description.ts` is a
  holdover from the pre-LLM conditional-description design. Delete
  `description.ts` and `light.test.ts`. The context bundle gets the raw
  material instead: time bracket, moon state, room exposure
  (outdoor/sheltered/indoor), light sources present in room, light sources
  carried by player, "no light sources present" stated explicitly when true.
  Let the storyteller infer darkness. Keep the `[bracket]` convention in
  `RoomBrief` — that's progressive disclosure in prompt assembly, not
  visibility.

- [ ] **Recent input/output context window for the storyteller** [ai]
  Pass ~20 lines of this player's recent exchanges into the room/look-at
  prompt. Cheap, catches most sequential inconsistency.

- [ ] **Player appearance on the character sheet** [systems]
  Today the storyteller doesn't know what the player is wearing or looks
  like, so `look at my <x>` fails. Add an `Appearance` component, fed into
  the context bundle.

- [ ] **Character creation flow** [ai] [ux]
  On new account: random generation, or five questions → LLM → canonical
  description. Store both the answers and the generated description so
  regeneration is possible later without losing source material.

## Soon

Clear shape, not urgent. Order is rough.

### The brief system generalization

This is a set of related items that together unlock a lot of what comes
after. The idea: RoomBriefs aren't special. Items, NPCs, and player states
all contribute briefs to the storyteller's context bundle when they're
relevant. Each brief declares its scope (in-room / carried / player-state /
adjacent) and can contain stage directions in parens that tell the
storyteller how its presence should color descriptions.

- [ ] **`ItemBrief` component** [engine] [content]
  Items can have a brief that gets injected into the storyteller's context
  bundle when the item is present (in room or carried — scope declared on
  the brief). The brief is ground truth to the LLM, never shown raw. Stage
  directions can modify how other things are described: "(while I am in
  this room, the room is warmly lit)", "(while carried, the player is
  sheltered from cold)". Format and scope mechanics authored to the same
  bracket/paren convention already used for rooms.

- [ ] **Context bundle assembly refactor** [engine] [ai]
  The bundle becomes an ordered stack of labeled briefs: room brief, item
  briefs (room), item briefs (carried), NPC briefs (present), player state
  briefs (hunger, warmth, appearance). One place that assembles the stack
  from world state. Each brief is clearly labeled in the prompt so the
  storyteller knows scope and precedence.

- [ ] **Brief conflict hygiene** [design] [ai]
  Briefs shouldn't contradict each other. Draft a small authoring guide on
  scope and precedence (item-in-room trumps room baseline, carried trumps
  in-room for player-centered effects, etc.). No engine enforcement —
  this is an authoring discipline, like how `RoomBrief` is already written.

### NPCs

- [ ] **The caretaker monk** [content] [design]
  First NPC. The only one left. Monkish in an eastern way but not explicitly
  so. Has an ego. Reacts to the player. Standardize the NPC brief format
  while building him: name, 3-sentence identity, 5 beliefs, 3 fears about
  what the player might ask, 2 wants. His brief contributes to the context
  bundle like any other brief when he's in the room.

- [ ] **NPC dialogue via LLM** [ai] [systems]
  Monk responds to `say` and `say to <n>`. Brief + player input + current
  memory state → dialogue. Narration stays a separate call. Minimax M2-her
  candidate for dialogue specifically; evaluate vs. Haiku.

- [ ] **NPC memory — what the monk remembers about you** [ai] [systems]
  Separate LLM call after each exchange, structured output. "What should the
  monk remember about this?" → appended to per-player memory. Bounded list,
  LLM-summarized when it grows.

- [ ] **NPC disposition** [systems]
  Numeric or categorical, updated by the same post-exchange call. Feeds back
  into the dialogue prompt. Flavor, not a gate.

- [ ] **`say to <n>` addressing** [engine]
  Current `say` is a room broadcast. Needed for clean NPC interaction and
  multi-player rooms. Minor parser work.

### Items and world interaction

- [ ] **Inventory: pick up / drop / examine in hand** [systems]
  Items get a `Carriable` component. Player gets an `Inventory` component
  (simple array, no slot system, no weight limit). `take`, `drop`, inventory
  items are `look at`-able.

- [ ] **Light-source items** [content] [systems]
  Torches, lanterns, candles. Tagged as a light source. Their `ItemBrief`
  says "(while I am present and lit, this space is illuminated)". Carry a
  torch into a dark cave, the storyteller describes the cave as lit.

- [ ] **Warmth items (clothing, gear)** [content] [systems]
  Coats, cloaks, whatever. Their `ItemBrief` says "(while carried/worn, the
  player is insulated against cold)". Plays into the hunger/warmth system
  below.

- [ ] **Hunger and warmth as texture** [systems] [ai]
  Two numeric values on the player, decay over tick time. State briefs
  feed into the context bundle. No mechanical consequences yet — the AI
  just knows and colors descriptions accordingly.

- [ ] **Food items** [content] [systems]
  Generic consumables, flavor authored per item. Kitchen has some. Herb
  garden has some. Eating resets hunger.

## Later

Real features, not yet designed. Will need their own thinking time.

- [ ] **Death as literary event** [ai] [systems]
  Hunger/warmth thresholds trigger a death sequence. LLM-generated from the
  context bundle: where, what you were doing, who you knew, what you wore,
  season, time, NPC relationships. Beautiful, not punishing. Most players
  should experience it at least once.

- [ ] **Respawn in the fog** [systems]
  Death returns you to the courtyard via a fog sequence (reuse/vary
  `fog-arrival`). Body left behind. Items drop with it. Consider
  regenerating player description on respawn.

- [ ] **Bodies persist** [systems] [content]
  Dead player becomes a corpse entity with name and brief. Other players
  can find it. Decays over in-world time.

- [ ] **Leaving marks on the world** [systems] [design]
  Load-bearing for a world without progression. Much of this falls out of
  the brief system — a journal entry is an item whose brief contains the
  player's writing. A lantern left lit is a mark. More to think about:
  - Room state persistence for things that aren't items (a candle's lit
    state, a door's closed state)
  - Player-written journals as in-world items with authored briefs
  - NPC memories that outlive the player who created them

- [ ] **Weather system** [systems]
  Weather entity, singleton like `world.time`. Contributes a brief to the
  context bundle. Affects warmth. Seasonal or daily-variable, decide when
  building.

- [ ] **NPC schedules** [systems]
  The monk has routines — kitchen in the morning, chapel at midday,
  wherever at night. Traditional scripted AI, not LLM-decided. Feeds his
  presence into rooms as he moves.

- [ ] **Room-generation / world map script** [infra]
  Reads all room YAMLs, produces a layout map. Authoring tool first,
  possibly in-game carried-item later.

- [ ] **Dungeons / authored areas for tension** [content] [design]
  If combat or horror happens, it happens in specific authored places.
  Shadowy parts of the forest. A cellar that goes deeper than it should.
  Not open-world grinding. Monastery stays safe.

- [ ] **One "monster" NPC** [ai] [content]
  Scary entity in a specific area. Per-player memory, same system as the
  monk. Can kill you. Can be befriended if you do the right thing. This is
  where the LLM first makes world-affecting decisions (does it attack?),
  and needs the validation layer below.

- [ ] **LLM-as-GM validation layer** [ai] [engine]
  When the LLM decides things beyond NPC-local state (attack, move, flip
  world flags), it needs structured output + schema validation + an
  explicit contract. A separate system from the storyteller, probably a
  different model. Design this before building the monster.

- [ ] **Mystery threads — "where did everyone go?"** [content] [design]
  The monk being the only one left answers a question the player doesn't
  yet know to ask. Build the mystery in layered hidden content gated on
  conditions (time, items carried, NPC relationship, rooms visited). Much
  of this expressed as bracketed sections and stage directions in briefs.

- [ ] **Low-detail generic areas** [content]
  For the mountain and the forest. A room template with bracketed variants
  for trees / terrain / sounds. Storyteller keeps them fresh. Lets the
  world be large without authoring 200 unique rooms.

## Someday

Known to exist, not committed to.

- [ ] **Email + account recovery** [infra]
  When there are users who would be upset to lose access.

- [ ] **Guest accounts for the website** [ux]
  Temporary character, no persistence, landing page terminal emulator.

- [ ] **Rate limiting / lockout** [infra]
  When there are adversarial users.

- [ ] **Combat mechanics proper** [systems] [design]
  If at all. Currently combat is "the monster can kill you," which may be
  enough forever. Anything more needs a distinct design pass.

- [ ] **One-off, context-rich item making** [systems] [content]
  Not skill-based crafting. Not herb-grinding loops. But specific,
  discoverable, one-time creative interactions: use the right herb on the
  right wound, brew the monk's tea the way he prefers it, leave an
  offering in the chapel. Falls out of the item-brief system naturally —
  just depends on how many such interactions get authored.

- [ ] **Seasons** [systems]
  Extension of weather. Food availability, warmth baseline, room
  description tone.

- [ ] **Readable books / in-world text** [content]
  Library in the monastery. Books as items with long authored text or
  AI-generated on first read, cached.

- [ ] **Multiple languages for NPC dialogue** [ai]
  The monk doesn't speak English. Or does, sometimes. Lynchian.

---

## Notes to self

- The "stone broom" is not a bug. Playful misreadings that don't affect
  world state are on-brand.
- Don't blur the ECS/LLM boundary. ECS is source of truth. LLM renders or
  proposes — it never silently mutates.
- Briefs are authored art direction, not documentation. Write them to be
  read by the storyteller, not the player.
- The project isn't really a MUD. Don't let the word drive design. "A
  place to live in" is the north star.
- New features should generally be: one component + one system + maybe
  some YAML. If something demands engine changes, pause and ask whether
  the shape is right.
