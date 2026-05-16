# Probe scripts

Scripts that exercise the LLM prompt stack in volume, writing results to
timestamped markdown files under `tmp/probe-runs/`. Used to iterate on prompts
by running them N times against the real model and reading the output for
patterns (hedging, boilerplate, inconsistency, etc).

## Usage

### Character brief probe

```bash
npx tsx scripts/probe-character-brief.ts <scenario.yaml> <count>
npx tsx scripts/probe-character-brief.ts random <count>
```

Examples:

```bash
npx tsx scripts/probe-character-brief.ts scripts/scenarios/brief-ordinary.yaml 5
npx tsx scripts/probe-character-brief.ts random 10
```

Two modes:

**Scenario mode** — loads a pinned scenario YAML, constructs a `CharacterRoll`,
calls `generateCharacterBrief` N times with the same roll.

**Random mode** — uses `random` as the first argument. Each iteration generates
a fresh random `CharacterRoll` via `rollCharacter()` (choosing from `man`,
`woman`, and `nonbinary person`) and calls `generateCharacterBrief`. The output
includes per-iteration roll details.

Both modes write results to `tmp/probe-runs/character-brief-<timestamp>.md`.

**Scenarios** are in `scripts/scenarios/`. Each is a YAML file with:

```yaml
description: "..."
roll:
  gender: "..."
  age: "..."
  height: "..."
  build: "..."
  skin: "..."
  eyes: "..."
  hair: "..."
  fantasticalFeature: null  # or a string
  skinMarks: []             # or a list of strings
```

No mock mode. Real LLM only — the point is testing against the actual model.
If `OPENROUTER_API_KEY` is not set, every iteration returns a formatted
fallback string.

### Sense probe

```bash
npx tsx scripts/probe-sense.ts <scenario.yaml>
```

Loads a pinned scenario YAML, bootstraps the world from real content, applies
overrides, creates synthetic players and items, then runs the described calls
against the real LLM.

Each call group runs the given `role` (either `describe-room` for room-entry
descriptions, or `describe` for sense/look commands) the specified `count` of
times. Results are written to `tmp/probe-runs/sense-<scenario-stem>-<timestamp>.md`.

**Scenarios** are in `scripts/scenarios/`. Each is a YAML file with:

```yaml
description: "..."
roomKey: "monastery.kitchen"                          # must exist in world content
overrides:                                             # optional
  time:
    bracket: "afternoon"
    moonPhase: "third_quarter"
    moonAboveHorizon: false
  weather:
    tempC: 4
    precipState: "clear"
    pressureMb: 1013
    pressureTrend: "steady"
currentPlayer:
  name: "anon"
  brief: |                                              # or roll: with full CharacterRoll
    CANON:
    - Woman, adult, average height, lean build.
otherPlayers:                                           # optional
  - name: "pell"
    brief: |                                            # or roll:
      CANON:
      - Man, middle-aged, tall, sturdy build.
items:                                                  # optional
  - shortDescription: "an iron lantern"
    brief: |
      A heavy iron lantern with a smoke-stained glass chimney.
    presence: "An iron lantern sits on the table, unlit."
    state:                                              # optional
      lit: false
      oil: "half"
calls:
  - role: "describe-room"
    count: 3
  - role: "describe"
    input: "look"
    count: 5
```

Three example scenarios are shipped:
- `sense-kitchen-ordinary.yaml` — indoor room, single player, scan + targeted looks
- `sense-courtyard-with-other-player.yaml` — outdoor room with weather zone, two
  players, tests REFERENCE RULE and per-player attribution
- `sense-kitchen-with-lantern.yaml` — indoor room, single player, scenario-added
  item with state (lit lantern)

### Adding a new probe

- Create a new script in `scripts/` following the same export pattern:
  - `export` the async runner function with a `generateFn` parameter for
    testability.
  - The CLI entry point calls it with the real generator.
- Add scenario files in `scripts/scenarios/`.
- Add tests in `tests/`.
- Document here.
