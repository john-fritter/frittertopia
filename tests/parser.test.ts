import { describe, it, expect } from "vitest";
import { Parser } from "../src/engine/Parser.js";

describe("Parser", () => {
  const parser = new Parser();

  it("parses direction shortcuts as move intents", () => {
    expect(parser.parse("n")).toMatchObject({ verb: "move", target: "north" });
    expect(parser.parse("s")).toMatchObject({ verb: "move", target: "south" });
    expect(parser.parse("e")).toMatchObject({ verb: "move", target: "east" });
    expect(parser.parse("w")).toMatchObject({ verb: "move", target: "west" });
    expect(parser.parse("u")).toMatchObject({ verb: "move", target: "up" });
    expect(parser.parse("d")).toMatchObject({ verb: "move", target: "down" });
  });

  it("parses full direction words as move intents", () => {
    expect(parser.parse("north")).toMatchObject({ verb: "move", target: "north" });
    expect(parser.parse("south")).toMatchObject({ verb: "move", target: "south" });
    expect(parser.parse("east")).toMatchObject({ verb: "move", target: "east" });
    expect(parser.parse("west")).toMatchObject({ verb: "move", target: "west" });
    expect(parser.parse("up")).toMatchObject({ verb: "move", target: "up" });
    expect(parser.parse("down")).toMatchObject({ verb: "move", target: "down" });
  });

  it("parses 'go north' as move north", () => {
    expect(parser.parse("go north")).toMatchObject({ verb: "move", target: "north" });
    expect(parser.parse("go s")).toMatchObject({ verb: "move", target: "south" });
  });

  it("parses 'look' with no target", () => {
    expect(parser.parse("look")).toMatchObject({ verb: "look" });
    expect(parser.parse("l")).toMatchObject({ verb: "look" });
  });

  it("parses 'look chair' with target", () => {
    expect(parser.parse("look chair")).toMatchObject({ verb: "look", target: "chair" });
    expect(parser.parse("l broom")).toMatchObject({ verb: "look", target: "broom" });
  });

  it("parses 'say hello everyone' with full text as target", () => {
    expect(parser.parse("say hello everyone")).toMatchObject({
      verb: "say",
      target: "hello everyone",
    });
  });

  it("passes through unknown verbs", () => {
    expect(parser.parse("dance wildly")).toMatchObject({
      verb: "dance",
      target: "wildly",
    });
    expect(parser.parse("xyzzy")).toMatchObject({ verb: "xyzzy" });
  });

  it("handles leading/trailing whitespace and case", () => {
    expect(parser.parse("  NORTH  ")).toMatchObject({ verb: "move", target: "north" });
    expect(parser.parse("  Look  ")).toMatchObject({ verb: "look" });
  });

  it("strips 'at' from 'look at <target>'", () => {
    expect(parser.parse("look at chair")).toMatchObject({ verb: "look", target: "chair" });
    expect(parser.parse("l at broom")).toMatchObject({ verb: "look", target: "broom" });
  });

  it("does not strip 'at' when it is the whole target", () => {
    // "look at" with nothing after should keep "at" as the target
    expect(parser.parse("look at")).toMatchObject({ verb: "look", target: "at" });
  });

  it("parses bare sensory verbs with no target", () => {
    expect(parser.parse("listen")).toMatchObject({ verb: "listen" });
    expect(parser.parse("smell")).toMatchObject({ verb: "smell" });
    expect(parser.parse("touch")).toMatchObject({ verb: "touch" });
    expect(parser.parse("taste")).toMatchObject({ verb: "taste" });
  });

  it("parses sensory verbs with a direct target", () => {
    expect(parser.parse("smell herbs")).toMatchObject({ verb: "smell", target: "herbs" });
    expect(parser.parse("touch altar")).toMatchObject({ verb: "touch", target: "altar" });
    expect(parser.parse("taste bread")).toMatchObject({ verb: "taste", target: "bread" });
  });

  it("strips 'to' from 'listen to <target>'", () => {
    expect(parser.parse("listen to the bell")).toMatchObject({ verb: "listen", target: "the bell" });
    expect(parser.parse("listen to wind")).toMatchObject({ verb: "listen", target: "wind" });
  });

  it("does not strip 'to' when it is the whole target for listen", () => {
    expect(parser.parse("listen to")).toMatchObject({ verb: "listen", target: "to" });
  });
});
