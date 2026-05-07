Create an internal physical continuity record for a room.

The record is never shown directly to the player. It will be given to the live storyteller so the room can be described consistently.

Use only the provided source prose. Do not invent facts not supported by the source.

Core physical facts: materials, approximate dimensions or scale when the source provides them, layout, permanent structural features, fixed furniture. Terse. Use as few lines as needed. Omit anything the source does not establish.

Notes: include a note only when it prevents a specific misreading or captures non-obvious mechanical behavior the storyteller needs to maintain. Common sense is assumed. Do not over-instruct.

Good notes:
- "The bareness is deliberate, not neglected." (prevents misreading of intent as poverty or abandonment)
- "Stone walls hold warmth for hours after the hearth goes cold." (non-obvious mechanical behavior)
- "The ceiling is low — tall people duck by instinct even where clearance is fine." (spatial fact with behavioral consequence)

Not notes — omit these:
- "The silence has weight." (mood without misreading to prevent)
- "The room feels ancient." (atmosphere, not prevention)
- "Everything here has a story." (editorial)

Sensory variation: when the source establishes how a room changes at different times of day or seasons, state those as plain facts. "Morning light enters as a pale rectangle on the north wall. By afternoon it has moved to the floor." Not as directions to the storyteller — as facts about the room.

Named features: for each named fixture, furniture, or recurring point of interaction, create a bracket-headed block. The block contains physical facts about that feature, any notes specific to it, and optionally a REVEAL for a detail the source establishes should only surface on close inspection.

REVEAL syntax: REVEAL: <detail> — <unlock condition>

Use REVEAL only when the source explicitly establishes a conditional detail. Do not speculate.

Hard exclusions — omit entirely:
- History, lore, origin, who built it, how old it is
- NPCs and their behaviors
- Items and portable objects (they have their own briefs)
- Live state: current occupancy, weather, time of day
- Exit descriptions, directions used only for navigation, destination room names, and room-to-room narrative. Do not create feature blocks for exits, doorways, archways, passages, doors, or thresholds whose main purpose is navigation — even if the source prose names them in brackets. Keep only permanent physical details that matter inside the room.
- Future-state speculation outside a REVEAL
- Mood and atmosphere that serve no correction purpose

Output format:

Core physical facts. One or two terse lines.

Notes, if any. Plain sentences. Omit entirely if none are needed.

Sensory variation, if the source establishes it. Omit otherwise.

[feature name] {
  Physical facts about this feature. Terse.
  Notes for this feature, if applicable.
  REVEAL: detail — unlock condition   (only if applicable)
}

[feature name] {
  ...
}

No section headers. No labels like CANON or FEATURES. The structure itself does the work. Line breaks separate logical groups within the core section and within each feature block.

Example (structural illustration only — do not copy this content):

Roughly square flagstone courtyard, open to sky, about thirty feet across. Stones worn smooth on the paths, rough where foot traffic is absent.

[well] {
  Stone well, center of the courtyard. Rim worn smooth. Wooden frame darkened with age, slightly crooked. Hemp rope recently replaced — newer than the frame. Old leather bucket, cracked but functional. Water clean and very cold.
  Echo changes with time of day: clear and bright in the morning, flat by midday, deepening in the evening, sharp and resonant at night.
}
