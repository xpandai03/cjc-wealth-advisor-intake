// Pure scoring evaluator.
//
// Walks the RuleSet's rules in order. For each rule whose condition matches
// the lead input, records its outcome — but only writes each outcome field
// if it hasn't been set yet. First match wins per field. After all rules
// run, the RuleSet's `default` outcome fills any field that's still unset.
//
// Side-effect free; safe to call from anywhere. Trace step list is built
// up as we go so the Tab 4 tester (Sprint 5) can show exactly why each
// rule did or didn't match.

import type {
  Condition,
  ConditionGroup,
  EvaluateResult,
  LeadInput,
  Outcome,
  Rule,
  RuleSet,
  RuleSetMetadata,
  RuleTraceStep,
  ScoringTrace,
} from "./types.js";

function isGroup(node: Condition | ConditionGroup): node is ConditionGroup {
  return (
    "all" in node || "any" in node || "not" in node
  );
}

function getField(lead: LeadInput, field: Condition["field"]): string | null | undefined {
  return lead[field];
}

/**
 * Evaluate a single condition (leaf, not a group). Returns the boolean
 * result plus the "actual" value seen, for trace purposes.
 */
function evalCondition(
  cond: Condition,
  lead: LeadInput,
): { result: boolean; actual: string | null | undefined } {
  const actual = getField(lead, cond.field);
  const present = actual !== null && actual !== undefined && actual !== "";

  switch (cond.op) {
    case "isNull":
      return { result: !present, actual };
    case "notNull":
      return { result: present, actual };
    case "equals":
      return { result: present && actual === cond.value, actual };
    case "notEquals":
      // notEquals is true when the field is set AND differs from the target.
      // A null/empty field is NOT considered "notEquals" — use notNull for that.
      return { result: present && actual !== cond.value, actual };
    case "in":
      return {
        result:
          present &&
          Array.isArray(cond.value) &&
          cond.value.includes(actual as string),
        actual,
      };
    case "notIn":
      return {
        result:
          present &&
          Array.isArray(cond.value) &&
          !cond.value.includes(actual as string),
        actual,
      };
    case "contains":
      return {
        result:
          present &&
          typeof cond.value === "string" &&
          (actual as string).includes(cond.value),
        actual,
      };
    case "notContains":
      return {
        result:
          present &&
          typeof cond.value === "string" &&
          !(actual as string).includes(cond.value),
        actual,
      };
    case "matchesRegex":
      if (!present || typeof cond.value !== "string") {
        return { result: false, actual };
      }
      try {
        return { result: new RegExp(cond.value).test(actual as string), actual };
      } catch {
        // Invalid regex falls back to false — compiler should have caught
        // this earlier; defensive here.
        return { result: false, actual };
      }
    default: {
      // Exhaustiveness: if a new op is added to types.ts and the compiler
      // accepts it, this branch is the safety net.
      const _exhaustive: never = cond.op;
      void _exhaustive;
      return { result: false, actual };
    }
  }
}

/**
 * Evaluate a ConditionGroup (or a leaf Condition) and return just the boolean.
 * Leaf conditions are emitted into `trace` so each rule's trace step can
 * show which conditions did or didn't match. Groups are traversed silently
 * (their semantics are reconstructable from their leaves).
 */
function evalNode(
  node: Condition | ConditionGroup,
  lead: LeadInput,
  trace: RuleTraceStep["conditions"],
): boolean {
  if (isGroup(node)) {
    if (node.all) {
      return node.all.every((child) => evalNode(child, lead, trace));
    }
    if (node.any) {
      return node.any.some((child) => evalNode(child, lead, trace));
    }
    if (node.not) {
      return !evalNode(node.not, lead, trace);
    }
    return false; // empty group — compiler should reject this
  }
  const { result, actual } = evalCondition(node, lead);
  trace.push({
    field: node.field,
    op: node.op,
    target: node.value,
    actual,
    result,
  });
  return result;
}

function applyOutcome(into: Outcome, from: Outcome): void {
  if (into.rank === undefined && from.rank !== undefined) {
    into.rank = from.rank;
  }
  if (into.leadScore === undefined && from.leadScore !== undefined) {
    into.leadScore = from.leadScore;
  }
}

export function evaluate(
  ruleSet: RuleSet,
  lead: LeadInput,
  metadata: RuleSetMetadata = { ruleSetId: "unknown", version: 0 },
): EvaluateResult {
  const accumulated: Outcome = {};
  const steps: RuleTraceStep[] = [];

  for (const rule of ruleSet.rules as Rule[]) {
    const conditions: RuleTraceStep["conditions"] = [];
    const matched = evalNode(rule.when, lead, conditions);
    steps.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched,
      conditions,
    });
    if (matched) {
      applyOutcome(accumulated, rule.then);
    }
  }

  // Fill remaining outcome fields from the default.
  applyOutcome(accumulated, ruleSet.default);

  const trace: ScoringTrace = {
    ruleSetId: metadata.ruleSetId,
    ruleSetVersion: metadata.version,
    evaluatedAt: new Date().toISOString(),
    steps,
    finalOutcome: { ...accumulated },
  };

  return {
    rank: accumulated.rank,
    leadScore: accumulated.leadScore,
    trace,
  };
}
