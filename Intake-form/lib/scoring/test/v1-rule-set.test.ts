// End-to-end tests for V1_RULE_SET. Verifies every documented case from
// PLAN_PHASE_2.md §5 and Investigation 6 against the actual seeded rules.
// Acts as the regression fence: if anyone edits v1-rule-set.ts and changes
// a documented outcome, these tests catch it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { V1_RULE_SET, evaluate, type LeadInput } from "../src/index.js";

const META = { ruleSetId: "rs-test", version: 1 };

function score(lead: LeadInput) {
  return evaluate(V1_RULE_SET, lead, META);
}

// Base set of form values for an A-rank-eligible lead. Tests override
// individual fields to exercise specific branches.
const baseA: LeadInput = {
  preRetirementReview: "Yes",
  age: "59 1/2 or over",
  maritalStatus: "Yes",
  maxingTsp: "YES",
  externalInvestments: "YES",
};

describe("V1 RuleSet — A path via age 59½+", () => {
  it("A-10: age 59½+ with TSP over $1M", () => {
    const r = score({ ...baseA, tspBalance: "Over $1 million" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "10  (over $1mm)");
  });

  it("A-9: age 59½+ with TSP $600k-$1M", () => {
    const r = score({ ...baseA, tspBalance: "$600k - $1 million" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "9 ($601k - $1mm)");
  });

  it("A-8: age 59½+ with TSP $350k-$600k", () => {
    const r = score({ ...baseA, tspBalance: "$350k - $600k" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "8  ($351k-$600k)");
  });

  it("A-7: age 59½+ with TSP under $350k", () => {
    const r = score({ ...baseA, tspBalance: "Under $350k" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "7  ($0-$350k)");
  });

  it("A-rank with no TSP answer: rank=A, leadScore=undefined", () => {
    const r = score({ ...baseA }); // no tspBalance set
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, undefined);
  });
});

describe("V1 RuleSet — A path via 55-59 + separating=YES", () => {
  const base5559: LeadInput = {
    preRetirementReview: "Yes",
    age: "55 - 59",
    separating: "YES",
    maritalStatus: "Yes",
    maxingTsp: "YES",
    externalInvestments: "YES",
  };

  it("A-10 via separating path", () => {
    const r = score({ ...base5559, tspBalance: "Over $1 million" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "10  (over $1mm)");
  });

  it("A-9 via separating path", () => {
    const r = score({ ...base5559, tspBalance: "$600k - $1 million" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "9 ($601k - $1mm)");
  });

  it("A-8 via separating path", () => {
    const r = score({ ...base5559, tspBalance: "$350k - $600k" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "8  ($351k-$600k)");
  });

  it("A-7 via separating path", () => {
    const r = score({ ...base5559, tspBalance: "Under $350k" });
    assert.equal(r.rank, "A");
    assert.equal(r.leadScore, "7  ($0-$350k)");
  });

  it("55-59 NOT separating → not A via this path", () => {
    const r = score({ ...base5559, separating: "NO", tspBalance: "Over $1 million" });
    // Falls through to B+ (since maxingTsp=YES + externalInvestments=YES).
    assert.equal(r.rank, "B+");
    assert.equal(r.leadScore, undefined);
  });
});

describe("V1 RuleSet — B+ path", () => {
  it("B+: under 59½, maxingTsp=YES, externalInvestments=YES", () => {
    const r = score({
      preRetirementReview: "Yes",
      age: "50-54",
      maritalStatus: "Yes",
      maxingTsp: "YES",
      externalInvestments: "YES",
      tspBalance: "Under $350k",
    });
    assert.equal(r.rank, "B+");
    assert.equal(r.leadScore, undefined);
  });

  it("B+ wins over C when both eligible (first match wins)", () => {
    // Lead has all C-eligible fields filled AND maxing/external YES, so B+
    // should win since its rule appears earlier in v1.
    const r = score({
      preRetirementReview: "Yes",
      age: "40-49",
      maritalStatus: "No",
      maxingTsp: "YES",
      externalInvestments: "YES",
      tspBalance: "Under $350k",
    });
    assert.equal(r.rank, "B+");
  });
});

describe("V1 RuleSet — C path", () => {
  it("C: full survey but doesn't qualify A or B+", () => {
    const r = score({
      preRetirementReview: "Yes",
      age: "40-49",
      maritalStatus: "Yes",
      maxingTsp: "NO",
      externalInvestments: "NO",
      tspBalance: "Under $350k",
    });
    assert.equal(r.rank, "C");
    assert.equal(r.leadScore, undefined);
  });

  it("C requires every survey field filled — missing one → N/A default", () => {
    const r = score({
      preRetirementReview: "Yes",
      age: "40-49",
      maritalStatus: "Yes",
      maxingTsp: "NO",
      externalInvestments: "NO",
      // tspBalance omitted
    });
    assert.equal(r.rank, "N/A");
  });
});

describe("V1 RuleSet — N/A path (default + short-circuit)", () => {
  it("preRetirementReview=No short-circuits to N/A even with everything else filled", () => {
    const r = score({
      preRetirementReview: "No",
      age: "59 1/2 or over",
      maritalStatus: "Yes",
      maxingTsp: "YES",
      externalInvestments: "YES",
      tspBalance: "Over $1 million",
    });
    assert.equal(r.rank, "N/A");
    // Critical: leadScore must NOT be set even though all the A-rank conditions
    // (other than the short-circuit) are met.
    assert.equal(r.leadScore, undefined);
  });

  it("empty lead → N/A default", () => {
    const r = score({});
    assert.equal(r.rank, "N/A");
    assert.equal(r.leadScore, undefined);
  });

  it("under 59½ + partial survey → N/A (doesn't satisfy A, B+, or C)", () => {
    const r = score({
      preRetirementReview: "Yes",
      age: "below 40",
      maxingTsp: "NO",
      // missing maritalStatus, externalInvestments, tspBalance
    });
    assert.equal(r.rank, "N/A");
  });
});

describe("V1 RuleSet — unreachable B rank (Q12 doesn't exist)", () => {
  it("plain B rank is never produced by any test lead", () => {
    // Sanity check: even with all combinations of form values, V1_RULE_SET
    // should never emit rank="B" (plain B). See comment in v1-rule-set.ts.
    const samples: LeadInput[] = [
      { preRetirementReview: "Yes", age: "59 1/2 or over", tspBalance: "Over $1 million" },
      { preRetirementReview: "Yes", age: "55 - 59", separating: "YES" },
      { preRetirementReview: "Yes", age: "40-49", maxingTsp: "YES", externalInvestments: "YES", maritalStatus: "Yes", tspBalance: "Under $350k" },
      { preRetirementReview: "Yes", age: "40-49", maxingTsp: "NO", externalInvestments: "NO", maritalStatus: "Yes", tspBalance: "Under $350k" },
      { preRetirementReview: "No" },
      {},
    ];
    for (const lead of samples) {
      const r = score(lead);
      assert.notEqual(r.rank, "B", `unexpected B rank for ${JSON.stringify(lead)}`);
    }
  });
});

describe("V1 RuleSet — picklist whitespace preservation", () => {
  // The exact strings Salesforce expects. Any change breaks SF inserts.
  it("Lead Score 7 has TWO spaces after the 7", () => {
    const r = score({ ...baseA, tspBalance: "Under $350k" });
    assert.equal(r.leadScore, "7  ($0-$350k)");
    // explicit length: "7" + "  " + "($0-$350k)" = 1 + 2 + 10 = 13
    assert.equal(r.leadScore?.length, 13);
  });

  it("Lead Score 8 has TWO spaces", () => {
    const r = score({ ...baseA, tspBalance: "$350k - $600k" });
    assert.equal(r.leadScore, "8  ($351k-$600k)");
  });

  it("Lead Score 9 has ONE space (the outlier)", () => {
    const r = score({ ...baseA, tspBalance: "$600k - $1 million" });
    assert.equal(r.leadScore, "9 ($601k - $1mm)");
    // "9" + " " + "($601k - $1mm)" = 1 + 1 + 14 = 16
    assert.equal(r.leadScore?.length, 16);
  });

  it("Lead Score 10 has TWO spaces", () => {
    const r = score({ ...baseA, tspBalance: "Over $1 million" });
    assert.equal(r.leadScore, "10  (over $1mm)");
  });
});
