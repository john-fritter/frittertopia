export interface Intent {
  verb: string;
  target?: string;
  modifiers?: string[];
}

const DIRECTION_FULL: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  u: "up",
  d: "down",
};

const ALL_DIRECTIONS = new Set([
  "north", "south", "east", "west", "up", "down",
  "n", "s", "e", "w", "u", "d",
]);

export class Parser {
  private aliases = new Map<string, string>();

  constructor() {
    // Default aliases
    this.alias("go", "move");
    this.alias("l", "look");
    this.alias("'", "say");
  }

  alias(from: string, to: string): void {
    this.aliases.set(from, to);
  }

  parse(input: string): Intent {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === "") return { verb: "" };

    const parts = trimmed.split(/\s+/);
    const firstWord = parts[0]!;
    const rest = parts.slice(1).join(" ") || undefined;

    // Bare direction word -> move
    if (ALL_DIRECTIONS.has(firstWord) && rest === undefined) {
      const direction = DIRECTION_FULL[firstWord] ?? firstWord;
      return { verb: "move", target: direction };
    }

    // Resolve aliases
    const verb = this.aliases.get(firstWord) ?? firstWord;

    // "move north" or "go north" -> normalize direction in target
    if (verb === "move" && rest) {
      const direction = DIRECTION_FULL[rest] ?? rest;
      return { verb: "move", target: direction };
    }

    // "say" captures everything after as target
    if (verb === "say") {
      return { verb: "say", target: rest };
    }

    if (rest) {
      return { verb, target: rest };
    }

    return { verb };
  }
}
