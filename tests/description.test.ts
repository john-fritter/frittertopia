import { describe, it, expect } from "vitest";
import {
  renderDescription,
  type DescriptionBlock,
} from "../src/game/description.js";

function block(
  overrides: Partial<DescriptionBlock> & { id: string; text: string }
): DescriptionBlock {
  return { type: "base", ...overrides };
}

describe("renderDescription", () => {
  it("renders a single reduced+ block at full visibility", () => {
    const blocks = [
      block({ id: "b1", visibility: "reduced+", text: "Room text." }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Room text."
    );
  });

  it("renders a single reduced+ block at reduced visibility", () => {
    const blocks = [
      block({ id: "b1", visibility: "reduced+", text: "Room text." }),
    ];
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Room text."
    );
  });

  it("does not render reduced+ block at minimal visibility", () => {
    const blocks = [
      block({ id: "b1", visibility: "reduced+", text: "Room text." }),
    ];
    expect(renderDescription(blocks, { visibility: "minimal" })).toBe("");
  });

  it("exact visibility match only matches that level", () => {
    const blocks = [
      block({ id: "b1", visibility: "minimal", text: "Bare minimum." }),
    ];
    expect(renderDescription(blocks, { visibility: "minimal" })).toBe(
      "Bare minimum."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe("");
    expect(renderDescription(blocks, { visibility: "full" })).toBe("");
  });

  it("prefers exact match over threshold", () => {
    const blocks = [
      block({ id: "b1", visibility: "reduced+", text: "Threshold text." }),
      block({ id: "b2", visibility: "full", text: "Full text." }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Full text."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Threshold text."
    );
  });

  it("appends details when visibility matches", () => {
    const blocks = [
      block({
        id: "b1",
        visibility: "reduced+",
        text: "Base text.",
        details: [{ visibility: "full", text: "Detail text." }],
      }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Base text. Detail text."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Base text."
    );
  });

  it("omitted visibility matches any level", () => {
    const blocks = [block({ id: "b1", text: "Always visible." })];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Always visible."
    );
    expect(renderDescription(blocks, { visibility: "none" })).toBe(
      "Always visible."
    );
  });

  it("none+ matches any level", () => {
    const blocks = [
      block({ id: "b1", visibility: "none+", text: "Universal." }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Universal."
    );
    expect(renderDescription(blocks, { visibility: "none" })).toBe(
      "Universal."
    );
  });

  it("minimal+ matches minimal, reduced, and full", () => {
    const blocks = [
      block({ id: "b1", visibility: "minimal+", text: "Wide range." }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Wide range."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Wide range."
    );
    expect(renderDescription(blocks, { visibility: "minimal" })).toBe(
      "Wide range."
    );
    expect(renderDescription(blocks, { visibility: "none" })).toBe("");
  });

  it("courtyard tiers work correctly", () => {
    const blocks: DescriptionBlock[] = [
      {
        id: "courtyard-base",
        type: "base",
        visibility: "reduced+",
        text: "Cracked flagstones.",
        details: [{ visibility: "full", text: "Moss creeps." }],
      },
      {
        id: "courtyard-minimal",
        type: "base",
        visibility: "minimal",
        text: "Stone underfoot.",
      },
      {
        id: "courtyard-none",
        type: "base",
        visibility: "none",
        text: "Cold stone underfoot.",
      },
    ];

    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Cracked flagstones. Moss creeps."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Cracked flagstones."
    );
    expect(renderDescription(blocks, { visibility: "minimal" })).toBe(
      "Stone underfoot."
    );
    expect(renderDescription(blocks, { visibility: "none" })).toBe(
      "Cold stone underfoot."
    );
  });

  it("ignores non-base block types", () => {
    const blocks: DescriptionBlock[] = [
      { id: "b1", type: "base", text: "Base." },
      { id: "b2", type: "weather", text: "Rainy.", weather: ["rain"] },
      { id: "b3", type: "season", text: "Winter.", months: [12, 1, 2] },
      { id: "b4", type: "temperature", text: "Cold.", range: [-10, 5] },
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe("Base.");
  });

  it("returns empty string when no blocks match", () => {
    const blocks = [
      block({ id: "b1", visibility: "full", text: "Only at full." }),
    ];
    expect(renderDescription(blocks, { visibility: "none" })).toBe("");
  });

  it("room with only a single reduced+ block renders at full visibility", () => {
    const blocks = [
      block({ id: "b1", visibility: "reduced+", text: "The room." }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "The room."
    );
  });

  it("multiple details append in order", () => {
    const blocks = [
      block({
        id: "b1",
        visibility: "reduced+",
        text: "Main.",
        details: [
          { visibility: "full", text: "Detail one." },
          { visibility: "reduced+", text: "Detail two." },
        ],
      }),
    ];
    expect(renderDescription(blocks, { visibility: "full" })).toBe(
      "Main. Detail one. Detail two."
    );
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Main. Detail two."
    );
  });

  it("detail with omitted visibility always appends", () => {
    const blocks = [
      block({
        id: "b1",
        visibility: "reduced+",
        text: "Base.",
        details: [{ text: "Always here." }],
      }),
    ];
    expect(renderDescription(blocks, { visibility: "reduced" })).toBe(
      "Base. Always here."
    );
  });
});
