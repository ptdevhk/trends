import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseCliOptions,
  readCsvRows,
  readExtensionJsonArtifact,
  mapExtensionJsonToDocuments,
  mapCsvRowsToDocuments,
  isProductionConvexUrl,
  assertSafeNonProductionTarget,
} from "./batch-import-csv-resumes.js";
import {
  extractLocationString,
  extractEducationString,
  resolveRowExternalId,
  normalizeExtensionWorkHistory,
} from "./lib/extension-resume-mapping.js";

describe("batch-import-csv-resumes & extension-json import", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "batch-import-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("CLI parsing", () => {
    it("defaults to csv format and dryRun=true", () => {
      const opts = parseCliOptions(["data.csv"]);
      expect(opts.filePath).toBe("data.csv");
      expect(opts.format).toBe("csv");
      expect(opts.dryRun).toBe(true);
    });

    it("parses --format=extension-json and --no-dry-run", () => {
      const opts = parseCliOptions(["artifact.json", "--format=extension-json", "--no-dry-run"]);
      expect(opts.filePath).toBe("artifact.json");
      expect(opts.format).toBe("extension-json");
      expect(opts.dryRun).toBe(false);
    });

    it("throws for unknown format", () => {
      expect(() => parseCliOptions(["file.txt", "--format=unknown"])).toThrow(/Unsupported --format/);
    });
  });

  describe("extension-json parsing and validation", () => {
    it("parses valid artifact with metadata.resumes shape", () => {
      const filePath = join(tempDir, "artifact.json");
      const data = {
        metadata: {
          sourceKey: "seek",
          searchProfileId: "th-sales-001",
        },
        resumes: [
          {
            profileId: "TH-TEST-001",
            name: "TH-TEST-NAME-1",
            location: { name: "Bangkok, Thailand" },
            education: { level: "Bachelor Degree" },
            workHistory: [
              {
                raw: "Jan 2020 - Present Senior CNC Sales (4 years)",
                companyName: "Acme Industrial Tools",
                jobTitle: "Senior CNC Sales",
                description: "Sales of 5-axis machining equipment",
                durationLabel: "4 years",
              },
            ],
          },
        ],
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

      const parsed = readExtensionJsonArtifact(filePath);
      expect(parsed.resumes.length).toBe(1);
      expect(parsed.resumes[0].name).toBe("TH-TEST-NAME-1");
    });

    it("parses top-level array of resumes", () => {
      const filePath = join(tempDir, "array.json");
      const data = [
        {
          externalId: "TH-TEST-EXT-002",
          name: "TH-TEST-NAME-2",
        },
      ];
      writeFileSync(filePath, JSON.stringify(data), "utf-8");

      const parsed = readExtensionJsonArtifact(filePath);
      expect(parsed.resumes.length).toBe(1);
      expect(parsed.resumes[0].externalId).toBe("TH-TEST-EXT-002");
    });

    it("throws if file has no resumes or is empty", () => {
      const filePath = join(tempDir, "empty.json");
      writeFileSync(filePath, JSON.stringify({ metadata: {}, resumes: [] }), "utf-8");
      expect(() => readExtensionJsonArtifact(filePath)).toThrow(/no resume rows found/);
    });

    it("throws if file contains invalid JSON", () => {
      const filePath = join(tempDir, "corrupted.json");
      writeFileSync(filePath, "{ bad json", "utf-8");
      expect(() => readExtensionJsonArtifact(filePath)).toThrow(/Failed to parse JSON file/);
    });
  });

  describe("externalId fallback chain and helpers", () => {
    it("prefers explicit externalId", () => {
      const id = resolveRowExternalId({
        externalId: "EXT-EXPLICIT",
        profileId: "PID-123",
        seekProfileGuid: "GUID-456",
      });
      expect(id).toBe("EXT-EXPLICIT");
    });

    it("falls back to profileId when externalId is absent", () => {
      const id = resolveRowExternalId({
        profileId: "PID-123",
        seekProfileGuid: "GUID-456",
      });
      expect(id).toBe("PID-123");
    });

    it("falls back to seekProfileGuid when externalId and profileId are absent", () => {
      const id = resolveRowExternalId({
        seekProfileGuid: "GUID-456",
      });
      expect(id).toBe("GUID-456");
    });

    it("returns empty string if all id candidates are absent", () => {
      const id = resolveRowExternalId({ name: "TH-TEST-000" });
      expect(id).toBe("");
    });
  });

  describe("location and education extraction", () => {
    it("extracts location from string or object", () => {
      expect(extractLocationString("Selangor, Malaysia")).toBe("Selangor, Malaysia");
      expect(extractLocationString({ name: "Kuala Lumpur" })).toBe("Kuala Lumpur");
      expect(extractLocationString(undefined)).toBe("");
    });

    it("extracts education from string or object (level preferred over name)", () => {
      expect(extractEducationString("Bachelor of Engineering")).toBe("Bachelor of Engineering");
      expect(extractEducationString({ level: "Degree", name: "Mechanical Engineering" })).toBe("Degree");
      expect(extractEducationString({ name: "High School Diploma" })).toBe("High School Diploma");
      expect(extractEducationString(null)).toBe("");
    });
  });

  describe("workHistory mapping", () => {
    it("preserves array of structured workHistory entries with all fields verbatim", () => {
      const rawEntries = [
        {
          raw: "Mar 2021 - Present (3 years)",
          companyName: "Apex Tooling Sdn Bhd",
          jobTitle: "Technical Sales Engineer",
          description: "Responsible for machine tool sales across ASEAN region",
          durationLabel: "3 years",
          startDate: "2021-03",
          endDate: "present",
        },
      ];

      const normalized = normalizeExtensionWorkHistory(rawEntries) as Record<string, unknown>[];
      expect(Array.isArray(normalized)).toBe(true);
      expect(normalized.length).toBe(1);
      expect(normalized[0]).toEqual({
        raw: "Mar 2021 - Present (3 years)",
        companyName: "Apex Tooling Sdn Bhd",
        jobTitle: "Technical Sales Engineer",
        description: "Responsible for machine tool sales across ASEAN region",
        durationLabel: "3 years",
        startDate: "2021-03",
        endDate: "present",
      });
    });

    it("handles string workHistory gracefully", () => {
      const text = "5 years CNC operator at Precision Co";
      expect(normalizeExtensionWorkHistory(text)).toBe(text);
    });
  });

  describe("deduplication and document creation", () => {
    it("skips duplicate externalIds within the input artifact and records them", () => {
      const artifact = {
        metadata: {
          sourceKey: "seek",
          searchProfileId: "sp-cnc-my",
        },
        resumes: [
          {
            profileId: "TH-DUP-001",
            name: "TH-CANDIDATE-A",
            location: "Penang",
          },
          {
            profileId: "TH-DUP-001", // Duplicate
            name: "TH-CANDIDATE-A-DUPLICATE",
            location: "Penang",
          },
          {
            profileId: "TH-DUP-002",
            name: "TH-CANDIDATE-B",
            location: "Johor",
          },
        ],
      };

      const result = mapExtensionJsonToDocuments(artifact);
      expect(result.documents.length).toBe(2);
      expect(result.skippedDuplicates).toEqual(["TH-DUP-001"]);
      expect(result.documents[0].externalId).toBe("TH-DUP-001");
      expect(result.documents[0].content.name).toBe("TH-CANDIDATE-A");
      expect(result.documents[1].externalId).toBe("TH-DUP-002");
      expect(result.documents[0].tags).toEqual(["sp-cnc-my", "extension-import"]);
      expect(result.documents[0].source).toBe("seek");
    });
  });

  describe("prod guard protection", () => {
    it("identifies production CONVEX_URL patterns", () => {
      expect(isProductionConvexUrl("https://trends.pt-mes.com")).toBe(true);
      expect(isProductionConvexUrl("https://pt-mes.com/convex")).toBe(true);
      expect(isProductionConvexUrl("https://prod.pt-mes.com")).toBe(true);
      expect(isProductionConvexUrl("http://pt-mes:3210")).toBe(true);

      // Non-prod URLs
      expect(isProductionConvexUrl("http://127.0.0.1:3210")).toBe(false);
      expect(isProductionConvexUrl("http://localhost:3210")).toBe(false);
      expect(isProductionConvexUrl("https://preview.pt-mes.com/convex")).toBe(false);
      expect(isProductionConvexUrl("https://preview.pt-mes.com")).toBe(false);
    });

    it("assertSafeNonProductionTarget throws when CONVEX_URL is empty or undefined", () => {
      expect(() => assertSafeNonProductionTarget(undefined)).toThrow(/PROD GUARD REFUSAL/);
      expect(() => assertSafeNonProductionTarget("")).toThrow(/PROD GUARD REFUSAL/);
    });

    it("assertSafeNonProductionTarget throws when CONVEX_URL is a production target", () => {
      expect(() => assertSafeNonProductionTarget("https://trends.pt-mes.com/convex")).toThrow(
        /PROD GUARD REFUSAL: CONVEX_URL 'https:\/\/trends\.pt-mes\.com\/convex' matches production target/,
      );
      expect(() => assertSafeNonProductionTarget("https://pt-mes.com")).toThrow(
        /PROD GUARD REFUSAL/,
      );
    });

    it("assertSafeNonProductionTarget succeeds for local dev or preview endpoints", () => {
      expect(() => assertSafeNonProductionTarget("http://127.0.0.1:3210")).not.toThrow();
      expect(() => assertSafeNonProductionTarget("https://preview.pt-mes.com/convex")).not.toThrow();
    });
  });
});
