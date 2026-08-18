/**
 * t6 fixture submit: insert one resume carrying companyHits via the same
 * Convex HTTP mutation path the BFF extension sync uses (resume_tasks:submitResumes).
 * No write-secret guard; only a maintenance-mode quiesce check.
 */
const convexUrl = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";

async function main() {
  const res = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "resume_tasks:submitResumes",
      args: {
        resumes: [
          {
            externalId: "fixture.polywell.override-verify-001",
            content: {
              name: "T6 Fixture User",
              selfIntro: "Fixture resume for candidate policy override verification.",
              workHistory: [
                {
                  companyName: "Polywell",
                  jobTitle: "CNC技师",
                  startDate: "2021-01",
                  endDate: "2023-06",
                },
              ],
            },
            hash: "t6-fixture-hash-001",
            source: "manual-fixture",
            tags: [],
            restoreState: {
              primaryRuleScore: 99,
              ingestData: {
                market: "cn",
                evidenceText: "t6 fixture",
                industryTags: ["机械"],
                synonymHits: [],
                companyHits: ["polywell", "pro-technic-machinery"],
                ruleScores: {},
                experienceLevel: "unknown",
                computedAt: Date.now(),
                skillsVersion: 1,
              },
            },
          },
        ],
      },
    }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
