/**
 * Integration tests using convex-test for audit.ts and lib/bias_metrics.ts.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { internal } from "../_generated/api.js";
import schema from "../schema.js";
import {
    computeDemographicParity,
    computeEqualizedOdds,
    computeDisparateImpactRatio,
    ageToBracket,
    fnvHash,
} from "../lib/bias_metrics.js";
import { computeProtectedAttributeHashes } from "../audit.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// Convex integration tests
// ---------------------------------------------------------------------------

describe("audit (convex-test)", () => {
  describe("logAnalysisDecision (internal)", () => {
    it("creates an audit log entry", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "audit-r1",
          content: {},
          hash: "audit1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Audit test resume",
        });
      });

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-audit",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {
          jobDescriptionId: "jd-1",
          scrubbedFields: ["age", "gender"],
        },
        modelMeta: {
          model: "gpt-4-turbo",
          provider: "openai",
          promptTokens: 500,
          completionTokens: 200,
          latencyMs: 1500,
        },
        output: {
          score: 78,
          recommendation: "match",
        },
        protectedAttributeHashes: {
          ageBracketHash: fnvHash(ageToBracket(32)),
          sourceHash: fnvHash("test"),
        },
        explanation: {
          summary: "Candidate scored 78/100 against CNC Operator role.",
          keyFactors: [
            { factor: "relevant_experience", weight: 0.4, value: "7 years in CNC machining" },
            { factor: "skill_alignment", weight: 0.3, value: "4 of 5 required skills matched" },
          ],
        },
        decidedAt: Date.now(),
      });

      // Verify the audit log was created
      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].workspaceSlug).toBe("ws-audit");
      expect(logs[0].decisionType).toBe("score");
      expect(logs[0].outcome).toBe("pending");
      expect(logs[0].inputSnapshot.scrubbedFields).toEqual(["age", "gender"]);
      expect(logs[0].output.score).toBe(78);
      expect(logs[0].expiresAt).toBeGreaterThan(logs[0].decidedAt);
    });
  });

  describe("getExplanationForCandidate", () => {
    it("returns explanation for a scored resume", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "explain-r1",
          content: {},
          hash: "explain1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-explain",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: { scrubbedFields: ["age"] },
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 85, recommendation: "strong_match" },
          explanation: {
            summary: "Strong candidate with 10 years experience.",
            keyFactors: [
              { factor: "experience", weight: 0.6, value: "10 years" },
              { factor: "education", weight: 0.2, value: "Master's degree" },
            ],
            modelReasoning: "Internal reasoning text",
          },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      const result = await t.query(api.audit.getExplanationForCandidate, {
        resumeId,
        workspaceSlug: "ws-explain",
      });

      expect(result).not.toBeNull();
      expect(result!.summary).toBe("Strong candidate with 10 years experience.");
      expect(result!.keyFactors.length).toBe(2);
      // weight should NOT be exposed to candidates
      expect(result!.keyFactors[0]).not.toHaveProperty("weight");
      expect(result!.scrubbedFields).toEqual(["age"]);
      expect(result!.protectedAttributesExcluded).toBe(true);
    });

    it("returns null when no explanation exists", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "no-explain-r1",
          content: {},
          hash: "noexp1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const result = await t.query(api.audit.getExplanationForCandidate, {
        resumeId,
        workspaceSlug: "ws-noexplain",
      });

      expect(result).toBeNull();
    });
  });

  describe("getAuditLogByWorkspace", () => {
    it("returns audit logs filtered by decisionType", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "filter-r1",
          content: {},
          hash: "filter1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-filter",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 90 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-filter",
          decisionType: "tag",
          actionRef: "ai_tagging_results:tagResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { tags: ["senior"] },
          outcome: "pending",
          decidedAt: now + 1000,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      const scoreLogs = await t.query(api.audit.getAuditLogByWorkspace, {
        workspaceSlug: "ws-filter",
        decisionType: "score",
      });
      expect(scoreLogs.length).toBe(1);
      expect(scoreLogs[0].decisionType).toBe("score");

      const allLogs = await t.query(api.audit.getAuditLogByWorkspace, {
        workspaceSlug: "ws-filter",
      });
      expect(allLogs.length).toBe(2);
    });
  });

  describe("confirm audit log (decisionType: confirm)", () => {
    it("creates a confirm audit log entry via logAnalysisDecision", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "confirm-r1",
          content: { age: 30, gender: "M", name: "Test", skills: ["CNC"] },
          hash: "confirm1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Confirm test resume",
        });
      });

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-confirm",
        decisionType: "confirm",
        actionRef: "analyze:confirmSearchResults",
        inputSnapshot: {
          searchKeywords: ["CNC operator"],
          scrubbedFields: ["age"],
        },
        modelMeta: {
          model: "gpt-4-turbo",
          provider: "openai",
          latencyMs: 800,
        },
        output: {
          score: 82,
          recommendation: "match",
        },
        protectedAttributeHashes: {
          sourceHash: fnvHash("test"),
        },
        explanation: {
          summary: "Confirmed score 82/100 for query \"CNC operator\".",
          keyFactors: [
            { factor: "skill_alignment", weight: 0.5, value: "5 years CNC experience" },
          ],
        },
        decidedAt: Date.now(),
      });

      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].decisionType).toBe("confirm");
      expect(logs[0].actionRef).toBe("analyze:confirmSearchResults");
      expect(logs[0].inputSnapshot.searchKeywords).toEqual(["CNC operator"]);
      expect(logs[0].output.score).toBe(82);
      expect(logs[0].explanation?.summary).toContain("Confirmed score 82");
      expect(logs[0].explanation?.keyFactors.length).toBe(1);
    });

    it("captures scrubbedFields and protectedAttributeHashes from resume content", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "confirm-scrub-r1",
          content: { age: 28, gender: "F", name: "Jane", skills: ["Python"] },
          hash: "scrub1",
          tags: [],
          crawledAt: Date.now(),
          source: "51job",
          searchText: "Scrub test",
        });
      });

      const protectedHashes = {
        ageBracketHash: fnvHash(ageToBracket(28)),
        genderHash: fnvHash("F"),
        sourceHash: fnvHash("51job"),
      };

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-scrub",
        decisionType: "confirm",
        actionRef: "analyze:confirmSearchResults",
        inputSnapshot: {
          searchKeywords: ["Python developer"],
          scrubbedFields: ["age", "gender"],
        },
        modelMeta: {
          model: "gpt-4-turbo",
          provider: "openai",
        },
        output: {
          score: 90,
          recommendation: "strong_match",
        },
        protectedAttributeHashes: protectedHashes,
        explanation: {
          summary: "Confirmed score 90/100 for query \"Python developer\".",
          keyFactors: [
            { factor: "skill_alignment", value: "3 years Python" },
          ],
        },
        decidedAt: Date.now(),
      });

      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].inputSnapshot.scrubbedFields).toEqual(["age", "gender"]);
      expect(logs[0].protectedAttributeHashes?.ageBracketHash).toBe(protectedHashes.ageBracketHash);
      expect(logs[0].protectedAttributeHashes?.genderHash).toBe(protectedHashes.genderHash);
      expect(logs[0].protectedAttributeHashes?.sourceHash).toBe(protectedHashes.sourceHash);
    });

    it("filters confirm logs by decisionType via getAuditLogByWorkspace", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "confirm-filter-r1",
          content: {},
          hash: "cfilter1",
          searchText: "Filter test",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-cfilter",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 75 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-cfilter",
          decisionType: "confirm",
          actionRef: "analyze:confirmSearchResults",
          inputSnapshot: { searchKeywords: ["sales"] },
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 85, recommendation: "strong_match" },
          outcome: "pending",
          decidedAt: now + 1000,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      const confirmLogs = await t.query(api.audit.getAuditLogByWorkspace, {
        workspaceSlug: "ws-cfilter",
        decisionType: "confirm",
      });
      expect(confirmLogs.length).toBe(1);
      expect(confirmLogs[0].decisionType).toBe("confirm");

      const allLogs = await t.query(api.audit.getAuditLogByWorkspace, {
        workspaceSlug: "ws-cfilter",
      });
      expect(allLogs.length).toBe(2);
    });
  });

  describe("actor identity in audit trail (EU AI Act Art. 12)", () => {
    it("logs actorId and actorRole when provided", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "actor-r1",
          content: {},
          hash: "actor1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Actor test resume",
        });
      });

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-actor",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4-turbo", provider: "openai" },
        output: { score: 75 },
        decidedAt: Date.now(),
        actorId: "system",
        actorRole: "system",
      });

      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].actorId).toBe("system");
      expect(logs[0].actorRole).toBe("system");
    });

    it("logs admin actor identity", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "actor-admin-r1",
          content: {},
          hash: "actor-admin1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-actor-admin",
        decisionType: "score",
        actionRef: "analyze:analyzeResume",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 88 },
        decidedAt: Date.now(),
        actorId: "user_abc123",
        actorRole: "admin",
      });

      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].actorId).toBe("user_abc123");
      expect(logs[0].actorRole).toBe("admin");
    });

    it("allows optional actor identity (backward compatible)", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "actor-opt-r1",
          content: {},
          hash: "actor-opt1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-actor-opt",
        decisionType: "tag",
        actionRef: "ai_tagging_results:drainQueue",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { tags: ["senior"] },
        decidedAt: Date.now(),
        // No actorId/actorRole — backward compatible
      });

      const logs = await t.run(async (ctx) => {
        return ctx.db
          .query("analysis_audit_log")
          .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
          .collect();
      });

      expect(logs.length).toBe(1);
      expect(logs[0].actorId).toBeUndefined();
      expect(logs[0].actorRole).toBeUndefined();
    });

    it("rejects invalid actorRole values", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "actor-invalid-r1",
          content: {},
          hash: "actor-inv1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      await expect(
        t.mutation(internal.audit.logAnalysisDecision, {
          resumeId,
          workspaceSlug: "ws-actor-invalid",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 50 },
          decidedAt: Date.now(),
          actorId: "user_x",
          actorRole: "superadmin" as any, // Invalid — not in union
        }),
      ).rejects.toThrow();
    });
  });

  describe("setAuditOutcome", () => {
    it("sets outcome to accepted on an audit log entry", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "outcome-r1",
          content: {},
          hash: "outcome1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      const logId = await t.run(async (ctx) => {
        return ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-outcome",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 85 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      await t.mutation(api.audit.setAuditOutcome, {
        auditLogId: logId,
        outcome: "accepted",
        setBy: "admin_abc",
      });

      const log = await t.run(async (ctx) => ctx.db.get(logId));
      expect(log!.outcome).toBe("accepted");
      expect(log!.outcomeSetBy).toBe("admin_abc");
      expect(log!.outcomeSetAt).toBeDefined();
      expect(log!.reviewedAt).toBeDefined();
    });

    it("sets outcome to overridden", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "override-r1",
          content: {},
          hash: "override1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      const logId = await t.run(async (ctx) => {
        return ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-override",
          decisionType: "confirm",
          actionRef: "analyze:confirmSearchResults",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 60 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      await t.mutation(api.audit.setAuditOutcome, {
        auditLogId: logId,
        outcome: "overridden",
        setBy: "operator_xyz",
      });

      const log = await t.run(async (ctx) => ctx.db.get(logId));
      expect(log!.outcome).toBe("overridden");
      expect(log!.outcomeSetBy).toBe("operator_xyz");
    });

    it("sets outcome to appealed", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "appeal-r1",
          content: {},
          hash: "appeal1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      const logId = await t.run(async (ctx) => {
        return ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-appeal",
          decisionType: "filter",
          actionRef: "analyze:filterResumes",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 40 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      await t.mutation(api.audit.setAuditOutcome, {
        auditLogId: logId,
        outcome: "appealed",
      });

      const log = await t.run(async (ctx) => ctx.db.get(logId));
      expect(log!.outcome).toBe("appealed");
      expect(log!.outcomeSetBy).toBeUndefined();
    });
  });

  describe("computeProtectedAttributeHashes (unit)", () => {
    it("hashes all provided attributes", () => {
      const hashes = computeProtectedAttributeHashes({
        age: 32,
        gender: "F",
        location: "Shanghai",
        source: "51job",
      });
      expect(hashes.ageBracketHash).toBe(fnvHash(ageToBracket(32)));
      expect(hashes.genderHash).toBe(fnvHash("F"));
      expect(hashes.locationHash).toBe(fnvHash("Shanghai"));
      expect(hashes.sourceHash).toBe(fnvHash("51job"));
    });

    it("returns undefined for missing attributes", () => {
      const hashes = computeProtectedAttributeHashes({});
      expect(hashes.ageBracketHash).toBeUndefined();
      expect(hashes.genderHash).toBeUndefined();
      expect(hashes.locationHash).toBeUndefined();
      expect(hashes.sourceHash).toBeUndefined();
    });

    it("hashes age by bracket, not exact age", () => {
      const hash30 = computeProtectedAttributeHashes({ age: 30 });
      const hash32 = computeProtectedAttributeHashes({ age: 32 });
      // Both ages 30 and 32 fall in bracket "30-34"
      expect(hash30.ageBracketHash).toBe(hash32.ageBracketHash);
    });
  });

  describe("getExplanationForCandidate — workspace isolation", () => {
    it("does not return explanation from another workspace", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "iso-r1",
          content: {},
          hash: "iso1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-iso-a",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 90 },
          explanation: {
            summary: "Workspace A explanation",
            keyFactors: [{ factor: "experience", value: "10 years" }],
          },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      // Query with a different workspace slug
      const result = await t.query(api.audit.getExplanationForCandidate, {
        resumeId,
        workspaceSlug: "ws-iso-b",
      });

      expect(result).toBeNull();
    });
  });

  describe("listWorkspaceSlugsWithAuditLogs", () => {
    it("returns distinct workspace slugs from audit logs", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "slug-r1",
          content: {},
          hash: "slug1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-alpha",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 80 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-beta",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 85 },
          outcome: "pending",
          decidedAt: now + 1000,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
        // Same workspace slug — should be deduplicated
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-alpha",
          decisionType: "tag",
          actionRef: "ai_tagging_results:tagResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { tags: ["lead"] },
          outcome: "pending",
          decidedAt: now + 2000,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      const slugs = await t.query(internal.bias_audit.listWorkspaceSlugsWithAuditLogs, {});
      expect(slugs.sort()).toEqual(["ws-alpha", "ws-beta"]);
    });

    it("returns empty array when no audit logs exist", async () => {
      const t = convexTest(schema, modules);
      const slugs = await t.query(internal.bias_audit.listWorkspaceSlugsWithAuditLogs, {});
      expect(slugs).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for bias_metrics.ts (pure functions, no Convex needed)
// ---------------------------------------------------------------------------

describe("bias_metrics (unit)", () => {
  describe("computeDemographicParity", () => {
    it("passes when groups have similar selection rates", () => {
      const groups = [
        { groupKey: "age_25-29", total: 100, positive: 40, avgScore: 70, scoreStdDev: 10 },
        { groupKey: "age_30-34", total: 100, positive: 45, avgScore: 72, scoreStdDev: 9 },
        { groupKey: "age_35-39", total: 100, positive: 38, avgScore: 68, scoreStdDev: 11 },
      ];
      const result = computeDemographicParity(groups);
      expect(result.passing).toBe(true);
      expect(result.disparityRatio).toBeGreaterThanOrEqual(0.8);
    });

    it("fails when one group has significantly lower selection rate", () => {
      const groups = [
        { groupKey: "age_25-29", total: 100, positive: 50, avgScore: 75, scoreStdDev: 10 },
        { groupKey: "age_50_plus", total: 100, positive: 10, avgScore: 50, scoreStdDev: 15 },
      ];
      const result = computeDemographicParity(groups);
      expect(result.passing).toBe(false);
      expect(result.disparityRatio).toBeLessThan(0.8);
    });
  });

  describe("computeEqualizedOdds", () => {
    it("passes when TPR and FPR are similar across groups", () => {
      const groups = [
        { groupKey: "g1", truePositives: 45, falsePositives: 5, trueNegatives: 45, falseNegatives: 5 },
        { groupKey: "g2", truePositives: 43, falsePositives: 7, trueNegatives: 43, falseNegatives: 7 },
      ];
      const result = computeEqualizedOdds(groups);
      expect(result.passing).toBe(true);
      expect(result.tprDifference).toBeLessThanOrEqual(0.1);
      expect(result.fprDifference).toBeLessThanOrEqual(0.1);
    });

    it("fails when TPR differs significantly", () => {
      const groups = [
        { groupKey: "g1", truePositives: 90, falsePositives: 5, trueNegatives: 90, falseNegatives: 10 },
        { groupKey: "g2", truePositives: 50, falsePositives: 5, trueNegatives: 90, falseNegatives: 50 },
      ];
      const result = computeEqualizedOdds(groups);
      expect(result.passing).toBe(false);
    });
  });

  describe("computeDisparateImpactRatio", () => {
    it("returns 1.0 when rates are equal", () => {
      const protected_ = { groupKey: "a", total: 100, positive: 30, avgScore: 70, scoreStdDev: 10 };
      const reference = { groupKey: "b", total: 100, positive: 30, avgScore: 70, scoreStdDev: 10 };
      expect(computeDisparateImpactRatio(protected_, reference)).toBeCloseTo(1.0);
    });

    it("returns < 0.8 for disparate impact", () => {
      const protected_ = { groupKey: "a", total: 100, positive: 10, avgScore: 50, scoreStdDev: 15 };
      const reference = { groupKey: "b", total: 100, positive: 50, avgScore: 75, scoreStdDev: 10 };
      expect(computeDisparateImpactRatio(protected_, reference)).toBeLessThan(0.8);
    });
  });

  describe("ageToBracket", () => {
    it("maps ages to correct brackets", () => {
      expect(ageToBracket(22)).toBe("under_25");
      expect(ageToBracket(25)).toBe("25-29");
      expect(ageToBracket(30)).toBe("30-34");
      expect(ageToBracket(35)).toBe("35-39");
      expect(ageToBracket(40)).toBe("40-44");
      expect(ageToBracket(45)).toBe("45-49");
      expect(ageToBracket(55)).toBe("50_plus");
    });
  });

  describe("fnvHash", () => {
    it("produces consistent hashes", () => {
      expect(fnvHash("30-34")).toBe(fnvHash("30-34"));
      expect(fnvHash("30-34")).not.toBe(fnvHash("35-39"));
    });

    it("produces 8-char hex strings", () => {
      const hash = fnvHash("test");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Audit log retention / cleanup tests
// ---------------------------------------------------------------------------

describe("audit log retention (EU AI Act / GDPR)", () => {
  describe("getExpiredAuditLogs", () => {
    it("returns audit logs with expiresAt before the given timestamp", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "expired-r1",
          content: {},
          hash: "expired1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;

      // Insert an expired log (decidedAt 3 years ago, expiresAt 1 year ago)
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-expired",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 70 },
          outcome: "pending",
          decidedAt: now - 3 * twoYearsMs / 2,
          expiresAt: now - 1000, // Already expired
        });
      });

      // Insert a non-expired log
      await t.run(async (ctx) => {
        await ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-expired",
          decisionType: "tag",
          actionRef: "ai_tagging_results:drainQueue",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { tags: ["senior"] },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + twoYearsMs, // Not yet expired
        });
      });

      const expired = await t.query(internal.audit.getExpiredAuditLogs, {
        before: now,
      });

      expect(expired.length).toBe(1);
      expect(expired[0].decisionType).toBe("score");
    });

    it("returns empty array when no expired logs exist", async () => {
      const t = convexTest(schema, modules);

      const expired = await t.query(internal.audit.getExpiredAuditLogs, {
        before: Date.now(),
      });

      expect(expired).toEqual([]);
    });
  });

  describe("deleteAuditLog", () => {
    it("deletes an audit log entry", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "delete-r1",
          content: {},
          hash: "delete1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const now = Date.now();
      const logId = await t.run(async (ctx) => {
        return ctx.db.insert("analysis_audit_log", {
          resumeId,
          workspaceSlug: "ws-delete",
          decisionType: "score",
          actionRef: "analyze:analyzeResume",
          inputSnapshot: {},
          modelMeta: { model: "gpt-4", provider: "openai" },
          output: { score: 50 },
          outcome: "pending",
          decidedAt: now,
          expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
        });
      });

      // Verify it exists
      const before = await t.run(async (ctx) => {
        return ctx.db.get(logId);
      });
      expect(before).not.toBeNull();

      // Delete
      await t.mutation(internal.audit.deleteAuditLog, { auditLogId: logId });

      // Verify it's gone
      const after = await t.run(async (ctx) => {
        return ctx.db.get(logId);
      });
      expect(after).toBeNull();
    });
  });

  describe("logAnalysisDecision returns audit log ID", () => {
    it("returns the created audit log document ID", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "return-id-r1",
          content: {},
          hash: "return-id1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      const auditLogId = await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-return-id",
        decisionType: "confirm",
        actionRef: "analyze:confirmSearchResults",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 90, recommendation: "strong_match" },
        decidedAt: Date.now(),
      });

      expect(auditLogId).toBeDefined();

      const log = await t.run(async (ctx) => ctx.db.get(auditLogId));
      expect(log).toBeDefined();
      expect(log!.decisionType).toBe("confirm");
      expect(log!.outcome).toBe("pending");
    });

    it("supports confirm-then-set-outcome flow", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "confirm-flow-r1",
          content: {},
          hash: "confirm-flow1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
      });

      // Simulate the confirm flow: logAnalysisDecision then setAuditOutcome
      const auditLogId = await t.mutation(internal.audit.logAnalysisDecision, {
        resumeId,
        workspaceSlug: "ws-confirm-flow",
        decisionType: "confirm",
        actionRef: "analyze:confirmSearchResults",
        inputSnapshot: {},
        modelMeta: { model: "gpt-4", provider: "openai" },
        output: { score: 90, recommendation: "strong_match" },
        decidedAt: Date.now(),
      });

      // Verify initial state is "pending"
      const beforeSet = await t.run(async (ctx) => ctx.db.get(auditLogId));
      expect(beforeSet!.outcome).toBe("pending");

      // Set outcome to "accepted" (mimics the automatic wiring in confirmSearchResults)
      await t.mutation(api.audit.setAuditOutcome, {
        auditLogId,
        outcome: "accepted",
        setBy: "system:confirmSearchResults",
      });

      const afterSet = await t.run(async (ctx) => ctx.db.get(auditLogId));
      expect(afterSet!.outcome).toBe("accepted");
      expect(afterSet!.outcomeSetBy).toBe("system:confirmSearchResults");
      expect(afterSet!.outcomeSetAt).toBeDefined();
      expect(afterSet!.reviewedAt).toBeDefined();
    });
  });
});
