// Compiler (Zod) tests: malformed RuleSets must be rejected; valid ones
// (including V1_RULE_SET) must round-trip cleanly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  V1_RULE_SET,
  compileRuleSet,
  safeCompileRuleSet,
} from "../src/index.js";

describe("compiler — accepts valid", () => {
  it("V1_RULE_SET validates clean", () => {
    const ok = safeCompileRuleSet(V1_RULE_SET);
    assert.equal(ok.ok, true);
  });

  it("minimal RuleSet validates", () => {
    const ruleSet = compileRuleSet({
      schemaVersion: 1,
      rules: [],
      default: { rank: "N/A" },
    });
    assert.equal(ruleSet.rules.length, 0);
  });
});

describe("compiler — rejects invalid", () => {
  it("missing schemaVersion", () => {
    assert.throws(() =>
      compileRuleSet({ rules: [], default: {} }),
    );
  });

  it("wrong schemaVersion literal", () => {
    assert.throws(() =>
      compileRuleSet({ schemaVersion: 2, rules: [], default: {} }),
    );
  });

  it("unknown field name in a condition", () => {
    const ok = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: { all: [{ field: "notARealField", op: "equals", value: "x" }] },
          then: {},
        },
      ],
      default: {},
    });
    assert.equal(ok.ok, false);
  });

  it("invalid op", () => {
    const ok = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: { all: [{ field: "age", op: "lolNope", value: "x" }] },
          then: {},
        },
      ],
      default: {},
    });
    assert.equal(ok.ok, false);
  });

  it("condition.op=equals requires a value", () => {
    const ok = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: { all: [{ field: "age", op: "equals" }] },
          then: {},
        },
      ],
      default: {},
    });
    assert.equal(ok.ok, false);
  });

  it("condition.op=in requires value to be an array", () => {
    const ok = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: { all: [{ field: "age", op: "in", value: "single string" }] },
          then: {},
        },
      ],
      default: {},
    });
    assert.equal(ok.ok, false);
  });

  it("rank must be one of A / B+ / B / C / N/A", () => {
    const ok = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: { all: [{ field: "age", op: "notNull" }] },
          then: { rank: "AAA" },
        },
      ],
      default: {},
    });
    assert.equal(ok.ok, false);
  });

  it("ConditionGroup must specify exactly one of all/any/not", () => {
    const empty = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [{ id: "r", name: "n", when: {}, then: {} }],
      default: {},
    });
    assert.equal(empty.ok, false);

    const tooMany = safeCompileRuleSet({
      schemaVersion: 1,
      rules: [
        {
          id: "r",
          name: "n",
          when: {
            all: [{ field: "age", op: "notNull" }],
            any: [{ field: "age", op: "notNull" }],
          },
          then: {},
        },
      ],
      default: {},
    });
    assert.equal(tooMany.ok, false);
  });
});
