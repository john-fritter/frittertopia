Create an internal physical continuity record for a room.

Use only the provided source prose as the basis for facts. You may
infer and commit to specific physical details not stated in the source
— dimensions, positions, materials — when the source supports the
inference. These become canon. Do not invent features, objects, or
structural elements the source does not establish.

Core physical facts: materials, dimensions, layout, permanent
structural features, fixed furniture. Every room must have at least
one committed dimension — actual measurements or clear scale
references, not vague terms like "large" or "small". Terse. Use as
few lines as needed.

Every named feature must include:
- What it is and what it's made of
- Its position in the room ("north wall", "center of the room",
  "along the east and west walls")
- Its approximate size or scale ("six feet deep", "shoulder height",
  "wide enough to seat six per side")

Notes: include a note only when it prevents a specific misreading or
captures non-obvious mechanical behavior the storyteller needs to
maintain. Common sense is assumed. Do not over-instruct.

Good notes:
- "The bareness is deliberate, not neglected."
- "Stone walls hold warmth for hours after the hearth goes cold."
- "The ceiling is low — tall people duck by instinct even where
  clearance is fine."

Not notes — omit these:
- "The silence has weight." (mood without misreading to prevent)
- "The room feels ancient." (atmosphere, not prevention)
- "The table is the social center of the monastery." (editorial)
- Any instruction about how or when to describe something.

Sensory variation: when the source establishes how a room changes
at different times of day or seasons, state those as plain facts.
"Morning light enters as a pale rectangle on the north wall. By
afternoon it has moved to the floor." Not as directions — as facts.

Named features: for each named fixture, furniture, or recurring
point of interaction, create a bracket-headed block containing
physical facts, position, dimensions, any notes specific to it,
and optionally a REVEAL.

REVEAL syntax: REVEAL: detail — unlock condition

Use REVEAL only when the source explicitly establishes a conditional
detail. Do not speculate.

Hard exclusions — omit entirely:
- History, lore, origin, age, who built it
- NPCs and their behaviors
- Items and portable objects (they have their own briefs)
- Live state: current occupancy, weather, time of day
- Exit descriptions and navigation. Do not create feature blocks
  for doors, archways, passages, or thresholds whose main purpose
  is navigation.
- Future-state speculation outside a REVEAL
- Mood and atmosphere that serve no correction purpose
- Instructions to the storyteller about when or how to describe
  something

Output format:

Core physical facts and room dimensions. Terse.

Notes, if any. Omit if none needed.

Sensory variation, if the source establishes it. Omit otherwise.

[feature name] {
  What it is, what it's made of.
  Position in room.
  Approximate size or scale.
  Notes, if applicable.
  REVEAL: detail — unlock condition (only if applicable)
}

No section headers. No labels. The structure does the work.

Example (structural illustration only):

Roughly square flagstone courtyard, open to sky. Approximately
thirty feet across, bounded by monastery walls on three sides.
Stone flags uneven and cracked, worn smooth on the main paths,
rough where foot traffic is absent. Moss in shaded corners.
Only fully open space in the monastery — weather reaches here
directly.

[well] {
  Stone well, center of the courtyard.
  Rim worn smooth from hands and rope. Wooden frame above,
  darkened with age, slightly crooked. Hemp rope recently
  replaced — newer than the frame. Old leather bucket, cracked
  but functional. Approximately four feet across at the rim.
  Water clean and very cold.
  Echo changes with time of day: clear and bright in morning,
  flat by midday, deepening in evening, sharp at night.
  Do not explain the echo change.
}
