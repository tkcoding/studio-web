import { describe, expect, it } from "vitest";

import { weightedMixture } from "./analysis";

/* The `bloat` half of this file moved to `spec_quality/analysis.rs`, and its
 * tests with it — eleven of them, over the same real payload. What is left is
 * the set-wide mixture, which stayed in the browser because its only caller
 * aggregates results this page gathered itself. */

describe("weightedMixture", () => {
  it("weights each document by its length, not by being a document", () => {
    const { mixture, tokens } = weightedMixture([
      { mixture: { requirement: 1, other: 0 }, n_tokens: 4000 },
      { mixture: { requirement: 0, other: 1 }, n_tokens: 40 },
    ]);

    expect(tokens).toBe(4040);
    // A plain average would call this set half requirement and half other,
    // which is exactly the wrong answer about 4,040 words.
    expect(mixture.requirement).toBeCloseTo(4000 / 4040, 6);
    expect(mixture.other).toBeCloseTo(40 / 4040, 6);
  });

  it("keeps a document that reports a mixture but no length", () => {
    const { mixture, tokens } = weightedMixture([
      { mixture: { design: 1 }, n_tokens: 9 },
      { mixture: { other: 1 } },
    ]);
    expect(tokens).toBe(10);
    expect(mixture.design).toBeCloseTo(0.9, 6);
    expect(mixture.other).toBeCloseTo(0.1, 6);
  });

  it("returns an empty mixture, not four zeroes, when nothing was readable", () => {
    // An empty bar reads as "nothing to show"; a bar of confident zeroes reads
    // as a finding about the documents, which this is not.
    expect(weightedMixture([])).toEqual({ mixture: {}, tokens: 0 });
    expect(weightedMixture([null, undefined, {}, { mixture: null }])).toEqual({
      mixture: {},
      tokens: 0,
    });
  });

  it("ignores a share that is not a finite number", () => {
    const { mixture } = weightedMixture([
      { mixture: { requirement: 1, design: Number.NaN } as never, n_tokens: 10 },
    ]);
    expect(mixture.requirement).toBe(1);
    expect(mixture.design).toBeUndefined();
  });
});
