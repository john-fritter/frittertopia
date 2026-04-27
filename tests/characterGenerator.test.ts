import { describe, it, expect } from "vitest";
import { TABLES, rollCharacter } from "../src/game/characterGenerator.js";

const N = 1000;

describe("rollCharacter", () => {
  it("returns all required fields with the given gender", () => {
    const r = rollCharacter("nonbinary");
    expect(r.gender).toBe("nonbinary");
    expect(typeof r.age).toBe("string");
    expect(typeof r.height).toBe("string");
    expect(typeof r.build).toBe("string");
    expect(typeof r.skin).toBe("string");
    expect(typeof r.eyes).toBe("string");
    expect(typeof r.hair).toBe("string");
    expect(r.fantasticalFeature === null || typeof r.fantasticalFeature === "string").toBe(true);
    expect(Array.isArray(r.skinMarks)).toBe(true);
  });

  it("passes gender through unchanged", () => {
    expect(rollCharacter("female").gender).toBe("female");
    expect(rollCharacter("male").gender).toBe("male");
    expect(rollCharacter("it").gender).toBe("it");
  });
});

describe("distributions over 1000 rolls", () => {
  const rolls = Array.from({ length: N }, (_, i) =>
    rollCharacter(i % 2 === 0 ? "female" : "male"),
  );

  const validAgeBrackets = new Set<string>([...TABLES.ageBrackets, "ageless"]);
  const validHeightBrackets = new Set<string>([...TABLES.heightBrackets]);
  const validBuildBrackets = new Set<string>([...TABLES.buildBrackets]);

  it("age: all values are from the age brackets table or 'ageless'", () => {
    expect(rolls.every((r) => validAgeBrackets.has(r.age))).toBe(true);
  });

  it("age: 'adult' appears frequently and outnumbers the extremes", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.age] = (counts[r.age] ?? 0) + 1;
    const adultCount = counts["adult"] ?? 0;
    // center=3 ("adult"), stddev=1.8: P(adult) ≈ 22%; expected ~220
    expect(adultCount).toBeGreaterThan(150);
    // adult should clearly outnumber the extremes (child/ageless/ancient)
    expect(adultCount).toBeGreaterThan(counts["child"] ?? 0);
    expect(adultCount).toBeGreaterThan(counts["ageless"] ?? 0);
    expect(adultCount).toBeGreaterThan(counts["ancient"] ?? 0);
  });

  it("age: 'ageless' appears roughly 1/30 of the time (2–5%)", () => {
    const agelessCount = rolls.filter((r) => r.age === "ageless").length;
    // P(upper overflow) ≈ 2.6%; 4-sigma bounds ≈ [6, 46]
    expect(agelessCount).toBeGreaterThan(10);
    expect(agelessCount).toBeLessThan(55);
  });

  it("age: 'child' is rare", () => {
    const childCount = rolls.filter((r) => r.age === "child").length;
    // lower-end clamping: P(child) ≈ 8.2%, expected ~82; generous upper bound
    expect(childCount).toBeLessThan(150);
  });

  it("height: all values are from the height brackets table", () => {
    expect(rolls.every((r) => validHeightBrackets.has(r.height))).toBe(true);
  });

  it("height: 'average' appears frequently and outnumbers the extremes", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.height] = (counts[r.height] ?? 0) + 1;
    const avgCount = counts["average"] ?? 0;
    // center=3 ("average"), stddev=1.8: P(average) ≈ 22%; expected ~220
    expect(avgCount).toBeGreaterThan(150);
    // average should clearly outnumber the extremes
    expect(avgCount).toBeGreaterThan(counts["tiny"] ?? 0);
    expect(avgCount).toBeGreaterThan(counts["enormous"] ?? 0);
  });

  it("height: 'enormous' and 'tiny' are rare", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.height] = (counts[r.height] ?? 0) + 1;
    // P(enormous or tiny) ≈ 8.2% each due to clamping; expected ~82; generous bound
    expect(counts["enormous"] ?? 0).toBeLessThan(150);
    expect(counts["tiny"] ?? 0).toBeLessThan(150);
  });

  it("build: all values are from the build brackets table", () => {
    expect(rolls.every((r) => validBuildBrackets.has(r.build))).toBe(true);
  });

  it("build: 'average' appears frequently and outnumbers the extremes", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.build] = (counts[r.build] ?? 0) + 1;
    const avgCount = counts["average"] ?? 0;
    // center=3 ("average"), stddev=1.8: P(average) ≈ 22%; expected ~220
    expect(avgCount).toBeGreaterThan(150);
    // average should clearly outnumber the extremes
    expect(avgCount).toBeGreaterThan(counts["skeletal"] ?? 0);
    expect(avgCount).toBeGreaterThan(counts["massive"] ?? 0);
  });

  it("build: 'skeletal' and 'massive' are rare", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.build] = (counts[r.build] ?? 0) + 1;
    // P(skeletal or massive) ≈ 8.2% each due to clamping; generous bound
    expect(counts["skeletal"] ?? 0).toBeLessThan(150);
    expect(counts["massive"] ?? 0).toBeLessThan(150);
  });

  it("skin: normal/weird split is approximately 85/15", () => {
    const weirdSkin = new Set<string>([...TABLES.skin.weird]);
    const weirdCount = rolls.filter((r) => weirdSkin.has(r.skin)).length;
    // expected ~150; 4-sigma bounds ≈ [105, 195]
    expect(weirdCount).toBeGreaterThan(80);
    expect(weirdCount).toBeLessThan(230);
  });

  it("eyes: normal/weird split is approximately 85/15", () => {
    const weirdEyes = new Set<string>([...TABLES.eyes.weird]);
    const weirdCount = rolls.filter((r) => weirdEyes.has(r.eyes)).length;
    expect(weirdCount).toBeGreaterThan(80);
    expect(weirdCount).toBeLessThan(230);
  });

  it("hair: normal/weird split is approximately 85/15", () => {
    const weirdHair = new Set<string>([...TABLES.hair.weird]);
    const weirdCount = rolls.filter((r) => weirdHair.has(r.hair)).length;
    expect(weirdCount).toBeGreaterThan(80);
    expect(weirdCount).toBeLessThan(230);
  });

  it("skin: all values come from the normal or weird table", () => {
    const allSkin = new Set<string>([...TABLES.skin.normal, ...TABLES.skin.weird]);
    expect(rolls.every((r) => allSkin.has(r.skin))).toBe(true);
  });

  it("eyes: all values come from the normal or weird table", () => {
    const allEyes = new Set<string>([...TABLES.eyes.normal, ...TABLES.eyes.weird]);
    expect(rolls.every((r) => allEyes.has(r.eyes))).toBe(true);
  });

  it("hair: all values come from the normal or weird table", () => {
    const allHair = new Set<string>([...TABLES.hair.normal, ...TABLES.hair.weird]);
    expect(rolls.every((r) => allHair.has(r.hair))).toBe(true);
  });

  it("fantastical feature: appears roughly 30% of the time", () => {
    const withFeature = rolls.filter((r) => r.fantasticalFeature !== null).length;
    // expected ~300; 4-sigma bounds ≈ [242, 358]
    expect(withFeature).toBeGreaterThan(200);
    expect(withFeature).toBeLessThan(400);
  });

  it("fantastical feature: null or a value from the fantastical feature table", () => {
    const valid = new Set<string>([...TABLES.fantasticalFeature]);
    expect(
      rolls.every((r) => r.fantasticalFeature === null || valid.has(r.fantasticalFeature)),
    ).toBe(true);
  });

  it("skin marks: always an array", () => {
    expect(rolls.every((r) => Array.isArray(r.skinMarks))).toBe(true);
  });

  it("skin marks: no character has more than 2", () => {
    expect(rolls.every((r) => r.skinMarks.length <= 2)).toBe(true);
  });

  it("skin marks: approximately 40% of characters have at least one", () => {
    const withMarks = rolls.filter((r) => r.skinMarks.length > 0).length;
    // expected ~400; P=0.4, std dev ≈ 15.5, 4-sigma bounds ≈ [338, 462]
    expect(withMarks).toBeGreaterThan(280);
    expect(withMarks).toBeLessThan(520);
  });

  it("skin marks: approximately 20% of marked characters have a second mark", () => {
    const withMarks = rolls.filter((r) => r.skinMarks.length > 0);
    const withSecond = withMarks.filter((r) => r.skinMarks.length >= 2).length;
    // expected ~80 (20% of ~400); generous bounds
    expect(withSecond).toBeGreaterThan(30);
    expect(withSecond).toBeLessThan(150);
  });

  it("skin marks: all values are from the marks table or freckles variants", () => {
    const validTypes = new Set<string>([
      ...TABLES.skinMarks.types.filter((t) => t !== "freckles"),
      "freckles (light)",
      "freckles (heavy)",
    ]);
    for (const r of rolls) {
      for (const mark of r.skinMarks) {
        expect(validTypes.has(mark)).toBe(true);
      }
    }
  });

  it("skin marks: no two marks on the same character share a base type", () => {
    function base(mark: string): string {
      return mark.startsWith("freckles") ? "freckles" : mark;
    }
    for (const r of rolls) {
      if (r.skinMarks.length === 2) {
        expect(base(r.skinMarks[0]!)).not.toBe(base(r.skinMarks[1]!));
      }
    }
  });
});
