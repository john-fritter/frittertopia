# Handoff: Admin command toolkit

**To:** Cleo  
**Date:** 2026-04-17  
**Branch:** `claude/admin-commands-proposal-rgTNo`

---

## What this does

Adds five new admin commands and improves two existing ones. No schema changes, no new env vars, no migration needed. This is pure TypeScript logic.

### New commands

| Command | Does |
|---|---|
| `@players` | Roster of all players: name, online/offline, current room |
| `@time [bracket\|HH:MM\|clear]` | Set or show debug time. Brackets: `dawn`, `morning`, `midday`, `afternoon`, `dusk`, `evening`, `night`, `deep_night`. `clear` restores real clock. |
| `@sysinfo` | Ticks, uptime, entity/room/player counts, current time bracket, llm debug state |
| `@prompt` | Shows the last system+user prompt pair sent to the LLM |
| `@llm [on\|off]` | Toggles inline prompt display — when on, every `look` appends the full prompt used |

### Improved existing commands

- **`@inspect`** — multiline fields (like `RoomBrief.brief`) now render as readable text instead of JSON-escaped strings. UUID fields show a room key/name hint in dim text.
- **`@help`** — lists all 9 admin commands, including the new ones. Bottom line shows the valid bracket names for `@time`.

---

## How to deploy

1. Pull the branch on the host:
   ```
   git fetch origin claude/admin-commands-proposal-rgTNo
   git checkout claude/admin-commands-proposal-rgTNo
   ```

2. Restart the frittertopia container (standard procedure — no extra steps needed).

3. No database migration required. No new env vars required.

---

## How to verify

Connect as admin (your account should already be in `ADMIN_PLAYERS`). Run each of the following and confirm the output looks reasonable:

```
@help
```
Should list 9 commands including `@players`, `@time`, `@sysinfo`, `@prompt`, `@llm`.

```
@players
```
Should show a roster with your name marked `online`, others `offline` if any exist.

```
@sysinfo
```
Should show tick count, uptime in Xm Ys, entity counts, current time bracket, `llm debug: off`.

```
@time
```
Should show current bracket and `(real clock)`.

```
@time dawn
```
Should set debug time and confirm bracket is `dawn`.

```
@time clear
```
Should confirm debug time cleared, show real bracket.

```
@time 14:30
```
Should set 2:30pm Bend time, confirm bracket is `afternoon`.

```
look
```
(Generates an LLM description. Then run:)

```
@prompt
```
Should show the SYSTEM and USER prompts that were just used.

```
@llm on
look
@llm off
```
Second `look` should have the full prompt appended after the room display.

```
@inspect monastery.chapel
```
(Or any room with a `RoomBrief`. The `brief` field should now show as readable multi-line text, not `"Line one.\nLine two."`)

---

## If something goes wrong

- All 323 tests pass on this branch (`npm test`). If the server won't start, check logs for TypeScript errors — this is unlikely since we don't do a build step in dev mode.
- `@time` modifies a module-level variable in `solar.ts`. It persists until the server restarts or `@time clear` is run. This is intentional.
- If the LLM is unavailable (no `OPENROUTER_API_KEY`), `@prompt` will show `No LLM prompt has been sent yet this session` until a description is generated via fallback — that's correct behavior; the fallback path doesn't call the LLM so there's no prompt to show.

---

## Notes

- `@time` bracket midpoints are computed from the actual astronomical sun position for today's date in Bend, OR. They will vary slightly by season and are always accurate.
- `@time HH:MM` interprets the time as Bend, OR local time (America/Los_Angeles), regardless of the server's system timezone. So `@time 14:30` always means 2:30pm in the game world.
- Description caches are flushed whenever `@time` changes the time, so the next `look` will get a fresh LLM description reflecting the new time.
