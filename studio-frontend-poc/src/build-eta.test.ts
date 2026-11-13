import { describe, expect, it } from "vitest";
import { aboutDuration, estimateLabel, etaLabel, etaSeconds, readFraction, tokensLabel } from "./build-eta";
import type { SpecModelBuild } from "./spec-model";

const START = "2026-10-15T10:00:00Z";
const at = (s: number) => Date.parse(START) + s * 1000;

function build(over: Partial<SpecModelBuild>): SpecModelBuild {
  return { running: true, documents: 10, done: 0, candidates: 0, judged: 0, started_at: START, ...over };
}

describe("aboutDuration", () => {
  it("rounds to minutes, and to hours past one", () => {
    expect(aboutDuration(20)).toBe("under a minute");
    expect(aboutDuration(50)).toBe("about 1 min");
    expect(aboutDuration(240)).toBe("about 4 min");
    expect(aboutDuration(3600)).toBe("about 1 h");
    expect(aboutDuration(4800)).toBe("about 1 h 20 min");
  });
});

describe("estimateLabel", () => {
  it("says how many documents and how long", () => {
    const e = { documents: 27, total_documents: 30, characters: 0, input_tokens: 0, seconds: 250, seconds_per_document: 9, measured: true, parallel: 4 };
    expect(estimateLabel(e)).toBe("27 documents, about 4 min");
    expect(estimateLabel({ ...e, documents: 1, seconds: 30 })).toBe("1 document, under a minute");
    expect(estimateLabel({ ...e, documents: 0 })).toMatch(/Nothing to read/);
  });
  it("shortens tokens", () => {
    expect(tokensLabel(800)).toBe("about 800 input tokens");
    expect(tokensLabel(52_400)).toBe("about 52k input tokens");
  });
});

describe("etaSeconds", () => {
  it("counts the start estimate down before the first document is done", () => {
    expect(etaSeconds(build({ estimated_seconds: 300 }), at(60))).toBe(240);
    expect(etaSeconds(build({ estimated_seconds: 30 }), at(60))).toBe(0);
    expect(etaSeconds(build({}), at(60))).toBeNull();
  });
  it("follows the pace so far once documents are done", () => {
    // 4 of 10 in 120 s: 30 s each, 6 left.
    expect(etaSeconds(build({ done: 4, estimated_seconds: 999 }), at(120))).toBe(180);
    expect(etaLabel(build({ done: 4 }), at(120))).toBe("about 3 min left");
  });
  it("gives none once reading is over or stopped", () => {
    expect(etaSeconds(build({ done: 10 }), at(120))).toBeNull();
    expect(etaSeconds(build({ running: false, done: 4 }), at(120))).toBeNull();
    expect(etaLabel(build({ running: false }), at(1))).toBe("");
  });
});

describe("readFraction", () => {
  it("is done over total, capped", () => {
    expect(readFraction(build({ done: 5 }))).toBe(0.5);
    expect(readFraction(build({ done: 12 }))).toBe(1);
    expect(readFraction(build({ documents: 0, running: false }))).toBe(1);
  });
});
