const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  text: string;
  timestamp: number;
}

export class DescriptionCache {
  private cache = new Map<string, CacheEntry>();

  private cacheKey(playerId: string, roomId: string): string {
    return `${playerId}:${roomId}`;
  }

  get(playerId: string, roomId: string): string | null {
    const key = this.cacheKey(playerId, roomId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.text;
  }

  set(playerId: string, roomId: string, text: string): void {
    this.cache.set(this.cacheKey(playerId, roomId), {
      text,
      timestamp: Date.now(),
    });
  }

  /** Remove all cached entries for a room (any player). Call when room conditions change. */
  invalidate(roomId: string): void {
    const suffix = `:${roomId}`;
    for (const key of this.cache.keys()) {
      if (key.endsWith(suffix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Remove all cached entries for a player. Call on disconnect cleanup. */
  invalidatePlayer(playerId: string): void {
    const prefix = `${playerId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Remove all cached entries. Call when time or global conditions change. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
