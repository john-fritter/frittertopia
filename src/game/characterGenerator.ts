// Sum of 12 uniforms minus 6: Irwin-Hall approximation of N(0,1).
function normalRandom(): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Math.random();
  return sum - 6;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniformPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function normalPickFromArray<T>(arr: readonly T[], center: number, stddev: number): T {
  const idx = clamp(Math.round(center + normalRandom() * stddev), 0, arr.length - 1);
  return arr[idx]!;
}

export const TABLES = {
  age: { mean: 35, stddev: 15, min: 10, max: 90 },
  height: { mean: 67, stddev: 10, min: 24, max: 96 },
  build: [
    "skeletal",
    "very slight",
    "slight",
    "average",
    "stocky",
    "heavy",
    "very heavy",
    "massively built",
  ] as const,
  skin: {
    normal: [
      "pale ivory",
      "fair",
      "light beige",
      "warm beige",
      "medium beige",
      "olive",
      "warm brown",
      "medium brown",
      "dark brown",
      "deep brown",
      "near-black",
    ] as const,
    weird: [
      "chalk white",
      "ash grey",
      "stone grey",
      "slate blue-grey",
      "deep purple",
      "violet",
      "pale blue",
      "teal",
      "seafoam",
      "olive-green",
      "deep green",
      "ochre yellow",
      "burnt orange",
      "brick red",
      "deep crimson",
      "gold",
      "bronze",
      "silver",
      "charcoal",
      "near-black with a blue sheen",
      "iridescent",
      "translucent with visible structure beneath",
      "faintly luminous",
      "scaled",
      "furred",
      "feathered",
      "bark-textured",
      "chitinous",
      "paper-dry",
    ] as const,
  },
  eyes: {
    normal: [
      "black",
      "dark brown",
      "brown",
      "hazel",
      "amber",
      "green",
      "grey",
      "blue",
      "pale blue",
      "near-colorless",
    ] as const,
    weird: [
      "vivid violet",
      "vivid pink",
      "vivid orange",
      "vivid red",
      "silver",
      "gold",
      "white",
      "colorless",
      "entirely black",
      "compound",
      "reflective like an animal's in low light",
      "horizontal pupil",
      "vertical slit pupil",
      "entirely one flat color with no visible pupil",
      "too large for the face",
      "faintly luminous",
      "two different colors",
      "pupil the wrong shape entirely",
    ] as const,
  },
  hair: {
    normal: [
      "black",
      "dark brown",
      "brown",
      "auburn",
      "red",
      "dirty blonde",
      "blonde",
      "silver-blonde",
      "grey",
      "white",
      "bald",
    ] as const,
    weird: [
      "vivid red",
      "vivid orange",
      "vivid yellow",
      "vivid green",
      "vivid blue",
      "vivid violet",
      "vivid pink",
      "white-blonde",
      "pure white",
      "pure black with a blue sheen",
      "silver",
      "gold",
      "iridescent",
      "feathers",
      "fine tendrils that move slightly",
      "quills",
      "metallic",
      "moss or lichen",
      "sheds visibly",
      "color shifts in different light",
      "bald with unusual scalp texture",
    ] as const,
  },
  fantasticalFeature: [
    "pointed ears",
    "very large ears",
    "absent ears",
    "brow ridge (subtle)",
    "brow ridge (dramatic)",
    "small horns (two symmetrical)",
    "large horns",
    "single horn",
    "fangs (upper canines subtle)",
    "tusks (lower jaw prominent)",
    "forked tongue",
    "pointed teeth throughout",
    "a second set of eyelids",
    "eyes that reflect light in darkness",
    "vestigial gills (neck dry non-functional)",
    "small tail",
    "long tail",
    "tail with a tuft",
    "tail with a flat paddle end",
    "claws instead of nails",
    "retractable claws",
    "pawpads on palms",
    "webbed fingers and toes",
    "digitigrade legs",
    "patches of scales (jaw forearms or shoulders)",
    "patches of feathers (jaw forearms or shoulders)",
    "patches of fur where it wouldn't normally grow",
    "very dense body hair almost fur",
    "feathered eyebrows",
    "a crest of feathers or spines along the scalp",
  ] as const,
  skinMarks: {
    firstMarkChance: 0.4,
    secondMarkChance: 0.2,
    types: [
      "freckles",
      "scar (face)",
      "scar (body)",
      "birthmark",
      "small tattoo",
      "large tattoo",
      "extensive tattoos",
      "sun-weathered skin",
      "age spots",
    ] as const,
    freckleIntensity: ["light", "heavy"] as const,
  },
} as const;

export type CharacterRoll = {
  gender: string;
  age: number;
  height: number;
  build: string;
  skin: string;
  eyes: string;
  hair: string;
  fantasticalFeature: string | null;
  skinMarks: string[];
};

function rollOneSkinMark(): string {
  const base = uniformPick(TABLES.skinMarks.types);
  if (base === "freckles") {
    return `freckles (${uniformPick(TABLES.skinMarks.freckleIntensity)})`;
  }
  return base;
}

function skinMarkBase(mark: string): string {
  return mark.startsWith("freckles") ? "freckles" : mark;
}

function rollSkinMarks(): string[] {
  if (Math.random() >= TABLES.skinMarks.firstMarkChance) return [];

  const first = rollOneSkinMark();
  const marks: string[] = [first];

  if (Math.random() < TABLES.skinMarks.secondMarkChance) {
    let second = rollOneSkinMark();
    if (skinMarkBase(second) === skinMarkBase(first)) {
      second = rollOneSkinMark(); // one reroll attempt
    }
    if (skinMarkBase(second) !== skinMarkBase(first)) {
      marks.push(second);
    }
  }

  return marks;
}

export function rollCharacter(gender: string): CharacterRoll {
  const age = clamp(
    Math.round(TABLES.age.mean + TABLES.age.stddev * normalRandom()),
    TABLES.age.min,
    TABLES.age.max,
  );

  const height = clamp(
    Math.round(TABLES.height.mean + TABLES.height.stddev * normalRandom()),
    TABLES.height.min,
    TABLES.height.max,
  );

  // center=3 ("average"), stddev=1.5 puts skeletal and massively built at the rare tails
  const build = normalPickFromArray(TABLES.build, 3, 1.5);

  const skin =
    Math.random() < 0.15
      ? uniformPick(TABLES.skin.weird)
      : uniformPick(TABLES.skin.normal);

  const eyes =
    Math.random() < 0.15
      ? uniformPick(TABLES.eyes.weird)
      : uniformPick(TABLES.eyes.normal);

  const hair =
    Math.random() < 0.15
      ? uniformPick(TABLES.hair.weird)
      : uniformPick(TABLES.hair.normal);

  const fantasticalFeature =
    Math.random() < 0.3 ? uniformPick(TABLES.fantasticalFeature) : null;

  const skinMarks = rollSkinMarks();

  return { gender, age, height, build, skin, eyes, hair, fantasticalFeature, skinMarks };
}
