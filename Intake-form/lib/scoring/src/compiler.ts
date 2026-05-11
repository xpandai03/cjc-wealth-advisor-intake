// Zod-validates a RuleSet at runtime before it goes into the evaluator or
// gets persisted to the DB. The TypeScript types in ./types.ts guarantee
// shape at compile time, but a RuleSet read from JSON (DB row, API body)
// hasn't been through the type system — so we re-check at the boundary.

import { z } from "zod";
import { LEAD_FIELDS, CONDITION_OPS, RANK_VALUES, type RuleSet } from "./types.js";

const leadFieldSchema = z.enum(LEAD_FIELDS as unknown as [string, ...string[]]);
const conditionOpSchema = z.enum(
  CONDITION_OPS as unknown as [string, ...string[]],
);
const rankSchema = z.enum(RANK_VALUES as unknown as [string, ...string[]]);

const conditionSchema: z.ZodType = z
  .object({
    field: leadFieldSchema,
    op: conditionOpSchema,
    value: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .superRefine((cond, ctx) => {
    const needsValue = !["isNull", "notNull"].includes(cond.op);
    if (needsValue && cond.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `condition.op="${cond.op}" requires a value`,
      });
    }
    if (
      (cond.op === "in" || cond.op === "notIn") &&
      !Array.isArray(cond.value)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `condition.op="${cond.op}" requires value to be an array`,
      });
    }
  });

// ConditionGroup is recursive (groups can nest). Declared via z.lazy.
const conditionGroupSchema: z.ZodType = z
  .object({
    all: z
      .array(z.union([conditionSchema, z.lazy(() => conditionGroupSchema)]))
      .optional(),
    any: z
      .array(z.union([conditionSchema, z.lazy(() => conditionGroupSchema)]))
      .optional(),
    not: z
      .union([conditionSchema, z.lazy(() => conditionGroupSchema)])
      .optional(),
  })
  .superRefine((group, ctx) => {
    const keys = [group.all, group.any, group.not].filter(
      (v) => v !== undefined,
    );
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "condition group must specify exactly one of { all, any, not }",
      });
    }
    if (keys.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "condition group cannot specify more than one of { all, any, not }",
      });
    }
  });

const outcomeSchema = z.object({
  rank: rankSchema.optional(),
  leadScore: z.string().min(1).optional(),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  when: conditionGroupSchema,
  then: outcomeSchema,
});

export const ruleSetSchema = z.object({
  schemaVersion: z.literal(1),
  rules: z.array(ruleSchema),
  default: outcomeSchema,
});

/**
 * Validate a candidate RuleSet. Throws ZodError on invalid shape; returns
 * the parsed object (with types narrowed) on success.
 */
export function compileRuleSet(input: unknown): RuleSet {
  return ruleSetSchema.parse(input) as RuleSet;
}

/** Non-throwing variant for endpoints that want to surface validation errors. */
export function safeCompileRuleSet(input: unknown):
  | { ok: true; ruleSet: RuleSet }
  | { ok: false; errors: z.ZodIssue[] } {
  const result = ruleSetSchema.safeParse(input);
  if (result.success) return { ok: true, ruleSet: result.data as RuleSet };
  return { ok: false, errors: result.error.issues };
}
