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
