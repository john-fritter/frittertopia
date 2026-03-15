import { describe, it, expect } from "vitest";
import {
  wordWrap,
  formatRoom,
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
    // Long word gets its own line
    const lines = result.split("\n");
    expect(lines).toContain(longWord);
  });

  it("uses default width of 88", () => {
    const words = Array(20).fill("longword").join(" ");
    const result = wordWrap(words);
    for (const line of result.split("\n")) {
      // Each line should be at most 88 chars (or a single long word)
      expect(line.length).toBeLessThanOrEqual(88);
    }
  });
});

describe("formatRoom", () => {
  it("formats a full room with items, players, and exits", () => {
    const output = formatRoom({
      name: "The Stone Hall",
      description: "A wide hall of grey stone.",
      items: ["A wooden chair sits in the corner."],
      players: ["Aldric"],
      exits: [
        { direction: "north", roomName: "The Garden" },
        { direction: "east" },
      ],
    });

    const plain = stripAnsi(output);
    expect(plain).toContain("The Stone Hall");
    expect(plain).toContain("A wide hall of grey stone.");
    expect(plain).toContain("A wooden chair sits in the corner.");
    expect(plain).toContain("Aldric is here.");
    expect(plain).toContain("north");
    expect(plain).toContain("(The Garden)");
    expect(plain).toContain("east");
  });

  it("omits items section when no items", () => {
    const output = formatRoom({
      name: "Empty Room",
      description: "Nothing here.",
      exits: [{ direction: "south" }],
    });

    const plain = stripAnsi(output);
    expect(plain).not.toContain("is here");
    expect(plain).toContain("south");
  });

  it("omits players section when no players", () => {
    const output = formatRoom({
      name: "Empty Room",
      description: "Nothing here.",
      items: ["A rock."],
      exits: [],
    });

    const plain = stripAnsi(output);
    expect(plain).not.toContain("is here");
    expect(plain).toContain("Exits: none");
  });

  it("shows 'Exits: none' with no exits", () => {
    const output = formatRoom({
      name: "Dead End",
      description: "A dead end.",
      exits: [],
    });

    expect(stripAnsi(output)).toContain("Exits: none");
  });

  it("shows bare direction for unvisited exits", () => {
    const output = formatRoom({
      name: "Room",
      description: "A room.",
      exits: [{ direction: "west" }],
    });

    const plain = stripAnsi(output);
    expect(plain).toContain("west");
    expect(plain).not.toContain("(");
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
    // Contains ANSI codes
    expect(output).not.toBe("Server message");
  });
});
