// ICE and the order it feeds, as the PRD "Prioritise functionality" defines
// them: these pin the formula, the bands, that unknown stays unknown, and that
// prerequisites and cycles shape the order without entering the score.
import { describe, expect, it } from "vitest";

import { confidenceFromBasis, confidenceFromHypotheses, easeFromEffort, iceScore, orderItems, unknown, type Criterion } from "./prioritise";

describe("Confidence from checked hypotheses", () => {
  const claim = (state: "unchecked" | "supports" | "contradicts" | "insufficient", methods: string[] = []) => ({ claim: "search", state, methods });

  it("leaves it to the requirement's basis when nothing was checked", () => {
    expect(confidenceFromHypotheses([])).toBeNull();
    expect(confidenceFromHypotheses([claim("unchecked")])).toBeNull();
  });

  it("follows the anchors: direct evidence 5, indirect 3, against 1", () => {
    expect(confidenceFromHypotheses([claim("supports", ["benefit"])])?.score).toBe(5);
    expect(confidenceFromHypotheses([claim("supports", ["problem"])])?.score).toBe(3);
    expect(confidenceFromHypotheses([claim("supports", ["ux/usability-test"])])?.score).toBe(3);
    expect(confidenceFromHypotheses([claim("contradicts")])?.score).toBe(1);
    expect(confidenceFromHypotheses([claim("insufficient")])?.score).toBe(1);
  });

  it("keeps evidence for and against unresolved", () => {
    expect(confidenceFromHypotheses([claim("supports", ["benefit"]), claim("contradicts")])).toMatchObject({ origin: "unknown" });
  });
});

const v = (score: number): Criterion => ({ score, origin: "entered", basis: "" });

describe("ICE", () => {
  it("is the mean of the three", () => {
    expect(iceScore({ impact: v(4), confidence: v(5), ease: v(6) })).toMatchObject({ score: 5, range: null, missing: [] });
  });

  it("keeps an unknown unknown: no score, and says which", () => {
    expect(iceScore({ impact: v(4), confidence: unknown(), ease: v(6) })).toMatchObject({ score: null, missing: ["confidence"] });
  });

  it("refuses a value off the scale", () => {
    expect(iceScore({ impact: v(11), confidence: v(5), ease: v(6) })).toMatchObject({ score: null, invalid: ["impact"] });
  });

  it("carries a range through to the score", () => {
    expect(iceScore({ impact: v(4), confidence: v(5), ease: easeFromEffort([1.5, 3], "") })).toMatchObject({ score: null, range: [5, 5.67] });
  });
});

describe("Ease from effort", () => {
  it("follows the bands", () => {
    expect([0.5, 1, 2, 4, 8, 9].map((w) => easeFromEffort(w, "").score)).toEqual([10, 10, 8, 6, 4, 2]);
  });

  it("gives a range when the estimate crosses a band", () => {
    expect(easeFromEffort([1.5, 3], "")).toMatchObject({ range: [6, 8] });
    expect(easeFromEffort([3, 4], "")).toMatchObject({ score: 6 });
  });

  it("does not make a value of nonsense", () => {
    expect(easeFromEffort(0, "").origin).toBe("unknown");
  });
});

describe("Confidence from a requirement's basis", () => {
  it("reads an assumption as weak and a citation as indirect, and no basis as unknown", () => {
    expect(confidenceFromBasis("assumption").score).toBe(1);
    expect(confidenceFromBasis("cited").score).toBe(3);
    expect(confidenceFromBasis("stated")).toMatchObject({ origin: "unknown" });
  });
});

describe("delivery order", () => {
  it("ranks by score, but puts a prerequisite first", () => {
    const o = orderItems(
      [
        { id: "a", score: 9 },
        { id: "b", score: 5 },
        { id: "c", score: 7 },
      ],
      new Map([["a", ["b"]]]),
    );
    expect(o.order).toEqual(["c", "b", "a"]);
  });

  it("marks a tie as a tie and puts the unscored last", () => {
    const o = orderItems(
      [
        { id: "a", score: null },
        { id: "b", score: 5 },
        { id: "c", score: 5 },
      ],
      new Map(),
    );
    expect(o.order).toEqual(["b", "c", "a"]);
    expect([...o.ties].sort()).toEqual(["b", "c"]);
  });

  it("names a prerequisite outside the set, and shows a cycle instead of hiding it", () => {
    const o = orderItems(
      [
        { id: "a", score: 3 },
        { id: "b", score: 8 },
        { id: "c", score: 1 },
      ],
      new Map([
        ["a", ["b", "x"]],
        ["b", ["a"]],
      ]),
    );
    expect(o.outside.get("a")).toEqual(["x"]);
    expect(o.cycles).toHaveLength(1);
    expect([...o.cycles[0]].sort()).toEqual(["a", "b"]);
    expect(o.order).toEqual(["c", "b", "a"]);
  });
});
