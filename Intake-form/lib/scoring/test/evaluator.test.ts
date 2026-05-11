// Unit tests for the evaluator's core semantics: condition ops, group
// composition, first-match-wins, default fallback, and trace generation.
//
// Uses small hand-crafted RuleSets so each test isolates one behavior.
// V1 RuleSet end-to-end tests live in v1-rule-set.test.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type LeadInput, type RuleSet } from "../src/index.js";

function rs(rules: RuleSet["rules"], defaultOutcome: RuleSet["default"] = {}): RuleSet {
  return { schemaVersion: 1, rules, default: defaultOutcome };
}

describe("evaluator — condition ops", () => {
  it("equals matches when field value === target", () => {
    const ruleSet = rs([
      {
        id: "r1",
        name: "age=59 1/2 or over",
        when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
        then: { rank: "A" },
      },
    ]);
    const result = evaluate(ruleSet, { age: "59 1/2 or over" });
    assert.equal(result.rank, "A");
  });

  it("equals does NOT match when field is null/empty", () => {
    const ruleSet = rs([
      {
        id: "r1",
        name: "age=59 1/2 or over",
        when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
        then: { rank: "A" },
      },
    ]);
    const result = evaluate(ruleSet, { age: "" });
    assert.equal(result.rank, undefined);
  });

  it("notEquals requires the field to be present", () => {
    const ruleSet = rs([
      {
        id: "r1",
        name: "age != below 40",
        when: { all: [{ field: "age", op: "notEquals", value: "below 40" }] },
        then: { rank: "C" },
      },
    ]);
    // Null age does NOT satisfy notEquals.
    assert.equal(evaluate(ruleSet, {}).rank, undefined);
    // Different age does satisfy.
    assert.equal(evaluate(ruleSet, { age: "55 - 59" }).rank, "C");
    // Same value does not.
    assert.equal(evaluate(ruleSet, { age: "below 40" }).rank, undefined);
  });

  it("isNull / notNull check presence", () => {
    const isNullRule = rs([
      {
        id: "n1",
        name: "missing TSP",
        when: { all: [{ field: "tspBalance", op: "isNull" }] },
        then: { rank: "N/A" },
      },
    ]);
    assert.equal(evaluate(isNullRule, {}).rank, "N/A");
    assert.equal(evaluate(isNullRule, { tspBalance: "" }).rank, "N/A");
    assert.equal(evaluate(isNullRule, { tspBalance: "Under $350k" }).rank, undefined);

    const notNullRule = rs([
      {
        id: "n2",
        name: "has TSP",
        when: { all: [{ field: "tspBalance", op: "notNull" }] },
        then: { rank: "C" },
      },
    ]);
    assert.equal(evaluate(notNullRule, { tspBalance: "Under $350k" }).rank, "C");
    assert.equal(evaluate(notNullRule, {}).rank, undefined);
  });

  it("in / notIn check membership", () => {
    const ruleSet = rs([
      {
        id: "in1",
        name: "high TSP",
        when: {
          all: [
            {
              field: "tspBalance",
              op: "in",
              value: ["Over $1 million", "$600k - $1 million"],
            },
          ],
        },
        then: { rank: "A" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { tspBalance: "Over $1 million" }).rank, "A");
    assert.equal(evaluate(ruleSet, { tspBalance: "Under $350k" }).rank, undefined);
  });
});

describe("evaluator — group composition", () => {
  it("'all' requires every child to match", () => {
    const ruleSet = rs([
      {
        id: "a1",
        name: "A path",
        when: {
          all: [
            { field: "age", op: "equals", value: "55 - 59" },
            { field: "separating", op: "equals", value: "YES" },
          ],
        },
        then: { rank: "A" },
      },
    ]);
    assert.equal(
      evaluate(ruleSet, { age: "55 - 59", separating: "YES" }).rank,
      "A",
    );
    assert.equal(
      evaluate(ruleSet, { age: "55 - 59", separating: "NO" }).rank,
      undefined,
    );
  });

  it("'any' requires at least one child to match", () => {
    const ruleSet = rs([
      {
        id: "a2",
        name: "A path",
        when: {
          any: [
            { field: "age", op: "equals", value: "59 1/2 or over" },
            { field: "age", op: "equals", value: "55 - 59" },
          ],
        },
        then: { rank: "A" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { age: "59 1/2 or over" }).rank, "A");
    assert.equal(evaluate(ruleSet, { age: "55 - 59" }).rank, "A");
    assert.equal(evaluate(ruleSet, { age: "below 40" }).rank, undefined);
  });

  it("nested all+any mirrors SF Flow 'A or (B and C)' shape", () => {
    const ruleSet = rs([
      {
        id: "n1",
        name: "A — 59½+ or (55-59 separating)",
        when: {
          any: [
            { field: "age", op: "equals", value: "59 1/2 or over" },
            {
              all: [
                { field: "age", op: "equals", value: "55 - 59" },
                { field: "separating", op: "equals", value: "YES" },
              ],
            },
          ],
        },
        then: { rank: "A" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { age: "59 1/2 or over" }).rank, "A");
    assert.equal(
      evaluate(ruleSet, { age: "55 - 59", separating: "YES" }).rank,
      "A",
    );
    assert.equal(
      evaluate(ruleSet, { age: "55 - 59", separating: "NO" }).rank,
      undefined,
    );
  });

  it("'not' negates", () => {
    const ruleSet = rs([
      {
        id: "neg",
        name: "not 59½+",
        when: {
          not: { field: "age", op: "equals", value: "59 1/2 or over" },
        },
        then: { rank: "C" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { age: "55 - 59" }).rank, "C");
    assert.equal(evaluate(ruleSet, { age: "59 1/2 or over" }).rank, undefined);
  });
});

describe("evaluator — first-match-wins and default fallback", () => {
  it("first matching rule writes the outcome; later rules can't overwrite it", () => {
    const ruleSet = rs([
      {
        id: "first",
        name: "first match",
        when: { all: [{ field: "age", op: "notNull" }] },
        then: { rank: "A" },
      },
      {
        id: "second",
        name: "would override",
        when: { all: [{ field: "age", op: "notNull" }] },
        then: { rank: "C" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { age: "55 - 59" }).rank, "A");
  });

  it("a rule can set leadScore without rank; a later rule can still set rank", () => {
    const ruleSet = rs([
      {
        id: "score-only",
        name: "score only",
        when: { all: [{ field: "tspBalance", op: "equals", value: "Over $1 million" }] },
        then: { leadScore: "10  (over $1mm)" },
      },
      {
        id: "rank-only",
        name: "rank only",
        when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
        then: { rank: "A" },
      },
    ]);
    const result = evaluate(ruleSet, {
      age: "59 1/2 or over",
      tspBalance: "Over $1 million",
    });
    assert.equal(result.rank, "A");
    assert.equal(result.leadScore, "10  (over $1mm)");
  });

  it("default fills outcome fields still unset after rules", () => {
    const ruleSet: RuleSet = {
      schemaVersion: 1,
      rules: [],
      default: { rank: "N/A" },
    };
    const result = evaluate(ruleSet, { age: "below 40" });
    assert.equal(result.rank, "N/A");
    assert.equal(result.leadScore, undefined);
  });

  it("default does NOT override fields a rule already set", () => {
    const ruleSet: RuleSet = {
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "set A",
          when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
          then: { rank: "A" },
        },
      ],
      default: { rank: "N/A" },
    };
    assert.equal(evaluate(ruleSet, { age: "59 1/2 or over" }).rank, "A");
  });
});

describe("evaluator — trace", () => {
  it("trace records every rule's evaluation including non-matches", () => {
    const ruleSet = rs([
      {
        id: "miss",
        name: "won't match",
        when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
        then: { rank: "A" },
      },
      {
        id: "hit",
        name: "will match",
        when: { all: [{ field: "age", op: "equals", value: "below 40" }] },
        then: { rank: "C" },
      },
    ]);
    const result = evaluate(ruleSet, { age: "below 40" });
    assert.equal(result.trace.steps.length, 2);
    assert.equal(result.trace.steps[0].matched, false);
    assert.equal(result.trace.steps[1].matched, true);
    assert.equal(result.trace.finalOutcome.rank, "C");
  });

  it("trace includes actual value seen for each leaf condition", () => {
    const ruleSet = rs([
      {
        id: "r",
        name: "age check",
        when: { all: [{ field: "age", op: "equals", value: "59 1/2 or over" }] },
        then: { rank: "A" },
      },
    ]);
    const result = evaluate(ruleSet, { age: "55 - 59" });
    const cond = result.trace.steps[0].conditions[0];
    assert.equal(cond.actual, "55 - 59");
    assert.equal(cond.target, "59 1/2 or over");
    assert.equal(cond.result, false);
  });

  it("trace embeds the supplied ruleSet metadata", () => {
    const ruleSet = rs([], { rank: "N/A" });
    const result = evaluate(ruleSet, {}, { ruleSetId: "rs-123", version: 7 });
    assert.equal(result.trace.ruleSetId, "rs-123");
    assert.equal(result.trace.ruleSetVersion, 7);
  });
});

describe("evaluator — edge cases", () => {
  it("empty rules + default rank → returns default", () => {
    const ruleSet: RuleSet = {
      schemaVersion: 1,
      rules: [],
      default: { rank: "N/A" },
    };
    assert.equal(evaluate(ruleSet, {}).rank, "N/A");
  });

  it("entirely empty lead never matches presence-required rules", () => {
    const ruleSet = rs(
      [
        {
          id: "any",
          name: "any survey field",
          when: {
            all: [
              { field: "age", op: "notNull" },
              { field: "maritalStatus", op: "notNull" },
            ],
          },
          then: { rank: "C" },
        },
      ],
      { rank: "N/A" },
    );
    const lead: LeadInput = {};
    assert.equal(evaluate(ruleSet, lead).rank, "N/A");
  });

  it("null/undefined/empty-string are all treated as 'absent'", () => {
    const ruleSet = rs([
      {
        id: "r",
        name: "tsp present",
        when: { all: [{ field: "tspBalance", op: "notNull" }] },
        then: { rank: "C" },
      },
    ]);
    assert.equal(evaluate(ruleSet, { tspBalance: null }).rank, undefined);
    assert.equal(evaluate(ruleSet, { tspBalance: undefined }).rank, undefined);
    assert.equal(evaluate(ruleSet, { tspBalance: "" }).rank, undefined);
    assert.equal(evaluate(ruleSet, { tspBalance: "x" }).rank, "C");
  });
});
