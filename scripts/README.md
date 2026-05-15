# Probe scripts

Scripts that exercise the LLM prompt stack in volume, writing results to
timestamped markdown files under `tmp/probe-runs/`. Used to iterate on prompts
by running them N times against the real model and reading the output for
patterns (hedging, boilerplate, inconsistency, etc).

## Usage

### Character brief probe

```bash
npx tsx scripts/probe-character-brief.ts <scenario.yaml> <count>
```

Example:

```bash
npx tsx scripts/probe-character-brief.ts scripts/scenarios/brief-ordinary.yaml 5
```

Loads a scenario YAML, constructs a `CharacterRoll`, calls
`generateCharacterBrief` N times, and writes results to
`tmp/probe-runs/character-brief-<timestamp>.md`.

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

Only explicit (pinned) input is supported for v1 — no seeded sampling. If you
need to sample from `rollCharacter`, create a scenario with the exact rolled
values.

No mock mode. Real LLM only — the point is testing against the actual model.
If `OPENROUTER_API_KEY` is not set, every iteration returns a formatted
fallback string.

### Adding a new probe

- Create a new script in `scripts/` following the same export pattern:
  - `export` the async runner function with a `generateFn` parameter for
    testability.
  - The CLI entry point calls it with the real generator.
- Add scenario files in `scripts/scenarios/`.
- Add tests in `tests/`.
- Document here.
