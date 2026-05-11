// Phase 2 scoring engine — public entry point.
//
// Consumers import everything from here:
//   import { evaluate, compileRuleSet, type RuleSet } from "@workspace/scoring";

export * from "./types.js";
export { evaluate } from "./evaluator.js";
export {
  compileRuleSet,
  safeCompileRuleSet,
  ruleSetSchema,
} from "./compiler.js";
export { V1_RULE_SET, V1_RULE_SET_NAME } from "./v1-rule-set.js";
