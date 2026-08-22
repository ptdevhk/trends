/**
 * Deterministic synthetic MY (Malaysia) resume generator for the scoring
 * cohort harness.
 *
 * Produces N=35 synthetic resumes (EN + BM variants) stratified by target
 * tier, plus golden targets and the audit CSV consumed by the IRR gate.
 *
 * Rubric-blind by construction: resume content is generated from
 * template-anchored slot-filling pools written in resume language, never in
 * evaluation language (see the label-leakage guard in the test file).
 *
 * Usage:
 *   bun run scripts/generate-my-cohort.ts --seed 20260819 --out tmp/my-cohort
 *
 * Outputs:
 *   <out>/resumes/my-001.json ... my-035.json   (resume documents, no targets)
 *   <out>/targets.json                           (golden tier/dims per profile)
 *   <out>/cohort.csv                             (profileResumeId,board,rating,score)
 *
 * Stratification note: the approved spec lists L1=5, L2=9, L3=10, L4=7, L5=3
 * and states "5+9+10+7+3 = 35" — that sum is 34. The spec asserts N=35
 * twice (frontmatter + body), so the counts are corrected here by
 * largest-remainder rounding of 15/25/30/20/10% over 35: L5 3 -> 4, giving
 * 5/9/10/7/4 = 35.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Tier = "L1" | "L2" | "L3" | "L4" | "L5";
export type ArchetypeId = "cnc_engineering" | "b2b_sales" | "software_engineering" | "operations";
export type Language = "en" | "ms";
export type DimId = "hard_skills" | "experience_depth" | "domain_context" | "progression" | "credentials";

export const DIM_IDS: DimId[] = [
  "hard_skills",
  "experience_depth",
  "domain_context",
  "progression",
  "credentials",
];

/** Deterministic PRNG (mulberry32) — same seed, same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STRATIFICATION: Record<Tier, number> = { L1: 5, L2: 9, L3: 10, L4: 7, L5: 4 };

/** Per-tier target dim vectors (order = DIM_IDS). Overall rating = tier. */
const TIER_VECTORS: Record<Tier, number[]> = {
  L1: [1, 1, 1, 1, 1],
  L2: [2, 2, 1, 2, 2],
  L3: [3, 3, 3, 3, 3],
  L4: [4, 4, 4, 4, 3],
  L5: [5, 5, 4, 5, 4],
};

export const TIER_RATING: Record<Tier, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

const TIER_INDEX: Record<Tier, number> = { L1: 0, L2: 1, L3: 2, L4: 3, L5: 4 };

interface ArchetypeDef {
  id: ArchetypeId;
  label: string;
  locations: string[];
  /** 5 seniority steps, junior -> lead/manager. */
  titles: string[];
  companies: string[];
  industry: [string, string, string, string, string];
  skillsByLevel: [string[], string[], string[], string[], string[]];
  highlightsByLevel: [string[], string[], string[], string[], string[]];
  educationByLevel: [never, string[], string[], string[], string[]];
  certsByLevel: [string[], string[], string[], string[], string[]];
  /** Noun-phrase achievement fragments for summary slots, per language; index by level-1 (L1/L2 empty). */
  achievementsByLevel: Record<Language, string[][]>;
}

const GENERIC_L1_HIGHLIGHTS = [
  "Followed daily work instructions from supervisors",
  "Kept the work area clean and organized",
  "Completed assigned tasks on time",
];

const GENERIC_L2_HIGHLIGHTS = [
  "Carried out routine tasks according to checklists",
  "Prepared simple daily reports",
  "Learned new tasks quickly with guidance",
];

const GENERIC_L1_SKILLS = ["Following instructions", "Basic record keeping", "Housekeeping"];

const UNRELATED_TITLES = ["Retail Assistant", "Store Assistant", "General Worker", "Packing Assistant"];

const UNRELATED_COMPANIES = [
  "Sunrise Mart Sdn Bhd",
  "CityFresh Retail Sdn Bhd",
  "QuickRide Logistics Sdn Bhd",
  "Kedai Runcit Cahaya Jaya",
];

const GENERIC_INDUSTRY_COMPANIES = [
  "Meridian Industries Sdn Bhd",
  "Nusantara Manufacturing Sdn Bhd",
  "Aspirasi Engineering Sdn Bhd",
  "Delta Fabrication Works Sdn Bhd",
];

const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  cnc_engineering: {
    id: "cnc_engineering",
    label: "CNC Engineering",
    locations: ["Bayan Lepas, Penang", "Batu Kawan, Penang", "Prai, Penang", "Johor Bahru, Johor", "Bayan Lepas, Penang"],
    titles: ["Machine Operator Assistant", "CNC Operator", "CNC Programmer", "Senior CNC Programmer", "Tooling Engineering Lead"],
    companies: [
      "Penang Precision Tooling Sdn Bhd",
      "Bayan Lepas Engineering Works Sdn Bhd",
      "Northern Precision Manufacturing Sdn Bhd",
      "Batu Kawan Tool & Die Sdn Bhd",
      "Johor Precision Components Sdn Bhd",
    ],
    industry: [
      "retail and light services",
      "general manufacturing",
      "precision machining in Penang",
      "semiconductor tooling around the Bayan Lepas FIZ",
      "semiconductor tooling across the Penang FIZ ecosystem",
    ],
    skillsByLevel: [
      GENERIC_L1_SKILLS,
      ["CNC machine operation", "Basic measurement tools (calipers, micrometers)", "Blueprint reading", "Tool offset adjustment"],
      ["CNC programming (Mastercam)", "GD&T interpretation", "First-article inspection", "Fixture setup and prove-out"],
      ["5-axis machining", "CAM programming", "Fixture design", "FMEA participation", "Process capability checks"],
      ["Tooling engineering leadership", "Automation integration", "SPC and capability studies", "New product introduction tooling", "Vendor tooling audits"],
    ],
    highlightsByLevel: [
      GENERIC_L1_HIGHLIGHTS,
      GENERIC_L2_HIGHLIGHTS,
      ["Programmed CNC machines in Mastercam for production orders", "Inspected first articles and documented measurements", "Reduced setup time by 15% through standardized fixture layouts"],
      ["Programmed and proved out 5-axis machining sequences", "Designed fixtures that cut changeover time by 20%", "Led FMEA reviews for two new product families"],
      ["Led tooling engineering for a new product line from quoting to PPAP", "Integrated automated probing into machining cells", "Championed SPC adoption, reducing scrap rate by 30%"],
    ],
    educationByLevel: [
      [],
      ["SPM (Science stream) — SMK Seri Utara", "STPM — SMK Seri Utara"],
      ["Diploma in Mechanical Engineering — UiTM", "Diploma in Mechanical Engineering — Politeknik Seberang Perai"],
      ["Bachelor of Mechanical Engineering — UTM", "Diploma in Mechanical Engineering — UiTM (with distinction)"],
      ["Bachelor of Mechanical Engineering — UTM", "MSc in Manufacturing Engineering — UTM"],
    ],
    certsByLevel: [
      [],
      ["Safety induction certificate"],
      ["OSHA/KKP safety training", "Mastercam operator certificate"],
      ["OSHA/KKP safety training", "CNC programming advanced course (Mastercam)", "Six Sigma Yellow Belt"],
      ["OSHA/KKP safety training", "Lean Six Sigma Green Belt", "Registered machinery engineer (BEM associate)"],
    ],
    achievementsByLevel: {
      en: [
        [],
        [],
        ["a 15% setup-time reduction through standardized fixture layouts", "first-article inspection and measurement documentation"],
        ["fixture designs that cut changeover time by 20%", "FMEA reviews for two new product families"],
        ["tooling engineering for a new product line from quoting to PPAP", "SPC adoption that reduced scrap rate by 30%"],
      ],
      ms: [
        [],
        [],
        ["pengurangan masa setup sebanyak 15% melalui susun atur lekapan standard", "pemeriksaan first-article dan dokumentasi ukuran"],
        ["reka bentuk lekapan yang mengurangkan masa pertukaran sebanyak 20%", "semakan FMEA untuk dua keluarga produk baharu"],
        ["kejuruteraan tooling untuk barisan produk baharu dari sebut harga hingga PPAP", "penggunaan SPC yang mengurangkan kadar skrap sebanyak 30%"],
      ],
    },
  },
  b2b_sales: {
    id: "b2b_sales",
    label: "B2B Sales",
    locations: ["Petaling Jaya, Selangor", "Shah Alam, Selangor", "Klang Valley", "Johor Bahru, Johor", "Penang"],
    titles: ["Sales Assistant", "Sales Executive", "Account Executive", "Senior Account Executive", "Key Account Manager"],
    companies: [
      "KL Tech Solutions Sdn Bhd",
      "Selangor Enterprise Systems Sdn Bhd",
      "Valley FMCG Distributors Sdn Bhd",
      "Nusantara SaaS Sdn Bhd",
      "Southern Trade Partners Sdn Bhd",
    ],
    industry: [
      "retail and services",
      "general commercial sales",
      "B2B sales in the Klang Valley",
      "B2B sales across FMCG distribution and SaaS in the Klang Valley",
      "enterprise B2B sales across FMCG and SaaS nationally",
    ],
    skillsByLevel: [
      GENERIC_L1_SKILLS,
      ["Cold calling scripts", "CRM data entry", "Basic negotiation", "Product knowledge sheets"],
      ["B2B lead generation", "Pipeline management in CRM", "Proposal drafting", "Quota achievement (80-110%)"],
      ["Strategic account planning", "Contract negotiation", "Forecast accuracy", "Channel partner management"],
      ["Enterprise sales leadership", "Territory strategy", "Executive-level presentations", "Revenue forecasting and board reporting"],
    ],
    highlightsByLevel: [
      GENERIC_L1_HIGHLIGHTS,
      GENERIC_L2_HIGHLIGHTS,
      ["Generated 25+ qualified leads per quarter", "Closed deals worth RM 300k in annual recurring revenue", "Maintained 85%+ pipeline accuracy in CRM"],
      ["Grew two key accounts by 40% year on year", "Negotiated multi-year contracts with two enterprise clients", "Forecast within 5% for four consecutive quarters"],
      ["Built territory strategy that doubled regional revenue", "Presented renewal strategy to C-level executives", "Led a team of 6 account executives to 120% quota"],
    ],
    educationByLevel: [
      [],
      ["SPM (Commerce stream) — SMK Seri Utama", "STPM — SMK Seri Utama"],
      ["Diploma in Business Studies — TAR UMT", "Diploma in Business Studies — UiTM"],
      ["Bachelor of Business Administration — UUM", "Diploma in Business Studies — TAR UMT (with distinction)"],
      ["Bachelor of Business Administration — UUM", "MBA — UUM"],
    ],
    certsByLevel: [
      [],
      ["In-house sales training"],
      ["Professional selling skills course", "CRM platform certification"],
      ["Professional selling skills course", "Account management certification (Miller Heiman)", "Negotiation workshop"],
      ["Professional selling skills course", "Strategic account management certification", "Sales leadership program"],
    ],
    achievementsByLevel: {
      en: [
        [],
        [],
        ["25+ sales leads per quarter", "RM 300k in annual recurring revenue"],
        ["two key accounts growing 40% year on year", "multi-year contract negotiations with two enterprise clients"],
        ["a territory strategy that doubled regional revenue", "renewal strategy presentations to C-level executives"],
      ],
      ms: [
        [],
        [],
        ["25+ lead jualan setiap suku tahun", "jualan bernilai RM 300k hasil tahunan berulang"],
        ["pertumbuhan dua akaun utama sebanyak 40% tahun ke tahun", "rundingan kontrak pelbagai tahun dengan dua pelanggan perusahaan"],
        ["strategi wilayah yang menggandakan hasil serantau", "pembentangan strategi pembaharuan kepada eksekutif C-level"],
      ],
    },
  },
  software_engineering: {
    id: "software_engineering",
    label: "Software Engineering (MY CSIT)",
    locations: ["Cyberjaya, Selangor", "Petaling Jaya, Selangor", "Klang Valley", "Johor Bahru, Johor", "Penang"],
    titles: ["Junior Developer", "Software Developer", "Software Engineer", "Senior Software Engineer", "Tech Lead"],
    companies: [
      "KL Digital Works Sdn Bhd",
      "Cyberjaya Software House Sdn Bhd",
      "Selangor Fintech Lab Sdn Bhd",
      "Nusantara Cloud Services Sdn Bhd",
      "Penang EDC Software Sdn Bhd",
    ],
    industry: [
      "general office support",
      "general IT services",
      "software development in the Klang Valley",
      "software development in the MY CSIT ecosystem (Cyberjaya and Klang Valley)",
      "platform engineering across the MY CSIT ecosystem",
    ],
    skillsByLevel: [
      GENERIC_L1_SKILLS,
      ["HTML and CSS basics", "Simple JavaScript scripts", "Version control basics (Git)", "Following code review comments"],
      ["TypeScript and React development", "REST API integration", "SQL queries", "CI/CD pipelines (basic)", "Automated unit testing"],
      ["Distributed systems design", "Performance optimization", "Cloud infrastructure (AWS)", "System architecture reviews", "Mentoring junior developers"],
      ["Platform architecture leadership", "High-availability systems", "Team technical direction", "Cross-team design governance", "Cloud cost and reliability strategy"],
    ],
    highlightsByLevel: [
      GENERIC_L1_HIGHLIGHTS,
      GENERIC_L2_HIGHLIGHTS,
      ["Delivered 3 feature modules in React with TypeScript", "Integrated payment gateway APIs", "Wrote unit tests covering 80% of new code"],
      ["Refactored a legacy service, cutting latency by 40%", "Designed an event-driven pipeline for order processing", "Mentored 3 junior engineers to independent delivery"],
      ["Set the technical direction for a 12-engineer platform team", "Led migration to microservices with zero downtime", "Owned reliability strategy, achieving 99.95% uptime"],
    ],
    educationByLevel: [
      [],
      ["SPM (Science stream) — SMK Seri Utara", "STPM — SMK Seri Utara"],
      ["Bachelor of Computer Science — UTM", "Bachelor of Information Technology — TAR UMT", "Bachelor of Computer Science — MMU"],
      ["Bachelor of Computer Science — UTM (with distinction)", "Bachelor of Software Engineering — MMU"],
      ["Bachelor of Computer Science — UTM", "Master of Computer Science — UTM"],
    ],
    certsByLevel: [
      [],
      ["Basic computer course certificate"],
      ["AWS Certified Cloud Practitioner", "Professional Scrum Master I"],
      ["AWS Solutions Architect Associate", "Professional Scrum Master I", "TypeScript advanced training"],
      ["AWS Solutions Architect Professional", "Certified Kubernetes Administrator", "TOGAF foundation"],
    ],
    achievementsByLevel: {
      en: [
        [],
        [],
        ["3 feature modules in React with TypeScript", "payment gateway API integrations"],
        ["a legacy service refactor that cut latency by 40%", "an event-driven pipeline for order processing"],
        ["technical direction for a 12-engineer platform team", "a migration to microservices with zero downtime"],
      ],
      ms: [
        [],
        [],
        ["3 modul ciri menggunakan React dan TypeScript", "integrasi API gerbang pembayaran"],
        ["pembaikan semula perkhidmatan lama yang mengurangkan latensi sebanyak 40%", "saluran paip berasaskan peristiwa untuk pemprosesan pesanan"],
        ["hala tuju teknikal untuk pasukan platform 12 jurutera", "migrasi ke mikroservis tanpa masa henti"],
      ],
    },
  },
  operations: {
    id: "operations",
    label: "Operations",
    locations: ["Shah Alam, Selangor", "Klang Valley", "Johor Bahru, Johor", "Penang", "Kuantan, Pahang"],
    titles: ["Operations Assistant", "Operations Executive", "Operations Supervisor", "Operations Manager", "Regional Operations Manager"],
    companies: [
      "Klang Valley Logistics Sdn Bhd",
      "Selangor Distribution Centre Sdn Bhd",
      "Northern Warehouse Services Sdn Bhd",
      "Southern FMCG Operations Sdn Bhd",
      "Nusantara Supply Chain Sdn Bhd",
    ],
    industry: [
      "retail operations",
      "general logistics support",
      "warehouse operations in the Klang Valley",
      "distribution operations across the Klang Valley and Penang",
      "regional supply chain operations across Malaysia",
    ],
    skillsByLevel: [
      GENERIC_L1_SKILLS,
      ["Inventory counting", "Forklift operation", "Dispatch coordination basics", "Daily shift reports"],
      ["Warehouse process management", "Inventory accuracy programs", "SOP documentation", "Team scheduling", "Transport coordination"],
      ["Lean process improvement", "WMS implementation", "KPI reporting", "Cost reduction programs", "Cross-functional coordination"],
      ["Supply chain strategy", "Regional operations leadership", "Budget and P&L ownership", "Digital transformation programs", "Vendor and 3PL management"],
    ],
    highlightsByLevel: [
      GENERIC_L1_HIGHLIGHTS,
      GENERIC_L2_HIGHLIGHTS,
      ["Managed a 12-person warehouse shift", "Raised inventory accuracy from 92% to 98%", "Documented SOPs for receiving and dispatch"],
      ["Cut order turnaround time by 25% through process redesign", "Led WMS rollout across two sites", "Delivered 10% cost savings in transport spend"],
      ["Owned regional operations P&L of RM 8M", "Led digital transformation covering 4 warehouses", "Redesigned the network, cutting delivery lead time by 30%"],
    ],
    educationByLevel: [
      [],
      ["SPM (Commerce stream) — SMK Seri Utama", "STPM — SMK Seri Utama"],
      ["Diploma in Logistics Management — TAR UMT", "Diploma in Business Studies — UiTM"],
      ["Bachelor of Business Administration (Logistics) — UUM", "Diploma in Logistics Management — TAR UMT (with distinction)"],
      ["Bachelor of Business Administration — UUM", "MBA (Operations) — UUM"],
    ],
    certsByLevel: [
      [],
      ["Forklift license (FiT)"],
      ["Forklift license (FiT)", "Warehouse operations certificate"],
      ["Forklift license (FiT)", "Lean Six Sigma Yellow Belt", "Certified Supply Chain Associate (CSCA)"],
      ["Certified Supply Chain Professional (CSCP)", "Lean Six Sigma Green Belt", "Occupational safety coordinator training"],
    ],
    achievementsByLevel: {
      en: [
        [],
        [],
        ["an inventory accuracy increase from 92% to 98%", "SOPs for receiving and dispatch"],
        ["a 25% reduction in order turnaround time through process redesign", "a WMS rollout across two sites"],
        ["regional operations P&L of RM 8M", "a digital transformation covering 4 warehouses"],
      ],
      ms: [
        [],
        [],
        ["peningkatan ketepatan inventori daripada 92% kepada 98%", "pengurusan syif gudang 12 orang"],
        ["pengurangan masa pusingan pesanan sebanyak 25% melalui reka bentuk semula proses", "pelaksanaan WMS merentas dua tapak"],
        ["pemilikan P&L operasi serantau RM 8J", "transformasi digital merentas 4 gudang"],
      ],
    },
  },
};

/** Summary templates per tier; {role} {years} {skills} {domain} {achievement} {achievement2} slots. */
const SUMMARIES: Record<Language, Record<Tier, string>> = {
  en: {
    L1: "Reliable and hardworking. Prior experience in {domain}. Seeking a first career step in {industry} and willing to learn on the job.",
    L2: "Entry-level {role} with {years} years of experience in {domain}. Comfortable with {skills}. Looking to grow into a full {role} role.",
    L3: "{role} with {years} years of experience in {domain}. Skilled in {skills}. Delivered {achievement} in the current role.",
    L4: "Seasoned {role} with {years} years in {domain}. Track record of {achievement}, including leading {achievement2}. Looking to contribute at a higher level.",
    L5: "Accomplished {role} with {years} years in {domain}. Led {achievement2} and built teams around {skills}. Seeking a leadership role in the same industry.",
  },
  ms: {
    L1: "Rajin dan boleh dipercayai. Mempunyai pengalaman dalam {domain}. Mencari peluang pertama dalam {industry} dan bersedia belajar.",
    L2: "{role} peringkat permulaan dengan {years} tahun pengalaman dalam {domain}. Selesa dengan {skills}. Berhasrat berkembang menjadi {role} sepenuhnya.",
    L3: "{role} dengan {years} tahun pengalaman dalam {domain}. Mahir dalam {skills}. Mencapai {achievement} dalam peranan semasa.",
    L4: "{role} berpengalaman dengan {years} tahun dalam {domain}. Rekod kukuh mencapai {achievement}, termasuk menerajui {achievement2}. Bersedia menyumbang pada tahap lebih tinggi.",
    L5: "{role} dengan {years} tahun pengalaman dalam {domain}. Menerajui {achievement2} dan membina pasukan dalam bidang {skills}. Mencari peranan kepimpinan dalam industri yang sama.",
  },
};

const ENGLISH_LEVEL_BY_CREDENTIALS: [string, string, string, string, string] = [
  "Basic",
  "Conversational",
  "Professional working proficiency",
  "Full professional proficiency",
  "Full professional proficiency",
];

const NAMES = [
  "Aiman bin Roslan", "Muhammad Faiz bin Azman", "Hafiz bin Idris", "Danish bin Omar",
  "Iqmal bin Razak", "Farhan bin Kamal", "Azim bin Rahman", "Syafiq bin Zulkifli",
  "Nur Aisyah binti Zulkifli", "Siti Sarah binti Hassan", "Aina binti Yusof", "Farah binti Kamal",
  "Nurul Iman binti Rahman", "Alya binti Razak", "Sofea binti Omar", "Izzah binti Azman",
  "Tan Wei Jian", "Lim Mei Ling", "Chong Kar Wai", "Ng Sze Ling",
  "Lee Jun Hao", "Ooi Xin Yi", "Wong Chee Hong", "Teo Jia Min",
  "Raj Kumar Pillai", "Priya a/p Raman", "Suresh a/l Murugan", "Kavitha a/p Subramaniam",
  "Arvind Nair", "Sharmila a/p Krishnan", "Viknesh a/l Ramasamy", "Divya a/p Selvam",
  "Ahmad Tarmizi bin Sulaiman", "Goh Keng Huat", "Mohan a/l Rajan",
  "Lau Siew Peng", "Rizal bin Mahadi", "Chen Hui Ting", "Balqis binti Abdullah", "Kumaravel a/l Muniandy",
];

/** Derive a deterministic @example.com email from a synthetic name. */
function emailFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((p) => !["bin", "binti", "a/p", "a/l"].includes(p))
    .map((p) => p.toLowerCase());
  return `${parts.join(".")}@example.com`;
}

export interface CohortProfile {
  profileResumeId: string;
  board: "MY";
  language: Language;
  archetype: ArchetypeId;
  personal: { name: string; email: string; phone: string; location: string };
  summary: string;
  skills: string[];
  experience: Array<{ title: string; company: string; location: string; start: string; end: string; highlights: string[] }>;
  education?: Array<{ degree: string; year: number }>;
  certifications?: string[];
  languages: Array<{ language: string; level: string }>;
}

export interface CohortTarget {
  tier: Tier;
  overall: number;
  dims: Record<DimId, number>;
}

export interface CohortOutput {
  profiles: CohortProfile[];
  targets: Record<string, CohortTarget>;
  csvRows: string[];
}

const MONTHS_PER_YEAR = 12;
// Reference "now": August 2026.
const NOW_MONTH = 2026 * MONTHS_PER_YEAR + 7;

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatMonth(totalMonths: number): string {
  const y = Math.floor(totalMonths / MONTHS_PER_YEAR);
  const m = (totalMonths % MONTHS_PER_YEAR) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

interface Timeline {
  careerStartMonth: number;
  gradYear: number;
  roles: Array<{ startMonth: number; endMonth: number }>;
}

/** Builds a non-overlapping role timeline; invariants hold by construction. */
function buildTimeline(experienceLevel: number, progressionLevel: number, rng: () => number): Timeline {
  const roleCounts: Record<number, number> = { 1: 2, 2: 3, 3: 3, 4: 4, 5: 4 };
  const tenureRanges: Record<number, [number, number]> = { 1: [4, 6], 2: [5, 9], 3: [22, 30], 4: [28, 40], 5: [36, 54] };
  const gapRanges: Record<number, [number, number]> = { 1: [2, 7], 2: [1, 6], 3: [0, 3], 4: [0, 2], 5: [0, 1] };
  const spanRanges: Record<number, [number, number]> = {
    1: [12, 30], 2: [30, 54], 3: [60, 96], 4: [96, 144], 5: [144, 204],
  };

  const count = roleCounts[experienceLevel];
  const [tMin, tMax] = tenureRanges[progressionLevel];
  const [gMin, gMax] = gapRanges[progressionLevel];
  const [sMin, sMax] = spanRanges[experienceLevel];

  let tenures = Array.from({ length: count }, () => randInt(rng, tMin, tMax));
  const rawSpan = tenures.reduce((a, b) => a + b, 0);
  const scale = randInt(rng, sMin, sMax) / rawSpan;
  tenures = tenures.map((t) => Math.max(3, Math.round(t * scale)));
  const gaps = Array.from({ length: count - 1 }, () => randInt(rng, gMin, gMax));

  const roles: Array<{ startMonth: number; endMonth: number }> = [];
  let prevEnd = NOW_MONTH;
  for (let r = count - 1; r >= 0; r--) {
    const endMonth = prevEnd;
    const startMonth = endMonth - tenures[r];
    roles.unshift({ startMonth, endMonth });
    if (r > 0) prevEnd = startMonth - gaps[r - 1];
  }
  const careerStartMonth = roles[0].startMonth;
  const gradMonth = careerStartMonth - randInt(rng, 6, 18);
  return { careerStartMonth, gradYear: Math.floor(gradMonth / MONTHS_PER_YEAR), roles };
}

function titleIndexForRole(progressionLevel: number, role: number, count: number): number {
  if (progressionLevel === 1) return 0;
  const maxStep = Math.min(progressionLevel - 1, 4);
  return count === 1 ? 0 : Math.min(maxStep, Math.floor((role * maxStep) / (count - 1)));
}

function companyForDomainLevel(
  experienceLevel: number,
  domainLevel: number,
  archetype: ArchetypeDef,
  used: Set<string>,
  rng: () => number,
): string {
  // L1 (no career depth) → unrelated retail/gig employers; domain ≤ 2 →
  // generic industry firms; otherwise the archetype's own companies.
  const pool =
    experienceLevel === 1 ? UNRELATED_COMPANIES : domainLevel <= 2 ? GENERIC_INDUSTRY_COMPANIES : archetype.companies;
  const fresh = pool.filter((c) => !used.has(c));
  const company = pick(rng, fresh.length > 0 ? fresh : pool);
  used.add(company);
  return company;
}

function jitterDims(tier: Tier, rng: () => number): Record<DimId, number> {
  const base = TIER_VECTORS[tier];
  const dims = Object.fromEntries(DIM_IDS.map((id, i) => [id, base[i]])) as Record<DimId, number>;
  const jitterCount = rng() < 0.5 ? 1 : 2;
  const indices = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, jitterCount);
  for (const idx of indices) {
    const delta = rng() < 0.5 ? -1 : 1;
    const next = Math.min(5, Math.max(1, base[idx] + delta));
    dims[DIM_IDS[idx]] = next;
  }
  return dims;
}

function buildProfile(
  index: number,
  tier: Tier,
  archetypeId: ArchetypeId,
  language: Language,
  dims: Record<DimId, number>,
  rng: () => number,
): CohortProfile {
  const archetype = ARCHETYPES[archetypeId];
  const name = NAMES[index % NAMES.length];
  const usedCompanies = new Set<string>();
  const timeline = buildTimeline(dims.experience_depth, dims.progression, rng);

  const skills = archetype.skillsByLevel[Math.max(0, dims.hard_skills - 1)];
  const highlights = archetype.highlightsByLevel[Math.max(0, dims.hard_skills - 1)];

  const roles = timeline.roles.map((slot, r) => {
    // L1 (no career depth) gets unrelated retail/gig titles; everyone else
    // walks the archetype title ladder.
    const title =
      dims.experience_depth === 1 && dims.progression === 1
        ? pick(rng, UNRELATED_TITLES)
        : archetype.titles[titleIndexForRole(dims.progression, r, timeline.roles.length)];
    return {
      title,
      company: companyForDomainLevel(dims.experience_depth, dims.domain_context, archetype, usedCompanies, rng),
      location: pick(rng, archetype.locations),
      start: formatMonth(slot.startMonth),
      end: formatMonth(slot.endMonth),
      highlights: [...highlights],
    };
  });

  const educationList = archetype.educationByLevel[Math.max(0, dims.credentials - 1)];
  const certifications = archetype.certsByLevel[Math.max(0, dims.credentials - 1)];

  const totalYears = Math.round((NOW_MONTH - timeline.careerStartMonth) / MONTHS_PER_YEAR);
  // Summary achievement fragments are anchored to the tier (the summary is
  // the overall tier statement); skills/highlights follow the dimension jitter.
  const achievementPool = archetype.achievementsByLevel[language][TIER_INDEX[tier]];
  const summary = SUMMARIES[language][tier]
    .replaceAll("{role}", archetype.titles[titleIndexForRole(dims.progression, timeline.roles.length - 1, timeline.roles.length)])
    .replaceAll("{years}", String(totalYears))
    .replaceAll("{skills}", skills.slice(0, 2).join(", "))
    .replaceAll("{domain}", archetype.industry[Math.max(0, dims.domain_context - 1)])
    .replaceAll("{industry}", archetype.industry[Math.max(0, dims.domain_context - 1)])
    .replaceAll("{achievement}", achievementPool[0] ?? "")
    .replaceAll("{achievement2}", achievementPool[1] ?? achievementPool[0] ?? "");

  const englishLevel = ENGLISH_LEVEL_BY_CREDENTIALS[Math.max(0, dims.credentials - 1)];

  const profile: CohortProfile = {
    profileResumeId: `my-${String(index + 1).padStart(3, "0")}`,
    board: "MY",
    language,
    archetype: archetypeId,
    personal: {
      name,
      email: emailFromName(name),
      phone: `+60 1${randInt(rng, 0, 9)}-${randInt(rng, 100, 999)} ${randInt(rng, 1000, 9999)}`,
      location: pick(rng, archetype.locations),
    },
    summary,
    skills,
    experience: roles,
    languages: [
      { language: "Bahasa Malaysia", level: "Native" },
      { language: "English", level: englishLevel },
    ],
  };
  if (educationList.length > 0) {
    profile.education = educationList.map((entry) => {
      const [degree, school] = entry.split(" — ");
      return { degree: school ? `${degree} — ${school}` : degree, year: timeline.gradYear };
    });
  }
  if (certifications.length > 0) profile.certifications = certifications;
  return profile;
}

/** Generate the full cohort. Deterministic for a given seed. */
export function generateCohort(opts: { seed?: number; n?: number } = {}): CohortOutput {
  const seed = opts.seed ?? 20260819;
  const n = opts.n ?? 35;
  const rng = mulberry32(seed);

  const tiers: Tier[] = [];
  for (const tier of Object.keys(STRATIFICATION) as Tier[]) {
    for (let i = 0; i < STRATIFICATION[tier]; i++) tiers.push(tier);
  }
  while (tiers.length < n) tiers.push("L3");
  const tierSeq = shuffle(rng, tiers.slice(0, n));

  const archetypeSeq = shuffle(rng, Array.from({ length: n }, (_, i) => ARCHETYPE_IDS[i % ARCHETYPE_IDS.length]));

  const profiles: CohortProfile[] = [];
  const targets: Record<string, CohortTarget> = {};
  for (let i = 0; i < n; i++) {
    const tier = tierSeq[i];
    const dims = jitterDims(tier, rng);
    const language: Language = rng() < 0.5 ? "en" : "ms";
    const profile = buildProfile(i, tier, archetypeSeq[i], language, dims, rng);
    profiles.push(profile);
    targets[profile.profileResumeId] = { tier, overall: TIER_RATING[tier], dims };
  }

  const csvRows = [
    "profileResumeId,board,rating,score",
    ...profiles.map((p) => `${p.profileResumeId},MY,${targets[p.profileResumeId].overall},`),
  ];
  return { profiles, targets, csvRows };
}

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

/** Concatenation of every string that can appear in a generated resume — used by the label-leakage guard. */
export function allTemplateText(): string {
  const parts: string[] = [];
  for (const a of Object.values(ARCHETYPES)) {
    parts.push(a.label, ...a.locations, ...a.titles, ...a.companies, ...a.industry);
    for (const lvl of a.skillsByLevel) parts.push(...lvl);
    for (const lvl of a.highlightsByLevel) parts.push(...lvl);
    for (const lvl of a.educationByLevel) parts.push(...lvl);
    for (const lvl of a.certsByLevel) parts.push(...lvl);
    for (const lang of ["en", "ms"] as const) {
      for (const lvl of a.achievementsByLevel[lang]) parts.push(...lvl);
    }
  }
  parts.push(...UNRELATED_TITLES, ...UNRELATED_COMPANIES, ...GENERIC_INDUSTRY_COMPANIES);
  parts.push(...Object.values(SUMMARIES.en), ...Object.values(SUMMARIES.ms));
  parts.push(...NAMES, ...ENGLISH_LEVEL_BY_CREDENTIALS);
  return parts.join("\n").toLowerCase();
}

// CLI entry: bun run scripts/generate-my-cohort.ts [--seed N] [--out DIR]
if (process.argv[1]?.endsWith("generate-my-cohort.ts")) {
  const args = process.argv.slice(2);
  const seedArg = args.indexOf("--seed");
  const outArg = args.indexOf("--out");
  const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : 20260819;
  const outDir = outArg >= 0 ? args[outArg + 1] : "tmp/my-cohort";
  const { profiles, targets, csvRows } = generateCohort({ seed });
  mkdirSync(join(outDir, "resumes"), { recursive: true });
  for (const p of profiles) {
    writeFileSync(join(outDir, "resumes", `${p.profileResumeId}.json`), JSON.stringify(p, null, 2) + "\n");
  }
  writeFileSync(join(outDir, "targets.json"), JSON.stringify({ _meta: { seed, n: profiles.length, stratification: STRATIFICATION }, targets }, null, 2) + "\n");
  writeFileSync(join(outDir, "cohort.csv"), csvRows.join("\n") + "\n");
  console.log(`Wrote ${profiles.length} resumes to ${outDir}/ (seed ${seed})`);
}
