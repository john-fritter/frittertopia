import type { SystemFn } from "../../engine/TickLoop.js";

interface Beat {
  text: string;
  delay: number;
}

interface SequenceData {
  beats: Beat[];
  currentBeat: number;
  elapsed: number;
  onComplete: { placeInRoom?: string };
  deflectMessage: string;
}

export function createSequenceSystem(tickIntervalMs: number): SystemFn {
  return (entities, events) => {
    const ids = entities.getEntitiesWithComponents(["Sequence", "Player"]);

    for (const id of ids) {
      const seq = entities.getComponent(id, "Sequence") as
        | SequenceData
        | undefined;
      if (!seq) continue;

      const beat = seq.beats[seq.currentBeat];
      if (!beat) {
        // Past last beat — clean up
        entities.removeComponent(id, "Sequence");
        continue;
      }

      seq.elapsed += tickIntervalMs;

      if (seq.elapsed >= beat.delay) {
        events.emit("sequence_beat", { playerId: id, text: beat.text });

        seq.currentBeat++;
        seq.elapsed = 0;

        if (seq.currentBeat >= seq.beats.length) {
          // Sequence complete
          if (seq.onComplete.placeInRoom) {
            const roomId = entities.getEntityByKey(seq.onComplete.placeInRoom);
            if (roomId) {
              entities.setComponent(id, "Position", { roomId });
              entities.setComponent(id, "VisitedRooms", { rooms: [roomId] });
              events.emit("sequence_complete", { playerId: id, roomId });
            }
          }
          entities.removeComponent(id, "Sequence");
        }
      }
    }
  };
}
