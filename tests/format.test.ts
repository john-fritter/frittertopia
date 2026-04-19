import { describe, it, expect } from "vitest";
import {
  wordWrap,
  formatRoomView,
  formatFooter,
  formatWhere,
  renderMarkup,
  stripMarkup,
  abbreviateDirection,
  sortDirections,
  formatSelfSay,
  formatSay,
  formatArrival,
  formatDeparture,
  formatSystem,
} from "../src/server/format.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("wordWrap", () => {
  it("returns empty string for empty input", () => {
    expect(wordWrap("")).toBe("");
  });

  it("returns short text unchanged", () => {
    expect(wordWrap("hello world")).toBe("hello world");
  });

  it("wraps at word boundaries", () => {
    const input = "one two three four five six seven eight";
    const result = wordWrap(input, 20);
    const lines = result.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
    expect(stripAnsi(result).replace(/\n/g, " ")).toBe(input);
  });

  it("respects existing newlines", () => {
    const input = "first paragraph\n\nsecond paragraph";
    const result = wordWrap(input, 80);
    expect(result).toBe(input);
  });

  it("handles long unbreakable words", () => {
    const longWord = "a".repeat(100);
    const result = wordWrap(`hello ${longWord} world`, 20);
    expect(result).toContain(longWord);
    const lines = result.split("\n");
    expect(lines).toContain(longWord);
  });

  it("uses default width of 88", () => {
    const words = Array(20).fill("longword").join(" ");
    const result = wordWrap(words);
    for (const line of result.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(88);
    }
  });
});

describe("abbreviateDirection", () => {
  it("abbreviates cardinal directions", () => {
    expect(abbreviateDirection("north")).toBe("N");
    expect(abbreviateDirection("south")).toBe("S");
    expect(abbreviateDirection("east")).toBe("E");
    expect(abbreviateDirection("west")).toBe("W");
  });

  it("abbreviates ordinal directions", () => {
    expect(abbreviateDirection("northeast")).toBe("NE");
    expect(abbreviateDirection("southwest")).toBe("SW");
  });

  it("abbreviates vertical directions", () => {
    expect(abbreviateDirection("up")).toBe("U");
    expect(abbreviateDirection("down")).toBe("D");
  });

  it("is case-insensitive", () => {
    expect(abbreviateDirection("North")).toBe("N");
    expect(abbreviateDirection("NORTH")).toBe("N");
  });

  it("uppercases unknown directions", () => {
    expect(abbreviateDirection("portal")).toBe("PORTAL");
  });
});

describe("sortDirections", () => {
  it("orders cardinals in clockwise canonical order", () => {
    expect(sortDirections(["W", "N", "S", "E"])).toEqual(["N", "E", "S", "W"]);
  });

  it("interleaves ordinals correctly", () => {
    expect(sortDirections(["SW", "N", "NE", "S"])).toEqual(["N", "NE", "S", "SW"]);
  });

  it("places U/D last", () => {
    expect(sortDirections(["D", "N", "U"])).toEqual(["N", "U", "D"]);
  });
});

describe("renderMarkup", () => {
  it("colors items yellow", () => {
    const out = renderMarkup("a [[item:broom]] leans there");
    expect(stripAnsi(out)).toBe("a broom leans there");
    expect(out).toContain("\x1b[33m");
  });

  it("colors players magenta", () => {
    const out = renderMarkup("[[player:Robin]] warms her hands");
    expect(stripAnsi(out)).toBe("Robin warms her hands");
    expect(out).toContain("\x1b[35m");
  });

  it("handles multi-word names", () => {
    const out = renderMarkup("a [[item:tallow candle]] gutters");
    expect(stripAnsi(out)).toBe("a tallow candle gutters");
  });

  it("leaves text without markup unchanged", () => {
    expect(renderMarkup("plain prose")).toBe("plain prose");
  });

  it("leaves unknown markup kinds as literal name", () => {
    expect(renderMarkup("[[thing:X]]")).toBe("[[thing:X]]");
  });
});

describe("stripMarkup", () => {
  it("removes brackets, leaves name", () => {
    expect(stripMarkup("a [[item:broom]] leans")).toBe("a broom leans");
    expect(stripMarkup("[[player:Robin]]")).toBe("Robin");
  });
});

describe("formatFooter", () => {
  it("renders all five fields separated by middle dots", () => {
    const out = formatFooter({
      roomName: "The Monastery Courtyard",
      directions: ["N", "S"],
      timeBracket: "dusk",
      tempBracket: "cold",
      weather: "overcast",
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("The Monastery Courtyard");
    expect(plain).toContain("N S");
    expect(plain).toContain("dusk");
    expect(plain).toContain("cold");
    expect(plain).toContain("overcast");
    expect(plain).toContain("  ·  ");
  });

  it("renders indoor footer with 'warm · indoor'", () => {
    const out = formatFooter({
      roomName: "Kitchen",
      directions: ["N", "E"],
      timeBracket: "dusk",
      tempBracket: "warm",
      weather: "indoor",
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("warm");
    expect(plain).toContain("indoor");
  });

  it("shows em-dash for no exits", () => {
    const out = formatFooter({
      roomName: "Dead End",
      directions: [],
      timeBracket: "night",
      tempBracket: "cold",
      weather: "clear",
    });
    expect(stripAnsi(out)).toContain("—");
  });
});

describe("formatRoomView", () => {
  it("renders prose with markup and appends footer", () => {
    const out = formatRoomView({
      prose: "A [[item:broom]] leans against the wall.",
      footer: {
        roomName: "Corridor",
        directions: ["N"],
        timeBracket: "dusk",
        tempBracket: "warm",
        weather: "indoor",
      },
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("A broom leans against the wall.");
    expect(plain).toContain("Corridor");
    expect(plain).toContain("N");
    // blank line between prose and footer
    expect(plain).toMatch(/\n\n/);
  });
});

describe("formatWhere", () => {
  const footer = {
    roomName: "Corridor",
    directions: ["N", "S"],
    timeBracket: "dusk",
    tempBracket: "warm",
    weather: "indoor",
  };

  it("shows short description, exits with names for visited, players, items, footer", () => {
    const out = formatWhere({
      roomName: "Corridor",
      shortDescription: "A narrow corridor.",
      exits: [
        { direction: "n", roomName: "Kitchen" },
        { direction: "s" },
      ],
      players: ["Robin"],
      items: ["broom"],
      footer,
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("Corridor");
    expect(plain).toContain("A narrow corridor.");
    expect(plain).toContain("Exits: n (Kitchen), s");
    expect(plain).toContain("Players: Robin");
    expect(plain).toContain("Items: broom");
  });

  it("omits Players line when empty", () => {
    const out = formatWhere({
      roomName: "Corridor",
      shortDescription: "A narrow corridor.",
      exits: [],
      players: [],
      items: ["broom"],
      footer,
    });
    const plain = stripAnsi(out);
    expect(plain).not.toContain("Players:");
    expect(plain).toContain("Items:");
  });

  it("omits Items line when empty", () => {
    const out = formatWhere({
      roomName: "Corridor",
      shortDescription: "A narrow corridor.",
      exits: [],
      players: ["Robin"],
      items: [],
      footer,
    });
    const plain = stripAnsi(out);
    expect(plain).toContain("Players:");
    expect(plain).not.toContain("Items:");
  });

  it("shows 'Exits: none' with no exits", () => {
    const out = formatWhere({
      roomName: "Dead End",
      shortDescription: "A dead end.",
      exits: [],
      players: [],
      items: [],
      footer,
    });
    expect(stripAnsi(out)).toContain("Exits: none");
  });
});

describe("formatting functions", () => {
  it("formatSelfSay wraps in quotes", () => {
    const output = stripAnsi(formatSelfSay("hello"));
    expect(output).toBe('You say, "hello"');
  });

  it("formatSay includes speaker name", () => {
    const output = stripAnsi(formatSay("Aldric", "hello"));
    expect(output).toBe('Aldric says, "hello"');
  });

  it("formatArrival includes name", () => {
    const output = stripAnsi(formatArrival("Aldric"));
    expect(output).toContain("Aldric");
    expect(output).toContain("arrives");
  });

  it("formatDeparture includes name and direction", () => {
    const output = stripAnsi(formatDeparture("Aldric", "north"));
    expect(output).toContain("Aldric");
    expect(output).toContain("north");
  });

  it("formatSystem returns dim text", () => {
    const output = formatSystem("Server message");
    expect(output).toContain("Server message");
    expect(stripAnsi(output)).toBe("Server message");
    expect(output).not.toBe("Server message");
  });
});
