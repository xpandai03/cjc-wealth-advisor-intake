// Salesforce direct-push helper for the intake form.
//
// Auth: OAuth 2.0 Client Credentials Flow against the CJC Connected App
// (`CJC Form Direct Integration`, Run-As `teamcampbell@cjcwealth.com`).
// Tokens last ~2h; we cache in-memory and refresh at ~90 minutes to be safe.
//
// API: REST POST /services/data/v59.0/sobjects/Lead with the field-mapped
// JSON. On 401 (token expired mid-flight), re-auth once and retry the call.
//
// Phase 1 invariant: the `Federal_Agency__c` prefix-strip regex
// `/^[\s► ]+/` MUST be preserved. The form's UI shows the prefixed labels
// for hierarchy, but the SF picklist is stored bare and rejects the
// prefix. submit.ts strips it before fields reach this helper, but we
// apply it defensively here too — see strippedFederalAgency().

import { z } from "zod";

// ---------------------------------------------------------------------------
// Env + config
// ---------------------------------------------------------------------------

const envSchema = z.object({
  SF_INSTANCE_URL: z.string().url(),
  SF_CLIENT_ID: z.string().min(1),
  SF_CLIENT_SECRET: z.string().min(1),
  SF_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v59.0"),
});

function readEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse({
    SF_INSTANCE_URL: process.env.SF_INSTANCE_URL,
    SF_CLIENT_ID: process.env.SF_CLIENT_ID,
    SF_CLIENT_SECRET: process.env.SF_CLIENT_SECRET,
    SF_API_VERSION: process.env.SF_API_VERSION ?? "v59.0",
  });
  if (!parsed.success) {
    // Don't echo the parsed object — would leak the client secret.
    throw new Error(
      "Salesforce env not configured: SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET required",
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

type CachedToken = { accessToken: string; expiresAt: number };

// In-memory cache. Per Vercel serverless function instance; survives warm
// invocations, dies on cold start. That's fine — re-auth costs ~150ms.
let tokenCache: CachedToken | null = null;

// Refresh tokens 30 min before they expire (SF tokens ~2h). Keeps us well
// inside the safety window even with clock skew or slow re-auths.
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000;

async function fetchAccessToken(env: z.infer<typeof envSchema>): Promise<CachedToken> {
  const tokenUrl = `${env.SF_INSTANCE_URL.replace(/\/$/, "")}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SF_CLIENT_ID,
    client_secret: env.SF_CLIENT_SECRET,
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    // The error body may echo back values like error_description; do NOT
    // include the request body in the thrown message (would leak secret).
    const text = await res.text().catch(() => "");
    throw new Error(
      `Salesforce token request failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
    );
  }
  const payload = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!payload.access_token) {
    throw new Error("Salesforce token response missing access_token");
  }
  // SF returns expires_in seconds as a string in some configs; default 7200.
  const expiresInSec = Number(payload.expires_in ?? 7200);
  const expiresAt = Date.now() + expiresInSec * 1000 - TOKEN_REFRESH_BUFFER_MS;
  return { accessToken: payload.access_token, expiresAt };
}

/**
 * Returns a fresh-enough access token, fetching one if the cache is empty
 * or about to expire. Concurrent callers within a cold start may issue
 * parallel token requests; that's acceptable (SF tolerates it, and only
 * the last writer's token is kept in cache).
 */
export async function getAccessToken(): Promise<string> {
  const env = readEnv();
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }
  tokenCache = await fetchAccessToken(env);
  return tokenCache.accessToken;
}

/** Forget the cached token; next call to getAccessToken() will re-auth. */
export function invalidateAccessToken(): void {
  tokenCache = null;
}

// ---------------------------------------------------------------------------
// Federal_Agency__c prefix strip (Phase 1 invariant)
// ---------------------------------------------------------------------------

// Same regex as Intake-form/api/submit.ts (Phase 1). Strips leading
// whitespace AND the U+25BA arrow that marks sub-agency entries in the
// dropdown UI. The SF picklist is stored bare and rejects the prefix.
//
// DO NOT change this regex without verifying against the 28 sub-agency
// entries in artifacts/intake-form/src/pages/Home.tsx. The Path C ship
// (Phase 1, 2026-05-08) depends on this exact normalization.
export const FEDERAL_AGENCY_PREFIX_PATTERN = /^[\s► ]+/;

export function strippedFederalAgency(value: string): string {
  return value.replace(FEDERAL_AGENCY_PREFIX_PATTERN, "").trim();
}

// ---------------------------------------------------------------------------
// createLead
// ---------------------------------------------------------------------------

export type SalesforceLeadFields = Record<string, unknown>;

export type CreateLeadResult = {
  id: string;
  success: true;
};

export type CreateLeadError = {
  status: number;
  /** Errors array from Salesforce. Caller logs these; don't leak to client. */
  errors: Array<{ statusCode?: string; message?: string; fields?: string[] }>;
};

export class SalesforceCreateLeadError extends Error {
  readonly status: number;
  readonly errors: CreateLeadError["errors"];
  constructor(detail: CreateLeadError) {
    super(`Salesforce createLead failed: ${detail.status} ${JSON.stringify(detail.errors).slice(0, 300)}`);
    this.status = detail.status;
    this.errors = detail.errors;
  }
}

async function sfCreateLeadOnce(fields: SalesforceLeadFields): Promise<CreateLeadResult> {
  const env = readEnv();
  const token = await getAccessToken();
  const url = `${env.SF_INSTANCE_URL.replace(/\/$/, "")}/services/data/${env.SF_API_VERSION}/sobjects/Lead`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });

  if (res.status === 401) {
    // Token expired mid-flight — caller will retry.
    invalidateAccessToken();
    const errors = await res.json().catch(() => []);
    throw new SalesforceCreateLeadError({
      status: 401,
      errors: Array.isArray(errors) ? errors : [],
    });
  }

  if (!res.ok) {
    const errors = await res.json().catch(() => []);
    throw new SalesforceCreateLeadError({
      status: res.status,
      errors: Array.isArray(errors) ? errors : [],
    });
  }

  const payload = (await res.json()) as { id?: string; success?: boolean };
  if (!payload.id) {
    throw new SalesforceCreateLeadError({
      status: 500,
      errors: [{ message: "Salesforce returned no Lead id" }],
    });
  }
  return { id: payload.id, success: true };
}

/**
 * POST a new Lead to Salesforce. Applies the Phase 1 prefix-strip to
 * Federal_Agency__c if present. On HTTP 401, re-authenticates once and
 * retries the call. Other errors throw SalesforceCreateLeadError without
 * retry — the caller decides whether to log + mark sf_status='error'.
 */
export async function createLead(fields: SalesforceLeadFields): Promise<CreateLeadResult> {
  // Defensive prefix-strip: submit.ts already strips before calling, but
  // applying here guards against any future caller that forgets.
  const normalized: SalesforceLeadFields = { ...fields };
  if (typeof normalized.Federal_Agency__c === "string") {
    normalized.Federal_Agency__c = strippedFederalAgency(
      normalized.Federal_Agency__c,
    );
  }

  try {
    return await sfCreateLeadOnce(normalized);
  } catch (err) {
    if (err instanceof SalesforceCreateLeadError && err.status === 401) {
      // One retry after re-auth. Lets us survive a token that aged out
      // between cache check and HTTP send.
      return await sfCreateLeadOnce(normalized);
    }
    throw err;
  }
}
