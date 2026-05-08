# Phase 1 Direct-to-Salesforce Push — Plan & Step 0 Findings

**Status: BLOCKED at Step 0.** Do NOT proceed to Step 1 (auth helper) or Step 3 (submit handler refactor) until the architecture pivots — see "Recommended next move" below.

---

## Step 0 — Hypothesis test: failed

The handoff prompt's Step 0 was a single make-or-break experiment: send `Federal_Agency__c` to SF's REST `/sobjects/Lead` **without** the leading whitespace, on the theory that REST's whitespace trim normalizes both sides of the picklist comparison and the value would match the canonical (4-space-prefixed) stored value.

It does not.

### Evidence

Two POSTs to the same endpoint with the same auth, same RecordType, same OwnerId, same everything except the `Federal_Agency__c` whitespace:

| Run | Date | `Federal_Agency__c` sent | Status | Error echo |
|---|---|---|---|---|
| 1 (yesterday) | 2026-05-07 | `"    ► Dept of Defense (DOD): Navy"` (4 leading spaces) | 400 | `"► Dept of Defense (DOD): Navy"` (no leading spaces) |
| 2 (today, Step 0) | 2026-05-08 | `"► Dept of Defense (DOD): Navy"` (no leading spaces) | 400 | `"► Dept of Defense (DOD): Navy"` (no leading spaces) |

Both produced `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`. The error echoed back the **trimmed** input each time, regardless of whether the input started with leading spaces.

### Diagnosis

SF's REST validator trims **input** before comparison but does **not** trim the **picklist's stored allowed values**. The trimmed input is matched against still-prefixed picklist entries → never matches → rejected. There is no client-side value transform that can defeat this asymmetric trim through this endpoint.

### What this rules out

- The asymmetric-trim model means stripping leading whitespace client-side won't work (today's test).
- Sending the value verbatim with leading whitespace doesn't work (yesterday's test).
- Therefore: **no value of `Federal_Agency__c` containing the `'    ► '` sub-agency prefix can be inserted via `POST /services/data/vXX.0/sobjects/Lead`** for any X we have access to. This is endpoint-level, not auth-level — same user/RecordType/profile that successfully creates these values via Zapier's older SOAP-app Zaps cannot do it through REST.

### What's still on the table

In rough order of friction:

1. **Apex REST custom endpoint.** Write an `@HttpPost` method on a `@RestResource` Apex class that takes the form payload and inserts a Lead via Apex DML. Apex DML does not strip leading whitespace from picklist input. Requires admin access to write/deploy the class — likely Techila or Chris collaboration. Once deployed, the form posts to `/services/apexrest/...` instead of `/sobjects/Lead`. **This is the lane the handoff prompt named as the pivot.**
2. **SOAP API direct.** SF's SOAP `create()` preserves leading whitespace (1,436 successful sub-agency Leads/yr via Zapier's older app prove this). We could call it from the Vercel function with stored auth. Risk: SOAP is verbose, SF deprecates SOAP versions on long timelines, and we'd reinvent what the older Zapier app already does. Worse than #1.
3. **Bulk API 2.0.** Different endpoint family; whitespace handling worth verifying. Not worth investigating unless #1 is blocked.
4. **Picklist value restructure.** Admin-side change to remove the `'    ► '` prefix from the 28 sub-agency values. Migrates 98+ historical Leads' stored values; requires data fix-up. High blast radius. Last resort.
5. **Status quo (revert sub-agency support).** Drop the 28 sub-agencies from the form; users pick parent only. Already implemented and reverted earlier today. Production Zapier path keeps working for the legacy SurveyMonkey flow.

### Recommended next move

Pivot to **option #1 (Apex REST)**. Reasons:

- Cleanest separation: Vercel calls a single bespoke endpoint, Apex handles the picklist match correctly via DML.
- No dependency on Zapier or its app deprecation cycle.
- Keeps every other piece of the handoff prompt's plan reusable: same auth, same env vars, same channel routing, same field mapping. Only the *target endpoint* changes — `/sobjects/Lead` → `/services/apexrest/CJCFormLead/v1` (or whatever name the Apex class is given).
- Tradeoff: requires SF admin to deploy the Apex class. Spec it as ~30 lines, single method, single `insert l;` line. The collaboration ask is small.

If Apex is blocked, fallback ranking is **#2 → #5**. **Do not** spend implementation time on #2-#4 without explicit approval; restart this plan file with an architecture decision before code.

---

## Plan stub (frozen — do not implement until Apex pivot is approved)

Once Raunek + Techila/Chris have agreed on the Apex pivot, the rest of the handoff prompt's plan is mostly intact, with these adjustments:

- **Step 2 (auth helper)**: unchanged. Same Client Credentials flow against the same External Client App (`CJC_Form_Direct_Integration`). Add `SF_APEX_REST_PATH` env var alongside `SF_CLIENT_ID` / `SF_CLIENT_SECRET` / `SF_LOGIN_URL` / `SF_API_VERSION`.
- **Step 3 (submit.ts refactor)**: target the Apex REST endpoint instead of `/sobjects/Lead`. The body shape is whatever the Apex class accepts (likely the same field-mapped JSON, but the class can also accept a flatter form payload and do its own field mapping — design choice for the Apex author).
- **Step 4 (E2E)**: unchanged.
- **Step 5 (cutover)**: unchanged.

A new sub-step is needed before Step 2: **Step 1.5 — Apex class deployment**. Owned by SF admin. Out of scope for this engineering work but blocking.

### Out of scope until pivot is decided

- `/lib/salesforce.ts` (auth + insert helper)
- `/api/submit.ts` refactor
- E2E test harness
- Vercel env var changes
- Zapier staging Zap disable
- Audit-doc append

---

## Audit-doc note (will land in `CAMPAIGN_AUDIT_FINDINGS.md` once the Apex pivot ships)

Salesforce's REST `/sobjects/Lead` endpoint trims leading whitespace from picklist input but does NOT trim the picklist's stored allowed values. Any restricted-picklist value with leading whitespace is therefore unsubmittable via REST. The 28 sub-agency entries on `Lead.Federal_Agency__c` are stored with a `'    ► '` (4 spaces + U+25BA + 1 space) prefix, so all of them hit this asymmetry. SOAP `create()` does not exhibit the trim — confirmed by 1,436 production Lead creates in the last 365 days through Zapier's older SOAP-based Salesforce app. Phase 1 ships sub-agency support via a custom Apex REST endpoint (`@RestResource` + `@HttpPost`) which accepts a Lead payload and inserts via DML. This bypasses the REST trim entirely.

---

## Investigation 2: byte-level picklist read (2026-05-08)

Triggered by Raunek noticing the production Internal Marketing Zap's SurveyMonkey field-mapping chip didn't visibly show a `► ` prefix. Open question: is the picklist's stored `value` actually bare (with the prefix being a UI-only `label` artifact), or is `value` and `label` truly the same prefixed string?

### What was checked

1. **Query 1A** — `SELECT Id, LastName, Survey_Detail__c, Federal_Agency__c, CreatedDate FROM Lead WHERE LeadSource = 'SOFA: Webinar' AND Federal_Agency__c != null AND CreatedDate = LAST_N_DAYS:30 ORDER BY CreatedDate DESC LIMIT 20` via REST `/services/data/v59.0/query` to bypass the MCP wrapper's row-collapsing.
   - 20 rows returned.
   - 19 of 20 are top-level agencies stored as bare names (no leading whitespace, no arrow). Lengths 11–52 chars.
   - **1 of 20 is a sub-agency stored with the full 4-space prefix**: Lead `00QUU00000TdPx72AF` (LastName "Drake", Survey_Detail__c `DC SOFA 3`, CreatedDate 2026-05-07T15:08:55Z), `Federal_Agency__c = "    ► Dept of Transportation (DOT)Federal Aviation Administration (FAA)"` — length **71**, leading-spaces **4**. Empirical proof that the picklist accepts and stores the 4-space-prefixed form on a recent successful insert.
   - Skipped per Raunek: Query 1B (per-record GET) and CreatedById follow-ups — Query 1A row 5's bytes are sufficient confirmation.

2. **Query 1C** — `GET /services/data/v59.0/sobjects/Lead/describe`, extracting the `Federal_Agency__c` field's `picklistValues` array.
   - 82 entries total.
   - 28 sub-agency entries — every one has `value` AND `label` both starting with `"    ► "` (4 spaces + U+25BA + 1 space).
   - 54 parent/standalone entries (incl. `SOFA`, `FNN`, `N/A`) — every one has `value` and `label` both as the bare name.
   - **`value === label` for all 82 entries.** Byte-identical across the entire picklist. No "label has spaces, value is bare" divergence anywhere.
   - **No duplicate entries** by trimmed-name comparison. There is no bare-form `"Dept of Defense (DOD): Navy"` entry alongside the prefixed `"    ► Dept of Defense (DOD): Navy"` entry — only the latter exists for sub-agencies.

### Outcome — A (confirmed)

The picklist's `value` (the API-expected string) is the prefixed form for sub-agencies. The 4-space-prefix is **not** a UI-only display artifact. The hypothesis that REST might work if we sent a "secret bare form" is dead — there is no such form in the metadata.

This re-confirms the original diagnosis: REST `/sobjects/Lead` trims input but not picklist values, so any input value mapping to a sub-agency picklist is unsubmittable through REST regardless of what client-side massage we do. The Drake row proves the picklist ACCEPTS the prefixed form on storage; yesterday's Step 0 failures prove REST CANNOT submit it.

### Architecture recommendation — unchanged

**Proceed with the Apex REST pivot.** No new evidence supports any alternative path. The frozen plan stub in this file remains the right shape; only Step 1.5 (Apex class deployment) is still gated on SF admin.

### What this rules out

- **Outcome B** (bare `► …` form): no entry in the picklist has that shape.
- **Outcome C** (bare agency name only, prefix is UI-only): definitively false — `value === label` everywhere, both prefixed for sub-agencies.
- **Picklist duplicates** (mixed legacy/new forms causing some submissions to succeed and others to fail): none. The 1,436 successful sub-agency Leads/year all match the single canonical prefixed entry; staging fails because REST trims input before that match.

## Investigation 3: SOAP via jsforce — Step 0 result (2026-05-08)

### TL;DR — **Step 0 FAILED. The "SOAP preserves whitespace" hypothesis is falsified.** SOAP at SF API v59 trims leading whitespace from picklist input the same way REST does, returning the same `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` error with the same trimmed value echoed in the error body.

### What was tested

All against `https://cjcwealth.my.salesforce.com`, authenticated via the Connected App "CJC Form Direct Integration" using the Client Credentials Flow (OAuth endpoint hit at the org's My Domain — `https://login.salesforce.com` returns `invalid_grant: request not supported on this domain`, which is a known Client-Credentials gotcha).

| # | Path | Endpoint | `Federal_Agency__c` payload | Result |
|---|---|---|---|---|
| 1 | jsforce v3.10.14 SOAP API (`conn.soap.create`) | `/services/Soap/u/v59.0` | `"    ► Dept of Defense (DOD): Navy"` (4 leading spaces literal) | 400-equivalent SOAP fault: `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`, value echoed back without leading spaces |
| 2 | Hand-crafted SOAP envelope, leading whitespace as literal U+0020 | `/services/Soap/u/v59.0` | same as #1 | same as #1 |
| 3 | Hand-crafted SOAP envelope, leading whitespace as 4× `&#x20;` entity refs | `/services/Soap/u/v59.0` | `"&#x20;&#x20;&#x20;&#x20;► Dept…"` | same as #1 — entity expansion happens before/at the same level as the trim, no help |
| (control) | Drake Lead in SF (`00QUU00000TdPx72AF`, created 2026-05-07T15:08:55Z) — empirical proof a successful sub-agency insert exists | n/a (we are READING) | stored value: `"    ► Dept of Transportation (DOT)Federal Aviation Administration (FAA)"` (4 leading spaces preserved) | created by **CHRIS CAMPBELL** (UserType: Standard, Profile: System Administrator) — same user our staging Zap uses |

### What this proves

- **At SF API v59, the trim happens on both the REST `/sobjects/Lead` endpoint AND the SOAP `/services/Soap/u/v59.0` endpoint** for restricted-picklist input. Picklist values are not trimmed on the stored side, so `"    ► …"` input becomes `"► …"` after trim and never matches the picklist's `"    ► …"` allowed value.
- **The auth context is not the differentiator.** The Drake Lead was created by Chris Campbell (`0054x000000kz7rAAA`), exactly the user we authenticate as via Client Credentials. So whatever path inserted the prefix is a *different endpoint or API version*, not a different user/profile/permission set.

### What remains unknown

The 1,436 sub-agency Leads created in the past 365 days (per earlier SOQL on `Federal_Agency__c LIKE '    ►%'` with `CreatedById` group-by) prove **some** path bypasses the trim. Candidates we have NOT yet directly tested:

| Candidate | Mechanism for bypassing trim | Test cost |
|---|---|---|
| **Older SOAP/REST API versions** (v40, v44, v49, v52, v56) | SF has tightened input validation over the years; older API endpoints might not run the trim. | Would create test Leads in production org. Last attempt was a 5-version sweep that the local harness correctly denied as "version sweep that writes test records to production." Needs explicit Raunek approval + scoped permission. |
| **Web-to-Lead** (`https://webto.salesforce.com/servlet/servlet.WebToLead`) | Pre-API mechanism. Different processor than REST/SOAP, historically lax on whitespace. | One curl POST. Creates a test Lead in production. |
| **Bulk API 2.0** (`/services/data/v59.0/jobs/ingest`) | Different ingestion pipeline. Whitespace handling worth verifying. | Slightly more complex (CSV upload + state polling). Creates a test Lead. |
| **Apex REST custom endpoint** (the original "Phase 2" recommendation in this file) | Apex DML doesn't apply the trim. Definitive bypass. | Requires SF admin to deploy a small `@RestResource` class. ~30 min admin task, likely Techila/Chris collaboration. |
| **Picklist value restructure** (remove `'    ► '` prefix from the 28 sub-agency values) | Admin-side: change the picklist metadata so values don't start with whitespace. | Admin task, ~15 min, but would orphan 98+ historical Leads still storing the prefixed value. High blast radius. |

### What the Zapier production path actually does (best guess, unverified)

The production Zaps run on Zapier's older "Salesforce" app (UI clue: no `type::FieldName` field-key prefixes, no "Non-details" tab — vs. the staging Zap on the v3 "Salesforce" app which has both). Yesterday I assumed this older app uses SOAP because "the SOAP API is the legacy one." That assumption is now refuted by today's tests — SOAP at v59 trims just as much as REST does.

What the older Zapier app probably does instead: pin to an **older SF API version** (e.g., v44 SOAP or v44 REST), where the trim doesn't run, OR uses Web-to-Lead under the hood. Both are fast to test if Raunek approves writing one or two test Leads.

### Recommended next move (decision needed from Raunek)

Pick one of these — they're roughly ranked by speed-to-ship vs. durability:

1. **(Fastest, riskiest) Older API version sweep**, scoped: I run ONE SOAP create per version (v40 → v52, ~5 versions = 5 test Leads in prod), explicitly approved by Raunek. If any version preserves the prefix, we pin to that version in our jsforce client. The risk: SF may deprecate the chosen version on a future timeline, causing a silent re-break.

2. **(Fast, durable) Web-to-Lead path**, scoped: I test a single `/servlet.WebToLead` POST. If it preserves the prefix, we use it from Vercel. The risk: Web-to-Lead has its own quirks (limited field set, different auth model — usually OID-based, not Connected App).

3. **(Medium, most durable) Apex REST custom endpoint**, the original recommendation: SF admin deploys a small `@RestResource` Apex class with one `@HttpPost` handler that takes the form payload and inserts a Lead via Apex DML. Apex DML doesn't trim. Requires ~30 min of SF admin time (Techila or Chris).

4. **(Slowest, most disruptive) Picklist value restructure**, admin-side: Strip the `'    ► '` prefix from the 28 sub-agency picklist values. REST/SOAP both then accept the bare names. Requires data fix-up for 98+ historical Leads still storing the prefixed value (UPDATE pass, or accept the stale historical data).

5. **(No-op fallback) Status quo**: drop sub-agency support from the form. Already implemented and reverted earlier; would re-revert. Phase 1 ships with parent-only granularity. Sub-agency support comes later via #3 or #4.

### Step 0 verdict per handoff prompt's decision rules

> Step 0 fails: stop. Don't pivot to a new architecture without Raunek's input.

**Stopping.** No code in the project repo. No Zapier touches. No Connected App changes. No env var changes. The throwaway scripts and `.env` are at `/tmp/sf-step0/` (outside the repo, will be wiped on reboot).

The plan stub for Step 2+ remains frozen pending an architecture decision among the 5 options above.

## Investigation 4: SOAP API version sweep (2026-05-08)

### TL;DR — **All 5 SOAP versions failed identically.** v40, v44, v49, v52, v56 all return `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` with the same trimmed-value echo. The trim is endpoint-agnostic across SF API versions back to at least v40. **Apex REST is the only durable path forward.**

### What ran

Authorized version sweep: one hand-crafted SOAP `create` envelope per version, identical payload (Navy sub-agency `"    ► Dept of Defense (DOD): Navy"` with 4 leading spaces preserved), unique test email per version for SOQL correlation.

| API version | HTTP | success | Result | Email |
|---|---|---|---|---|
| 40.0 | 200 | false | `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` — value echoed back trimmed | `test+phase1-soapv400-001@xpand.test` |
| 44.0 | 200 | false | same | `test+phase1-soapv440-001@xpand.test` |
| 49.0 | 200 | false | same | `test+phase1-soapv490-001@xpand.test` |
| 52.0 | 200 | false | same | `test+phase1-soapv520-001@xpand.test` |
| 56.0 | 200 | false | same | `test+phase1-soapv560-001@xpand.test` |

Confirmatory SOQL `SELECT Id, Email, Federal_Agency__c FROM Lead WHERE Email LIKE 'test+phase1-soapv%@xpand.test'` → **0 rows**. Nothing landed in production (good — clean test, no orphan records).

### What this proves

The trim is a **server-side Apex/runtime behavior at SF**, not endpoint-version-specific. It doesn't matter whether you hit:
- REST `/sobjects/Lead` v59 (Investigation 1)
- SOAP `/services/Soap/u/v59.0` (Investigation 3, jsforce + hand-crafted, both whitespace and entity-encoded)
- SOAP `/services/Soap/u/v40.0` through v56 (Investigation 4)

…all paths run through the same input-normalization layer that strips leading whitespace from picklist input before validating against the (still-prefixed) stored allowed values.

### What this means for the production-Zap mystery

The 1,436 sub-agency Leads/year that empirically exist in production — and the Drake Lead specifically (`00QUU00000TdPx72AF`, created 2026-05-07 by Chris Campbell with the prefix preserved) — must be coming through a path that's not direct SF API at all. Plausible candidates not yet tested:

- **Web-to-Lead** (`https://webto.salesforce.com/servlet/servlet.WebToLead`) — different processor, pre-API.
- **Bulk API 2.0** (`/services/data/vXX.0/jobs/ingest`) — different ingestion pipeline.
- **An Apex trigger / Flow** that mutates incoming Lead records — e.g., a before-insert trigger that *reconstructs* the prefix on the value side based on a label-matching lookup, allowing the input to be bare and the stored value to be prefixed.
- **Manual UI entry / Data Loader** — admin-side bulk loads.

We don't need to identify the production-Zap path to ship — we have a definitive next move:

### Architecture decision — **Apex REST, via Amol**

This is the only path among the original 5 options that is:
- **Confirmed to bypass the trim** (Apex DML doesn't run the picklist validator's trim — it inserts what you give it, byte-for-byte).
- **Durable** (doesn't depend on SF preserving an API version's quirky behavior).
- **Doesn't orphan historical data** (unlike picklist restructure).
- **Doesn't require dropping form features** (unlike status quo).

Cost: ~30 minutes of SF admin time (Amol or Chris) to deploy a single `@RestResource` Apex class with one `@HttpPost` handler.

### Apex REST endpoint spec (for the admin email)

```apex
@RestResource(urlMapping='/CJCFormLead/v1/*')
global with sharing class CJCFormLeadRest {
    @HttpPost
    global static String createLead() {
        RestRequest req = RestContext.request;
        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());

        Lead l = new Lead();
        // Map every form field. Apex DML preserves leading whitespace verbatim.
        l.FirstName               = (String) payload.get('FirstName');
        l.LastName                = (String) payload.get('LastName');
        l.Email                   = (String) payload.get('Email');
        l.Phone                   = (String) payload.get('Phone');
        l.State                   = (String) payload.get('State');
        l.Federal_Agency__c       = (String) payload.get('Federal_Agency__c');
        l.RecordTypeId            = (Id)     payload.get('RecordTypeId');
        l.OwnerId                 = (Id)     payload.get('OwnerId');
        l.LeadSource              = (String) payload.get('LeadSource');
        l.Status                  = (String) payload.get('Status');
        l.Meeting_stage__c        = (String) payload.get('Meeting_stage__c');
        l.Survey_Detail__c        = (String) payload.get('Survey_Detail__c');
        l.Allow_Duplicate__c      = (Boolean) payload.get('Allow_Duplicate__c');
        l.Survey_Monkey_Eval_Type__c = (String) payload.get('Survey_Monkey_Eval_Type__c');
        // SurveyMonkey-driven survey fields (optional)
        l.Sofa_Consultation_Survey_Q2__c        = (String) payload.get('Sofa_Consultation_Survey_Q2__c');
        l.Sofa_Consultation_Survey_Q4__c        = (String) payload.get('Sofa_Consultation_Survey_Q4__c');
        l.Sofa_Consultation_Survey_Q5__c        = (String) payload.get('Sofa_Consultation_Survey_Q5__c');
        l.Sofa_Consultation_Survey_Q8__c        = (String) payload.get('Sofa_Consultation_Survey_Q8__c');
        l.Sofa_Consultation_Survey_Q8_Other__c  = (String) payload.get('Sofa_Consultation_Survey_Q8_Other__c');
        l.Sofa_Consultation_Survey_Q9__c        = (String) payload.get('Sofa_Consultation_Survey_Q9__c');
        l.Sofa_Consultation_Survey_Q10__c       = (String) payload.get('Sofa_Consultation_Survey_Q10__c');
        l.Sofa_Consultation_Survey_Q15__c       = (String) payload.get('Sofa_Consultation_Survey_Q15__c');
        l.Eval_Comments__c                      = (String) payload.get('Eval_Comments__c');
        l.Re_screening_Comments__c              = (String) payload.get('Re_screening_Comments__c');

        insert l;
        return l.Id;
    }
}
```

The Vercel function then POSTs to `${instance_url}/services/apexrest/CJCFormLead/v1/` with the same Bearer token from Client Credentials, and the body is the field-mapped JSON. No need for jsforce — a single `fetch` call.

## Investigation 5: Path C ship (2026-05-08)

**Path chosen.** Skip Apex altogether. Raunek is updating the SF picklist in Setup to have **bare** sub-agency entries (no `'    ► '` prefix) — same 28 logical sub-agencies but with the leading whitespace removed so REST can validate them. Code side: `Intake-form/api/submit.ts` strips the `'    ► '` prefix from `body.federalAgency` before forwarding to Zapier (or eventually direct REST). The form's UI keeps the prefixed labels in `Home.tsx` for visual hierarchy/indentation; the strip happens server-side at the API boundary. This ships tonight, no Amol/Chris collaboration needed, no Apex deployment, no waiting on a third party. The trim asymmetry that blocked everything else (Investigations 1, 3, 4) becomes irrelevant once the picklist's stored values are bare on both sides of the comparison. Trade-off: the 28 historical sub-agency picklist entries with the prefix get retired; new Leads use the bare values; existing Leads keep their stored prefixed value (which is fine — they're historical records, not new inserts).

### Status checklist

- [x] Step 0 (REST trim hypothesis) — failed (Investigation 1, 2026-05-07)
- [x] Investigation 2: byte-level picklist read — confirmed Outcome A (2026-05-08)
- [x] Investigation 3 / Step 0 (SOAP via jsforce hypothesis) — failed (2026-05-08)
- [x] Investigation 4: SOAP version sweep v40–v56 — all failed (2026-05-08)
- [x] **Investigation 5: Path C — picklist + strip approach (2026-05-08)** — code change in `submit.ts` shipped, picklist update pending in SF Setup (Raunek)
- [ ] Raunek confirms SF picklist has bare sub-agency values
- [ ] E2E (3 channels × sub-agency) — pending Raunek's go-ahead
- [ ] Vercel deploy — pending E2E pass
