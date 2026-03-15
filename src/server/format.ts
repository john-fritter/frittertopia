// ANSI escape codes
const RESET = "\x1b[0m";
const BOLD_WHITE = "\x1b[1;37m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM_CYAN = "\x1b[2;36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const DIM_WHITE = "\x1b[2;37m";

export interface RoomExit {
  direction: string;
  roomName?: string;
}

export interface RoomData {
  name: string;
  description: string;
  items?: string[];
  players?: string[];
  exits: RoomExit[];
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

export function formatRoom(data: RoomData): string {
  const sections: string[] = [];

  // Room name
  sections.push(`${BOLD_WHITE}${data.name}${RESET}`);

  // Description
  sections.push(wordWrap(data.description));

  // Items
  if (data.items && data.items.length > 0) {
    sections.push(data.items.map((item) => `${YELLOW}${item}${RESET}`).join("\n"));
  }

  // Other players
  if (data.players && data.players.length > 0) {
    sections.push(
      data.players
        .map((name) => `${MAGENTA}${name}${RESET} is here.`)
        .join("\n")
    );
  }

  // Exits
  if (data.exits.length > 0) {
    const exitParts = data.exits.map((e) => {
      const dir = `${CYAN}${e.direction}${RESET}`;
      if (e.roomName) {
        return `${dir} ${DIM_CYAN}(${e.roomName})${RESET}`;
      }
      return dir;
    });
    sections.push("Exits: " + exitParts.join(", "));
  } else {
    sections.push("Exits: none");
  }

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
