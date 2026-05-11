// v1 RuleSet — canonical rules derived from the SF Flow decoded in
// Investigation 6 (PLAN_SF_DIRECT_PUSH.md). This is the seeded set that
// the seed-rule-set-v1 script inserts at status="published" version=1.
//
// Notes:
// - Plain B rank is UNREACHABLE in v1. The SF Flow's B branch depended on
//   a Q12 question with "YES, under $300k" / "YES, over $300k" answer
//   brackets that does not exist in any of the 3 production SurveyMonkey
//   surveys or in the intake form. The B branch in SF was dead code.
// - Lead_Score__c is set only when rank is "A". Match SF behavior.
// - When preRetirementReview === "No" the lead defaults to N/A (unqualified).
// - Form values are case-sensitive:
//     preRetirementReview: "Yes" | "No"   (mixed case)
//     maxingTsp / externalInvestments / separating: "YES" | "NO"   (upper)
//     age:        "59 1/2 or over" | "55 - 59" | "50-54" | "40-49" | "below 40"
//     tspBalance: "Over $1 million" | "$600k - $1 million" | "$350k - $600k" | "Under $350k"

import type { Rule, RuleSet } from "./types.js";

// Helper to keep the seed file readable. UUIDs are stable; if you renumber
// rules later, KEEP the existing ids on existing semantics — Tab 4 history
// uses them.
const RULE_A_59_OVER_1M = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f10";
const RULE_A_59_600K_1M = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f11";
const RULE_A_59_350K_600K = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f12";
const RULE_A_59_UNDER_350K = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f13";
const RULE_A_59_NO_TSP = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f14";
const RULE_A_5559_SEP_OVER_1M = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f20";
const RULE_A_5559_SEP_600K_1M = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f21";
const RULE_A_5559_SEP_350K_600K = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f22";
const RULE_A_5559_SEP_UNDER_350K = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f23";
const RULE_A_5559_SEP_NO_TSP = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f24";
const RULE_B_PLUS = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f30";
const RULE_C_FALLBACK = "97a1c1a0-2d11-4b9f-9d18-2c2c8b1b2f40";

// Every rule is gated on preRetirementReview="Yes" so a "No" lead can
// never accidentally claim rank A / B+ / C or grab a leadScore. The
// default outcome catches unqualified / unscored leads and stamps them
// N/A. (The previous design used a leading short-circuit rule that set
// rank=N/A on "No" — that left leadScore unset, which a later A-rank
// rule then claimed. Gating each rule on "Yes" is the defensive fix.)
const yesPrereview = {
  field: "preRetirementReview",
  op: "equals",
  value: "Yes",
} as const;

const rules: Rule[] = [
  // A-rank rules: age 59½ or over, with Lead Score keyed off TSP balance.
  // Each (age, balance) combo is its own rule so a single match writes
  // both rank and leadScore. A non-TSP fallback below handles A-rank
  // without a balance entered.
  {
    id: RULE_A_59_OVER_1M,
    name: "A — age 59½+ with TSP over $1M",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "59 1/2 or over" },
        { field: "tspBalance", op: "equals", value: "Over $1 million" },
      ],
    },
    then: { rank: "A", leadScore: "10  (over $1mm)" },
  },
  {
    id: RULE_A_59_600K_1M,
    name: "A — age 59½+ with TSP $600k-$1M",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "59 1/2 or over" },
        { field: "tspBalance", op: "equals", value: "$600k - $1 million" },
      ],
    },
    then: { rank: "A", leadScore: "9 ($601k - $1mm)" },
  },
  {
    id: RULE_A_59_350K_600K,
    name: "A — age 59½+ with TSP $350k-$600k",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "59 1/2 or over" },
        { field: "tspBalance", op: "equals", value: "$350k - $600k" },
      ],
    },
    then: { rank: "A", leadScore: "8  ($351k-$600k)" },
  },
  {
    id: RULE_A_59_UNDER_350K,
    name: "A — age 59½+ with TSP under $350k",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "59 1/2 or over" },
        { field: "tspBalance", op: "equals", value: "Under $350k" },
      ],
    },
    then: { rank: "A", leadScore: "7  ($0-$350k)" },
  },
  {
    id: RULE_A_59_NO_TSP,
    name: "A — age 59½+ (no TSP balance)",
    description: "Rank A but no Lead Score because the TSP question wasn't answered.",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "59 1/2 or over" },
      ],
    },
    then: { rank: "A" },
  },

  // A-rank via the 55-59-AND-separating path. Same structure: a rule per
  // (balance) combo, plus a non-TSP fallback.
  {
    id: RULE_A_5559_SEP_OVER_1M,
    name: "A — age 55-59 separating + TSP over $1M",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "55 - 59" },
        { field: "separating", op: "equals", value: "YES" },
        { field: "tspBalance", op: "equals", value: "Over $1 million" },
      ],
    },
    then: { rank: "A", leadScore: "10  (over $1mm)" },
  },
  {
    id: RULE_A_5559_SEP_600K_1M,
    name: "A — age 55-59 separating + TSP $600k-$1M",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "55 - 59" },
        { field: "separating", op: "equals", value: "YES" },
        { field: "tspBalance", op: "equals", value: "$600k - $1 million" },
      ],
    },
    then: { rank: "A", leadScore: "9 ($601k - $1mm)" },
  },
  {
    id: RULE_A_5559_SEP_350K_600K,
    name: "A — age 55-59 separating + TSP $350k-$600k",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "55 - 59" },
        { field: "separating", op: "equals", value: "YES" },
        { field: "tspBalance", op: "equals", value: "$350k - $600k" },
      ],
    },
    then: { rank: "A", leadScore: "8  ($351k-$600k)" },
  },
  {
    id: RULE_A_5559_SEP_UNDER_350K,
    name: "A — age 55-59 separating + TSP under $350k",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "55 - 59" },
        { field: "separating", op: "equals", value: "YES" },
        { field: "tspBalance", op: "equals", value: "Under $350k" },
      ],
    },
    then: { rank: "A", leadScore: "7  ($0-$350k)" },
  },
  {
    id: RULE_A_5559_SEP_NO_TSP,
    name: "A — age 55-59 separating (no TSP balance)",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "equals", value: "55 - 59" },
        { field: "separating", op: "equals", value: "YES" },
      ],
    },
    then: { rank: "A" },
  },

  // B+ rank: maxing TSP and contributing externally. No leadScore — only
  // A-rank gets a Lead Score per SF behavior.
  {
    id: RULE_B_PLUS,
    name: "B+ — maxing TSP and contributing elsewhere",
    when: {
      all: [
        yesPrereview,
        { field: "maxingTsp", op: "equals", value: "YES" },
        { field: "externalInvestments", op: "equals", value: "YES" },
      ],
    },
    then: { rank: "B+" },
  },

  // C rank: catch-all when the survey was filled out enough to score them
  // but the lead didn't satisfy A or B+.
  {
    id: RULE_C_FALLBACK,
    name: "C — survey completed but doesn't qualify as A or B+",
    when: {
      all: [
        yesPrereview,
        { field: "age", op: "notNull" },
        { field: "maritalStatus", op: "notNull" },
        { field: "maxingTsp", op: "notNull" },
        { field: "externalInvestments", op: "notNull" },
        { field: "tspBalance", op: "notNull" },
      ],
    },
    then: { rank: "C" },
  },
];

export const V1_RULE_SET: RuleSet = {
  schemaVersion: 1,
  rules,
  default: { rank: "N/A" },
};

export const V1_RULE_SET_NAME = "v1 — initial rule set seeded from SF Flow";
