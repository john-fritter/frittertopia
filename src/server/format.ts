// ANSI escape codes
const RESET = "\x1b[0m";
const BOLD_WHITE = "\x1b[1;37m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM_CYAN = "\x1b[2;36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const DIM_WHITE = "\x1b[2;37m";

export interface RoomFooter {
  roomName: string;
  directions: string[];
  timeBracket: string;
  tempBracket: string;
  weather: string;
}

export interface RoomView {
  prose: string;
  footer: RoomFooter;
}

export function wordWrap(text: string, width = 88): string {
  if (!text) return "";

  return text
    .split("\n")
    .map((paragraph) => wrapParagraph(paragraph, width))
    .join("\n");
}

function wrapParagraph(text: string, width: number): string {
  if (text.length <= width) return text;

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!word) continue;

    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

const DIRECTION_ABBREV: Record<string, string> = {
  north: "N",
  northeast: "NE",
  east: "E",
  southeast: "SE",
  south: "S",
  southwest: "SW",
  west: "W",
  northwest: "NW",
  up: "U",
  down: "D",
};

const DIRECTION_ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "U", "D"];

export function abbreviateDirection(dir: string): string {
  const lower = dir.toLowerCase();
  return DIRECTION_ABBREV[lower] ?? dir.toUpperCase();
}

export function sortDirections(abbrev: string[]): string[] {
  const rank = new Map(DIRECTION_ORDER.map((d, i) => [d, i] as const));
  return [...abbrev].sort((a, b) => {
    const ai = rank.get(a) ?? DIRECTION_ORDER.length;
    const bi = rank.get(b) ?? DIRECTION_ORDER.length;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

const MARKUP_RE = /\[\[(item|player):([^\]]+)\]\]/g;

export function renderMarkup(prose: string): string {
  return prose.replace(MARKUP_RE, (_match, kind: string, name: string) => {
    if (kind === "item") return `${YELLOW}${name}${RESET}`;
    if (kind === "player") return `${MAGENTA}${name}${RESET}`;
    return name;
  });
}

export function stripMarkup(prose: string): string {
  return prose.replace(MARKUP_RE, (_match, _kind: string, name: string) => name);
}

const SEP = "  ·  ";

export function formatFooter(footer: RoomFooter): string {
  const dirs = footer.directions.length > 0 ? footer.directions.join(" ") : "—";
  return [
    `${BOLD_WHITE}${footer.roomName}${RESET}`,
    `${CYAN}${dirs}${RESET}`,
    `${DIM_WHITE}${footer.timeBracket}${RESET}`,
    `${DIM_WHITE}${footer.tempBracket}${RESET}`,
    `${DIM_WHITE}${footer.weather}${RESET}`,
  ].join(SEP);
}

export function formatRoomView(view: RoomView): string {
  const prose = wordWrap(renderMarkup(view.prose));
  return `${prose}\n\n${formatFooter(view.footer)}`;
}

export interface WhereBody {
  roomName: string;
  shortDescription: string;
  exits: Array<{ direction: string; roomName?: string }>;
  players: string[];
  items: string[];
  footer: RoomFooter;
}

export function formatWhere(body: WhereBody): string {
  const sections: string[] = [];

  sections.push(`${BOLD_WHITE}${body.roomName}${RESET}`);
  sections.push(wordWrap(body.shortDescription));

  if (body.exits.length > 0) {
    const parts = body.exits.map((e) => {
      const dir = `${CYAN}${e.direction}${RESET}`;
      if (e.roomName) return `${dir} ${DIM_CYAN}(${e.roomName})${RESET}`;
      return dir;
    });
    sections.push("Exits: " + parts.join(", "));
  } else {
    sections.push("Exits: none");
  }

  if (body.players.length > 0) {
    const names = body.players.map((n) => `${MAGENTA}${n}${RESET}`).join(", ");
    sections.push(`Players: ${names}`);
  }

  if (body.items.length > 0) {
    const names = body.items.map((n) => `${YELLOW}${n}${RESET}`).join(", ");
    sections.push(`Items: ${names}`);
  }

  sections.push(formatFooter(body.footer));

  return sections.join("\n\n");
}

export function formatSelfSay(message: string): string {
  return `${GREEN}You say, "${message}"${RESET}`;
}

export function formatSay(speaker: string, message: string): string {
  return `${GREEN}${speaker} says, "${message}"${RESET}`;
}

export function formatArrival(name: string): string {
  return `${MAGENTA}${name}${RESET}${DIM_WHITE} arrives.${RESET}`;
}

export function formatDeparture(name: string, direction: string): string {
  return `${MAGENTA}${name}${RESET}${DIM_WHITE} leaves to the ${direction}.${RESET}`;
}

export function formatSystem(text: string): string {
  return `${DIM_WHITE}${text}${RESET}`;
}

export function formatNarrative(text: string): string {
  return wordWrap(text);
}

export function formatSequence(text: string): string {
  return `${DIM_WHITE}${wordWrap(text)}${RESET}`;
}

export function formatBold(text: string): string {
  return `${BOLD_WHITE}${text}${RESET}`;
}

export function formatCyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function formatDim(text: string): string {
  return `${DIM_WHITE}${text}${RESET}`;
}

export function formatMagenta(text: string): string {
  return `${MAGENTA}${text}${RESET}`;
}

export function formatYellow(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}
