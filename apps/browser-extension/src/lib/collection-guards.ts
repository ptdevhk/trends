/**
 * Collection guard utilities — field validation and guard application
 * for resume data quality during extraction.
 */

const DEFAULT_COLLECTION_GUARDS = {
  job5156: "experience,jobIntention,selfIntro",
  "51job": "experience,jobIntention,selfIntro",
  seek: "experience,jobIntention,selfIntro",
};

const GUARD_FIELD_NAMES = new Set([
  "experience",
  "jobIntention",
  "selfIntro",
  "expectedSalary",
  "workHistory",
  "profileEducation",
  "projectExperience",
  "skills",
  "licences",
]);

const GUARD_ARRAY_FIELD_NAMES = new Set([
  "workHistory",
  "profileEducation",
  "projectExperience",
  "skills",
  "licences",
]);

async function loadCollectionGuards() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      { collectionGuards: DEFAULT_COLLECTION_GUARDS },
      (items) => resolve(items.collectionGuards || {}),
    );
  });
}

function parseGuardFieldNames(csv) {
  if (!csv || typeof csv !== "string") return [];
  return Array.from(
    new Set(
      csv
        .split(",")
        .map((field) => field.trim())
        .filter((field) => GUARD_FIELD_NAMES.has(field)),
    ),
  );
}

function applyCollectionGuards(resume, guardFieldNames) {
  if (
    !resume ||
    typeof resume !== "object" ||
    !Array.isArray(guardFieldNames) ||
    guardFieldNames.length === 0
  ) {
    return resume;
  }

  const guarded = { ...resume };
  for (const field of guardFieldNames) {
    guarded[field] = GUARD_ARRAY_FIELD_NAMES.has(field) ? [] : "";
  }
  return guarded;
}

export {
  DEFAULT_COLLECTION_GUARDS,
  GUARD_FIELD_NAMES,
  GUARD_ARRAY_FIELD_NAMES,
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,
};
