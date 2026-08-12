/**
 * API-enforced JSON schemas for every LLM stage (xAI structured outputs).
 *
 * All schemas follow strict-mode constraints: every object level sets
 * `additionalProperties: false` and lists every property in `required`.
 * Keep keyword usage conservative (type/enum/properties/items only) so the
 * schemas stay compatible with provider strict validators.
 */

export type JsonSchemaObject = Record<string, unknown>;

/**
 * Pass 1 selection schema. Experience references are constrained to the
 * actual catalog IDs via enum, so the API itself prevents made-up IDs.
 */
export function buildSelectionSchema(catalogIds: string[]): JsonSchemaObject {
  const idItem: JsonSchemaObject =
    catalogIds.length > 0
      ? { type: "string", enum: catalogIds }
      : { type: "string" };

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "targetTitle",
      "company",
      "leadExperienceIds",
      "supportingExperienceIds",
      "keywordsToHit",
      "rationale",
    ],
    properties: {
      targetTitle: {
        type: "string",
        description: "Best-fit target job title for this application",
      },
      company: { type: "string", description: "Company name, empty string if unknown" },
      leadExperienceIds: {
        type: "array",
        description: "Catalog IDs of 1-3 LEAD experiences, strongest first",
        items: idItem,
      },
      supportingExperienceIds: {
        type: "array",
        description: "Catalog IDs of 0-3 supporting experiences (never repeats a lead)",
        items: idItem,
      },
      keywordsToHit: {
        type: "array",
        description: "8-15 concrete skills/tools/phrases from the posting that the documents must cover",
        items: { type: "string" },
      },
      rationale: {
        type: "string",
        description: "1-3 sentences on fit; note weak fit honestly",
      },
    },
  };
}

/** Per-document draft schema — identical for all four kit documents. */
export const DRAFT_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["markdown", "sourcesUsed"],
  properties: {
    markdown: {
      type: "string",
      description: "The complete document as plain markdown (no HTML)",
    },
    sourcesUsed: {
      type: "array",
      description: "Catalog IDs of the experience files actually drawn from",
      items: { type: "string" },
    },
  },
};

/** Verification pass schema — severity-tagged findings. */
export const VERIFICATION_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "summary"],
  properties: {
    findings: {
      type: "array",
      description: "Real problems only; empty array means a clean pass",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["document", "category", "severity", "detail", "suggestion"],
        properties: {
          document: {
            type: "string",
            enum: ["resume", "coverLetter", "alignmentNotes", "starPrep"],
            description: "The single document that should change to fix this",
          },
          category: {
            type: "string",
            enum: ["grounding", "consistency", "form", "keywords"],
          },
          severity: {
            type: "string",
            enum: ["info", "minor", "major"],
            description: "major = must fix before sending; minor = should fix; info = FYI",
          },
          detail: { type: "string", description: "What is wrong, quoting the offending text" },
          suggestion: { type: "string", description: "How to fix it (empty string if obvious)" },
        },
      },
    },
    summary: {
      type: "string",
      description: "2-3 sentence overall QA assessment",
    },
  },
};

/* ---------------------------------------------------------------------- */
/* Postings: filter derivation + fit scan                                  */
/* ---------------------------------------------------------------------- */

/** TheirStack seniority vocabulary — mirrored in jobs/provider.ts. */
const FILTER_SENIORITY = ["junior", "mid_level", "senior", "staff", "c_level"];

export const FILTER_DERIVATION_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "titleQueries",
    "pivotTitleQueries",
    "countryCodes",
    "remotePreference",
    "seniority",
    "maxAgeDays",
    "minSalaryUsd",
    "descriptionKeywords",
    "rationale",
  ],
  properties: {
    titleQueries: {
      type: "array",
      description: "2-4 short job-title search queries, plain words only",
      items: { type: "string" },
    },
    pivotTitleQueries: {
      type: "array",
      description:
        "1-2 adjacent 'near field' pivot title queries grounded in transferable skills, plain words only",
      items: { type: "string" },
    },
    countryCodes: {
      type: "array",
      description: "ISO-2 country codes where the applicant can work; empty if unknown",
      items: { type: "string" },
    },
    remotePreference: { type: "string", enum: ["remote_only", "any"] },
    seniority: {
      type: "array",
      description: "0-2 seniority buckets matching the applicant's stage",
      items: { type: "string", enum: FILTER_SENIORITY },
    },
    maxAgeDays: { type: "integer", description: "Posting max age in days, 7-30 (14 default)" },
    minSalaryUsd: { type: "number", description: "Annual USD salary floor; 0 for none" },
    descriptionKeywords: {
      type: "array",
      description: "0-3 niche literal keywords; usually empty",
      items: { type: "string" },
    },
    rationale: {
      type: "string",
      description:
        "One or two sentences explaining the choices, including which transferable skills back the pivot titles",
    },
  },
};

/**
 * Batch fit-scan schema. Job ids AND experience references are both
 * enum-constrained so the API prevents made-up ids (same pattern as
 * buildSelectionSchema).
 *
 * Legitimacy signal taxonomy adapted from career-ops (MIT licence,
 * Santiago Fernández de Valderrama — github.com/santifer/career-ops).
 * Design port: same signal categories and calibration rules, no shared code.
 */
export function buildFitScanSchema(
  jobIds: string[],
  catalogIds: string[]
): JsonSchemaObject {
  const expItem: JsonSchemaObject =
    catalogIds.length > 0 ? { type: "string", enum: catalogIds } : { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        description: "Exactly one entry per posting",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "jobId",
            "score",
            "rationale",
            "matchedExperienceIds",
            "brief",
            "legitimacy",
            "legitimacySignals",
          ],
          properties: {
            jobId: { type: "string", enum: jobIds },
            score: { type: "integer", description: "Calibrated 0-100 fit score" },
            rationale: {
              type: "string",
              description: "One sentence naming the decisive factors",
            },
            matchedExperienceIds: {
              type: "array",
              description: "0-4 catalog IDs of best-matching experiences, strongest first",
              items: expItem,
            },
            legitimacy: {
              type: "string",
              enum: ["high_confidence", "caution", "suspicious"],
              description:
                "Posting legitimacy tier — separate from fit score, never blended into it. high_confidence: nothing unusual; caution: one or more soft signals worth noting; suspicious: two or more corroborating hard signals.",
            },
            legitimacySignals: {
              type: "array",
              description:
                "0-3 short, observational notes on legitimacy signals (empty for high_confidence). Each string names the observation without accusing — e.g. 'senior requirements under an entry-level title'. Never include applicant-fit commentary.",
              items: { type: "string" },
            },
            brief: {
              type: "object",
              additionalProperties: false,
              required: [
                "targetTitle",
                "company",
                "seniority",
                "mustHaves",
                "niceToHaves",
                "responsibilities",
                "atsKeywords",
                "compensation",
              ],
              properties: {
                targetTitle: { type: "string", description: "Role title as posted" },
                company: { type: "string", description: "Empty string if unknown" },
                seniority: {
                  type: "string",
                  description: "As stated/implied by the posting; empty if unclear",
                },
                mustHaves: {
                  type: "array",
                  description: "Hard requirements the posting states",
                  items: { type: "string" },
                },
                niceToHaves: { type: "array", items: { type: "string" } },
                responsibilities: {
                  type: "array",
                  description: "Core responsibilities of the role",
                  items: { type: "string" },
                },
                atsKeywords: {
                  type: "array",
                  description: "8-15 concrete skills/tools/phrases from the posting",
                  items: { type: "string" },
                },
                compensation: {
                  type: "string",
                  description: "Compensation exactly as stated; empty string if not stated",
                },
              },
            },
          },
        },
      },
    },
  };
}
