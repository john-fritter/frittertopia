# Handoff: Regenerate all six monastery room briefs

Hi Cleo —

The room-brief prompt has been updated with stricter requirements:
every brief must now commit to actual dimensions and every named
feature block must state its position and scale. The existing briefs
were generated with a weaker prompt and don't meet the new standard.

Your job: run the generator for each of the six rooms, review each
output, paste good ones into the YAML files, and flag any that need
human judgment before committing.

## Prerequisites

- `OPENROUTER_API_KEY` must be set (should already be in your env)
- Pull the branch: `claude/migrate-prompt-structure-NOnTO`
- Node 22, `npm install` if needed

## Step 1: generate all six briefs

Run each of these commands and save the output to a scratch file or
capture it. Do not paste anything yet.

```
npm run generate-brief starting.room
npm run generate-brief monastery.kitchen
npm run generate-brief monastery.corridor
npm run generate-brief monastery.chapel
npm run generate-brief monastery.dormitory
npm run generate-brief monastery.garden
```

Each command prints the new brief to stdout and the room name to
stderr. The output is what goes into `RoomBrief.brief` in the YAML.

## Step 2: review each output before pasting

For each generated brief, check these things:

**Required in the core section (before any feature blocks):**
- At least one actual measurement or clear scale reference.
  Good: "approximately thirty feet across", "six feet deep",
  "chest-high walls". Bad: "large room", "small chapel".

**Required in every named feature block:**
- What it is and what it's made of (e.g. "Stone well")
- Position in the room (e.g. "center of the courtyard",
  "north wall", "along the east and west walls")
- Approximate size or scale (e.g. "four feet across at the rim",
  "deep enough to stand in", "shoulder height")

**Things that must NOT appear:**
- Instructions like "describe X when...", "mention this if...",
  "render the hearth state as...", "match to time of day"
- Mood phrases with no correction purpose: "the silence has weight",
  "the room feels ancient"
- Editorial: "the table is the social center", "this is important"
- History or lore: who built it, how old it is
- Exit descriptions or navigation: don't paste blocks for doors,
  archways, or passages

**REVEAL syntax** (fine if present): `REVEAL: detail — condition`
That's correct format.

**Sensory variation** (fine if present): plain factual statements
about how the room changes at different times. "Morning light enters
as a pale rectangle on the north wall. By afternoon it has moved to
the floor." That's good. Instructions to describe something are not.

## Step 3: paste good outputs into YAML

For each room that passes review, find its YAML file:

| Room key | File |
|---|---|
| starting.room | content/world/monastery/rooms/courtyard.yaml |
| monastery.kitchen | content/world/monastery/rooms/kitchen.yaml |
| monastery.corridor | content/world/monastery/rooms/corridor.yaml |
| monastery.chapel | content/world/monastery/rooms/chapel.yaml |
| monastery.dormitory | content/world/monastery/rooms/dormitory.yaml |
| monastery.garden | content/world/monastery/rooms/herb-garden.yaml |

In each file, find the `RoomBrief:` component and replace the
entire value of `brief:` with the new output. The YAML structure
looks like this:

```yaml
      RoomBrief:
        brief: |
          [paste output here, indented 10 spaces to match]
```

Everything under `brief: |` must be indented consistently with the
rest of the YAML (10 spaces, matching the existing indentation). The
old brief can be deleted entirely.

## Step 4: flag problems

If any room's output fails review — missing dimensions, missing
position on a feature, instructions leaking through — do NOT paste
it. Leave a note in the brief for John about which rooms need
regeneration and what was wrong. Better to leave the old brief in
place than commit a bad one.

## Step 5: verify and commit

After pasting, start the server (`npm run dev`) and connect with
wscat. Run `@prompt` in at least the kitchen and the courtyard and
confirm the new briefs appear in the assembled prompt and contain
committed dimensions and feature positions.

Then commit and push to the branch:

```
git add content/world/monastery/rooms/
git commit -m "Regenerate room briefs with committed dimensions and feature positions"
git push origin claude/migrate-prompt-structure-NOnTO
```

## Why this matters

The old briefs had things like "render the hearth state as the
primary source of warmth" — that's a storyteller instruction, not a
fact. The LLM storyteller doesn't need that kind of direction; it
needs facts it can use. The new prompt enforces facts-only, which
means the briefs will be cleaner and the storyteller will have
better material to work with.

Let John know how it goes and flag any rooms that needed skipping.
