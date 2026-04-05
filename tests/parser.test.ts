import { describe, it, expect } from "vitest";
import { Parser } from "../src/engine/Parser.js";

describe("Parser", () => {
  const parser = new Parser();

  it("parses direction shortcuts as move intents", () => {
    expect(parser.parse("n")).toEqual({ verb: "move", target: "north" });
    expect(parser.parse("s")).toEqual({ verb: "move", target: "south" });
    expect(parser.parse("e")).toEqual({ verb: "move", target: "east" });
    expect(parser.parse("w")).toEqual({ verb: "move", target: "west" });
    expect(parser.parse("u")).toEqual({ verb: "move", target: "up" });
    expect(parser.parse("d")).toEqual({ verb: "move", target: "down" });
  });

  it("parses full direction words as move intents", () => {
    expect(parser.parse("north")).toEqual({ verb: "move", target: "north" });
    expect(parser.parse("south")).toEqual({ verb: "move", target: "south" });
    expect(parser.parse("east")).toEqual({ verb: "move", target: "east" });
    expect(parser.parse("west")).toEqual({ verb: "move", target: "west" });
    expect(parser.parse("up")).toEqual({ verb: "move", target: "up" });
    expect(parser.parse("down")).toEqual({ verb: "move", target: "down" });
  });

  it("parses 'go north' as move north", () => {
    expect(parser.parse("go north")).toEqual({ verb: "move", target: "north" });
    expect(parser.parse("go s")).toEqual({ verb: "move", target: "south" });
  });

  it("parses 'look' with no target", () => {
    expect(parser.parse("look")).toEqual({ verb: "look" });
    expect(parser.parse("l")).toEqual({ verb: "look" });
  });

  it("parses 'look chair' with target", () => {
    expect(parser.parse("look chair")).toEqual({ verb: "look", target: "chair" });
    expect(parser.parse("l broom")).toEqual({ verb: "look", target: "broom" });
  });

  it("parses 'say hello everyone' with full text as target", () => {
    expect(parser.parse("say hello everyone")).toEqual({
      verb: "say",
      target: "hello everyone",
    });
  });

  it("passes through unknown verbs", () => {
    expect(parser.parse("dance wildly")).toEqual({
      verb: "dance",
      target: "wildly",
    });
    expect(parser.parse("xyzzy")).toEqual({ verb: "xyzzy" });
  });

  it("handles leading/trailing whitespace and case", () => {
    expect(parser.parse("  NORTH  ")).toEqual({ verb: "move", target: "north" });
    expect(parser.parse("  Look  ")).toEqual({ verb: "look" });
  });

  it("strips 'at' from 'look at <target>'", () => {
    expect(parser.parse("look at chair")).toEqual({ verb: "look", target: "chair" });
    expect(parser.parse("l at broom")).toEqual({ verb: "look", target: "broom" });
  });

  it("does not strip 'at' when it is the whole target", () => {
    // "look at" with nothing after should keep "at" as the target
    expect(parser.parse("look at")).toEqual({ verb: "look", target: "at" });
  });
});
