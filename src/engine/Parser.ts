export interface Intent {
  verb: string;
  target?: string;
  modifiers?: string[];
}

export interface VerbHelpData {
  verb: string;
  description: string;
  usage: string;
  category: string;
  aliases: string[];
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
  private verbMetadata = new Map<string, { description: string; usage: string; category: string; aliases: string[] }>();

  constructor() {
    // Default aliases
    this.alias("go", "move");
    this.alias("l", "look");
    this.alias("'", "say");
  }

  alias(from: string, to: string): void {
    this.aliases.set(from, to);
  }

  registerVerb(verb: string, options?: {
    aliases?: string[];
    description?: string;
    usage?: string;
    category?: string;
  }): void {
    if (options?.aliases) {
      for (const a of options.aliases) {
        this.aliases.set(a, verb);
      }
    }
    if (options?.description !== undefined && options?.usage !== undefined && options?.category !== undefined) {
      this.verbMetadata.set(verb, {
        description: options.description,
        usage: options.usage,
        category: options.category,
        aliases: options.aliases ?? [],
      });
    }
  }

  getHelpData(): VerbHelpData[] {
    const result: VerbHelpData[] = [];
    for (const [verb, meta] of this.verbMetadata) {
      result.push({ verb, ...meta });
    }
    return result;
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
