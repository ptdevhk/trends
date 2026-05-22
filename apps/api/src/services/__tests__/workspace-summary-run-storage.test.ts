import { describe, it, expect } from "vitest";
import {
  parseJsonObject,
  normalizeTriggerSource,
  normalizeStatus,
  normalizeChannel,
  normalizePeriod,
  normalizeRun,
} from "../workspace-summary-run-storage.js";

describe("parseJsonObject", () => {
  it("parses valid JSON object", () => {
    const result = parseJsonObject('{"key":"value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("returns undefined for non-string input", () => {
    expect(parseJsonObject(null)).toBeUndefined();
    expect(parseJsonObject(42)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject("  ")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseJsonObject("not json")).toBeUndefined();
  });

  it("returns undefined for JSON array", () => {
    expect(parseJsonObject("[1,2,3]")).toBeUndefined();
  });

  it("returns undefined for JSON primitive", () => {
    expect(parseJsonObject('"hello"')).toBeUndefined();
    expect(parseJsonObject("42")).toBeUndefined();
  });

  it("parses nested JSON object", () => {
    const result = parseJsonObject('{"a":{"b":1}}');
    expect(result).toEqual({ a: { b: 1 } });
  });
});

describe("normalizeTriggerSource", () => {
  it("returns valid trigger sources", () => {
    expect(normalizeTriggerSource("api_preview")).toBe("api_preview");
    expect(normalizeTriggerSource("api_manual")).toBe("api_manual");
    expect(normalizeTriggerSource("worker_manual")).toBe("worker_manual");
    expect(normalizeTriggerSource("worker_schedule")).toBe("worker_schedule");
  });

  it("defaults to api_manual for invalid values", () => {
    expect(normalizeTriggerSource("invalid")).toBe("api_manual");
    expect(normalizeTriggerSource("")).toBe("api_manual");
  });

  it("defaults to api_manual for null/undefined", () => {
    expect(normalizeTriggerSource(null)).toBe("api_manual");
    expect(normalizeTriggerSource(undefined)).toBe("api_manual");
  });
});

describe("normalizeStatus", () => {
  it("returns valid statuses", () => {
    expect(normalizeStatus("previewed")).toBe("previewed");
    expect(normalizeStatus("dry_run")).toBe("dry_run");
    expect(normalizeStatus("sent")).toBe("sent");
    expect(normalizeStatus("failed")).toBe("failed");
  });

  it("defaults to sent for invalid values", () => {
    expect(normalizeStatus("invalid")).toBe("sent");
    expect(normalizeStatus("")).toBe("sent");
  });

  it("defaults to sent for null/undefined", () => {
    expect(normalizeStatus(null)).toBe("sent");
    expect(normalizeStatus(undefined)).toBe("sent");
  });
});

describe("normalizeChannel", () => {
  it("returns valid channels", () => {
    expect(normalizeChannel("email")).toBe("email");
    expect(normalizeChannel("wechat_work")).toBe("wechat_work");
    expect(normalizeChannel("feishu")).toBe("feishu");
    expect(normalizeChannel("telegram")).toBe("telegram");
  });

  it("returns undefined for invalid channels", () => {
    expect(normalizeChannel("slack")).toBeUndefined();
    expect(normalizeChannel("")).toBeUndefined();
  });

  it("returns undefined for non-string input", () => {
    expect(normalizeChannel(null)).toBeUndefined();
    expect(normalizeChannel(42)).toBeUndefined();
  });
});

describe("normalizePeriod", () => {
  it("returns weekly for weekly", () => {
    expect(normalizePeriod("weekly")).toBe("weekly");
  });

  it("returns daily for any other value", () => {
    expect(normalizePeriod("daily")).toBe("daily");
    expect(normalizePeriod("monthly")).toBe("daily");
    expect(normalizePeriod("")).toBe("daily");
  });

  it("returns daily for null/undefined", () => {
    expect(normalizePeriod(null)).toBe("daily");
    expect(normalizePeriod(undefined)).toBe("daily");
  });
});

describe("normalizeRun", () => {
  const baseRow: Record<string, unknown> = {
    id: "run_1",
    workspace_slug: "dev",
    period: "daily",
    trigger_source: "api_manual",
    status: "sent",
    channel: "email",
    template_id: "tmpl_1",
    dry_run: 0,
    window_start: "2026-05-22",
    window_end: "2026-05-22",
    started_at: "2026-05-22T10:00:00Z",
    finished_at: "2026-05-22T10:01:00Z",
    report_json: '{"sent":1}',
    content_text: "Summary content",
    delivery_json: '{"email":"ok"}',
    error: null,
  };

  it("normalizes a basic run row", () => {
    const result = normalizeRun(baseRow);
    expect(result.id).toBe("run_1");
    expect(result.workspaceSlug).toBe("dev");
    expect(result.period).toBe("daily");
    expect(result.triggerSource).toBe("api_manual");
    expect(result.status).toBe("sent");
    expect(result.channel).toBe("email");
    expect(result.dryRun).toBe(false);
  });

  it("defaults workspaceSlug to dev", () => {
    const result = normalizeRun({ ...baseRow, workspace_slug: null });
    expect(result.workspaceSlug).toBe("dev");
  });

  it("parses dry_run as boolean", () => {
    expect(normalizeRun({ ...baseRow, dry_run: 1 }).dryRun).toBe(true);
    expect(normalizeRun({ ...baseRow, dry_run: 0 }).dryRun).toBe(false);
  });

  it("parses report_json and delivery_json", () => {
    const result = normalizeRun(baseRow);
    expect(result.report).toEqual({ sent: 1 });
    expect(result.delivery).toEqual({ email: "ok" });
  });

  it("defaults report to empty object when invalid", () => {
    const result = normalizeRun({ ...baseRow, report_json: "invalid" });
    expect(result.report).toEqual({});
  });

  it("handles missing optional fields", () => {
    const minimal = {
      id: "run_2",
      period: "daily",
      dry_run: 0,
      window_start: "2026-05-22",
      window_end: "2026-05-22",
      started_at: "2026-05-22T10:00:00Z",
    };
    const result = normalizeRun(minimal);
    expect(result.channel).toBeUndefined();
    expect(result.templateId).toBeUndefined();
    expect(result.finishedAt).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.delivery).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});
