/**
 * Shared curated MY CNC cohort — single source of truth.
 *
 * MY employers with real sales work history in the resume corpus but no
 * web-verifiable presence (so the worker's discovery lane cannot surface
 * them on its own). Consumed by:
 *   - scripts/industry-data/curate-my-cnc-employers.ts (bootstrap: creates
 *     companies/aliases/proposals from the cohort)
 *   - scripts/industry-data/promote-curated-my-proposals.ts (promotion:
 *     attaches corpus evidence sources and promotes stuck proposals)
 *
 * proposalId scheme: `curated-my-` + normalized employer key (lowercase,
 * whitespace -> dashes, non [a-z0-9-] chars stripped).
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Curated cohort: MY employers with real sales work history in the corpus,
// no existing canonical company. years = verified-eligible sales years.
// ---------------------------------------------------------------------------
export type CuratedEmployer = {
  employerName: string; // exact surface as it appears in work history
  industryClass: "cnc" | "industrial";
  priority: number;
  evidence: {
    resumeName: string;
    jobTitle: string;
    years: number;
    workEntryFingerprint?: string;
    resumeIdentity?: string;
  };
};

export const CURATED: CuratedEmployer[] = [
  { employerName: "Edge precision technology sdn bhd", industryClass: "cnc", priority: 100, evidence: { resumeName: "Vincent Saw wei kean", jobTitle: "Senior Sales Manager", years: 14.58, workEntryFingerprint: "work-61466751", resumeIdentity: "externalId:hk.employer.seek.com:profile:6677b787-1c2a-36d3-d321-de3b00000000" } },
  { employerName: "CNC AUTOMOBILE", industryClass: "cnc", priority: 90, evidence: { resumeName: "Suraya Mohd Yusof", jobTitle: "Sales & Marketing", years: 13.17, workEntryFingerprint: "work-faf02529", resumeIdentity: "externalId:hk.employer.seek.com:profile:46478268-7510-42d0-b613-eaf15ae45064" } },
  { employerName: "Seco Tools Sdn Bhd", industryClass: "cnc", priority: 100, evidence: { resumeName: "Wei Kiat Ng", jobTitle: "Technical Sales Engineer", years: 11.17, workEntryFingerprint: "work-6d908507", resumeIdentity: "externalId:hk.employer.seek.com:profile:594ac7b6-0f63-11e2-9b7b-5a02dd2498d8" } },
  { employerName: "BMT Engineering Sdn Bhd,", industryClass: "cnc", priority: 95, evidence: { resumeName: "muhammad suffian sidek", jobTitle: "Sales Role", years: 10.67, workEntryFingerprint: "work-889abc87", resumeIdentity: "externalId:hk.employer.seek.com:profile:5be37020-4360-11ea-97cd-00505680053b" } },
  { employerName: "NSL PRECISION ENGINEERING SERVICES SDN. BHD.", industryClass: "cnc", priority: 100, evidence: { resumeName: "Mohammad Zul Afiq Mohd Amin", jobTitle: "CNC Milling Machinist and Sales Engineer", years: 9.5, workEntryFingerprint: "work-466078df", resumeIdentity: "externalId:hk.employer.seek.com:profile:dc91d05a-94e4-11e6-8284-005056a2749b" } },
  { employerName: "Seng Heng Precision Tools Sdn.Bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Kelvin Tan Shen Yeon", jobTitle: "Mechanical Designer cum CNC Programmer & Salesperson", years: 7.67, workEntryFingerprint: "work-f1864d7f", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/298c3830-3988-11e7-96c0-005056b15d2d" } },
  { employerName: "T.E.M Engineering (JB) Sdn. Bhd.", industryClass: "cnc", priority: 90, evidence: { resumeName: "zheyong pang", jobTitle: "Sales Executive", years: 6.16, workEntryFingerprint: "work-dafc9f8e", resumeIdentity: "externalId:hk.employer.seek.com:profile:dc359597-c090-42d0-9ba5-4cf13bda647f" } },
  { employerName: "SFE machinery sdn bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "kee hoo ooi", jobTitle: "Sales Engineer", years: 6.0, workEntryFingerprint: "work-ef8dc447", resumeIdentity: "externalId:hk.employer.seek.com:profile:9973d916-55cc-47a6-af0f-b9647f75e8a9" } },
  { employerName: "Midas Precision sdn bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Redzaudin Sariman", jobTitle: "Sales Coordinator, CNC Turning Programmer", years: 5.58, workEntryFingerprint: "work-4bf148b7", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/94a0bd2a-01d9-11e8-9577-005056b16351" } },
  { employerName: "Smart Tools Marketing Enterprise", industryClass: "cnc", priority: 90, evidence: { resumeName: "HONG LIANG LIM", jobTitle: "Admin CUM Sales Assistant", years: 5.5, workEntryFingerprint: "work-cb87171d", resumeIdentity: "externalId:hk.employer.seek.com:profile:90e2d134-9566-11ed-98f1-005056a2502e" } },
  { employerName: "Leesonmech Engineering (M) Sdn. Bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Johnson Lee Wei Tao", jobTitle: "Technical Sales Engineer", years: 5.25, workEntryFingerprint: "work-25d8d458", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/584114693" } },
  { employerName: "Newbillion Precision Metal", industryClass: "cnc", priority: 95, evidence: { resumeName: "Jeremy Tong", jobTitle: "Business Development cum Operations Manager (CNC)", years: 5.08, workEntryFingerprint: "work-f0e63e6f", resumeIdentity: "externalId:hk.employer.seek.com:profile:ddd17641-5962-4b6a-a31a-89e34672a822" } },
  { employerName: "Redstar Engineering", industryClass: "cnc", priority: 90, evidence: { resumeName: "Cheng Yee Hoong", jobTitle: "Sales Manager", years: 5.0, workEntryFingerprint: "work-634ecdf7", resumeIdentity: "externalId:hk.employer.seek.com:profile:68187143-448c-64f4-6242-774e00000000" } },
  { employerName: "YD Laser Technologies Co. Ltd", industryClass: "cnc", priority: 90, evidence: { resumeName: "CHET SEONG HOOI", jobTitle: "Senior Sales Manager", years: 2.08, workEntryFingerprint: "work-600bee25", resumeIdentity: "externalId:hk.employer.seek.com:profile:9b4ae141-e2d8-4541-98d3-5cef954888e0" } },
  { employerName: "Robo Tech Machinery Sdn Bhd.", industryClass: "cnc", priority: 90, evidence: { resumeName: "Luiz Lim Eu Hock", jobTitle: "Sales Manager", years: 1.25, workEntryFingerprint: "work-0c33de59", resumeIdentity: "externalId:hk.employer.seek.com:profile:ffc3ec44-e02b-11df-9d5a-001ec9b02997" } },
  { employerName: "COOLTECH ENGINEERING SDN BHD", industryClass: "cnc", priority: 85, evidence: { resumeName: "Neo Kangzhen", jobTitle: "Sales Engineer", years: 1.08, workEntryFingerprint: "work-d6a005e7", resumeIdentity: "externalId:hk.employer.seek.com:profile:9d673e90-e727-11e9-97a2-00505680053b" } },
  { employerName: "Prosdata Engineering", industryClass: "cnc", priority: 85, evidence: { resumeName: "Tan Yong Hong", jobTitle: "Sales Engineer", years: 1.08, workEntryFingerprint: "work-396b1fd6", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/503955779" } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a company surface to a key: trim, lowercase, whitespace -> dashes. */
export function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Deterministic curated proposalId for a company key. */
export function proposalIdFor(companyKey: string): string {
  return `curated-my-${companyKey.replace(/[^a-z0-9-]/g, "")}`;
}

/**
 * Stable id-suffix for a company key. ASCII keys pass through as-is
 * (minus punctuation); CJK keys strip to an empty string, so fall back
 * to a short content hash to keep ids unique per employer.
 */
export function idSuffix(value: string): string {
  const ascii = value.replace(/[^a-z0-9-]/g, "");
  if (ascii.length > 0) return ascii;
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

/** Seek talentsearch URL for a resume name on the MY market. */
export function resumeSearchUrl(resumeName: string): string {
  return `https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=${encodeURIComponent(resumeName)}&market=MY&pageNumber=1`;
}

/** FNV-1a 32-bit hash of `value` as a lowercase hex string. */
export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
