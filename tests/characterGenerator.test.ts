import { describe, it, expect } from "vitest";
import { TABLES, rollCharacter } from "../src/game/characterGenerator.js";

const N = 1000;

describe("rollCharacter", () => {
  it("returns all required fields with the given gender", () => {
    const r = rollCharacter("nonbinary");
    expect(r.gender).toBe("nonbinary");
    expect(typeof r.age).toBe("number");
    expect(typeof r.height).toBe("number");
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

  it("age: always within [10, 90]", () => {
    expect(rolls.every((r) => r.age >= TABLES.age.min && r.age <= TABLES.age.max)).toBe(true);
  });

  it("age: center heavy — most characters between 25 and 45", () => {
    const centerCount = rolls.filter((r) => r.age >= 25 && r.age <= 45).length;
    // mean=35, stddev=15: P(25–45) ≈ 50%
    expect(centerCount).toBeGreaterThan(350);
  });

  it("age: extremes rare — few characters younger than 15 or older than 75", () => {
    const extremeCount = rolls.filter((r) => r.age < 15 || r.age > 75).length;
    // P(age<15 or age>75) ≈ 9% + 0.4% ≈ 10%
    expect(extremeCount).toBeLessThan(150);
  });

  it("height: always within [24, 96] inches", () => {
    expect(
      rolls.every((r) => r.height >= TABLES.height.min && r.height <= TABLES.height.max),
    ).toBe(true);
  });

  it("height: center heavy — most characters between 57 and 77 inches", () => {
    const centerCount = rolls.filter((r) => r.height >= 57 && r.height <= 77).length;
    // mean=67, stddev=10: P(57–77) = P(±1σ) ≈ 68%
    expect(centerCount).toBeGreaterThan(550);
  });

  it("height: extremes rare — very few characters shorter than 47 or taller than 87 inches", () => {
    const extremeCount = rolls.filter((r) => r.height < 47 || r.height > 87).length;
    // P(|N|>2) ≈ 4.5% → ~45; generous bound
    expect(extremeCount).toBeLessThan(100);
  });

  it("build: only valid values", () => {
    const valid = new Set<string>([...TABLES.build]);
    expect(rolls.every((r) => valid.has(r.build))).toBe(true);
  });

  it("build: average is the most common build", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.build] = (counts[r.build] ?? 0) + 1;

    const avgCount = counts["average"] ?? 0;
    // center=3 ("average"), stddev=1.5: P(average) ≈ 26%
    expect(avgCount).toBeGreaterThan(150);

    for (const build of TABLES.build) {
      if (build === "average") continue;
      expect(avgCount).toBeGreaterThan(counts[build] ?? 0);
    }
  });

  it("build: extremes are rare", () => {
    const counts: Record<string, number> = {};
    for (const r of rolls) counts[r.build] = (counts[r.build] ?? 0) + 1;

    // P(skeletal) ≈ 4.8%, P(massively built) ≈ 1.1%
    expect(counts["skeletal"] ?? 0).toBeLessThan(100);
    expect(counts["massively built"] ?? 0).toBeLessThan(50);
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
