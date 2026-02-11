import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ResumeIndexService } from "./resume-index";
import { resolveResumeId } from "./resume-utils";

import type { ResumeItem, ResumeSampleFile } from "../types/resume";

const createFixtureRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-index-"));
  const resumeConfigDir = path.join(root, "config", "resume");
  fs.mkdirSync(resumeConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(resumeConfigDir, "skills_words.txt"),
    [
      "# machining",
      "cnc lathe",
      "",
    ].join("\n"),
    "utf8"
  );
  return root;
};

const cleanupFixtureRoot = (root: string): void => {
  fs.rmSync(root, { recursive: true, force: true });
};

describe("ResumeIndexService", () => {
  it("extracts structured fields from resumes", () => {
    const root = createFixtureRoot();
    try {
      const items: ResumeItem[] = [
        {
          name: "张三",
          profileUrl: "",
          activityStatus: "",
          age: "28",
          experience: "3年",
          education: "本科",
          location: "广东省-东莞",
          selfIntro: "熟悉CNC设备销售",
          jobIntention: "CNC 车床 销售",
          expectedSalary: "8000-15000/月",
          workHistory: [
            { raw: "2021-03 ~ 2023-08 STAR机床 - 销售工程师" },
          ],
          extractedAt: "2026-02-03T10:00:00.000Z",
        },
      ];

      const sample: ResumeSampleFile = {
        name: "fixture",
        filename: "fixture.json",
        updatedAt: "2026-02-03T10:00:00.000Z",
        size: 1,
      };

      const service = new ResumeIndexService(root);
      service.indexSample({ items, sample });

      const id = resolveResumeId(items[0], 0);
      const index = service.get(id);

      expect(index).toBeDefined();
      expect(index?.resumeId).toBe(id);
      expect(index?.experienceYears).toBe(3);
      expect(index?.educationLevel).toBe("bachelor");
      expect(index?.locationCity).toBe("东莞");
      expect(index?.skills).toContain("CNC");
      expect(index?.companies.length).toBeGreaterThan(0);
      expect(index?.industryTags).toContain("machining");
      expect(index?.salaryRange?.min).toBe(8000);
      expect(index?.salaryRange?.max).toBe(15000);
      expect(index?.searchText).toContain("cnc");
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});

