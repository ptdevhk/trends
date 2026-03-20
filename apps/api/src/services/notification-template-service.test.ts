import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DataNotFoundError, FileParseError } from "./errors";
import { NotificationTemplateService } from "./notification-template-service";

const createFixtureRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notification-template-service-"));
  const templatesDir = path.join(root, "config", "notifications");
  fs.mkdirSync(templatesDir, { recursive: true });

  fs.writeFileSync(
    path.join(templatesDir, "shortlist-email.md"),
    [
      "---",
      'subject: "Hello {{recipientName}}"',
      "---",
      "",
      "Hi {{recipientName}}",
      "",
      "{{#if highlights}}",
      "Highlights:",
      "{{#each highlights}}",
      "- {{this}} ({{@index}})",
      "{{/each}}",
      "{{/if}}",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(templatesDir, "shortlist-wechat.md"),
    [
      "# Title",
      "",
      "{{#if note}}",
      "Note: {{note}}",
      "{{/if}}",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(templatesDir, "review-packet-wechat.md"),
    [
      "# Review Packet {{packetId}}",
      "",
      "{{#if statusBreakdown}}",
      "## Status Breakdown",
      "{{#each statusBreakdown}}",
      "- {{this.label}}: {{this.count}}",
      "{{/each}}",
      "{{/if}}",
      "",
      "{{#if warnings}}",
      "## Attention",
      "{{#each warnings}}",
      "- {{this}}",
      "{{/each}}",
      "{{/if}}",
      "",
    ].join("\n"),
  );

  return root;
};

const cleanupFixtureRoot = (root: string): void => {
  fs.rmSync(root, { recursive: true, force: true });
};

describe("NotificationTemplateService", () => {
  it("renders subject + body with if/each blocks", () => {
    const root = createFixtureRoot();
    try {
      const service = new NotificationTemplateService(root);
      const rendered = service.render("shortlist-email", {
        recipientName: "Karl",
        highlights: ["A", "B"],
      });

      expect(rendered.subject).toBe("Hello Karl");
      expect(rendered.markdown).toContain("Hi Karl");
      expect(rendered.markdown).toContain("- A (0)");
      expect(rendered.markdown).toContain("- B (1)");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("does not render if blocks for empty arrays", () => {
    const root = createFixtureRoot();
    try {
      const service = new NotificationTemplateService(root);
      const rendered = service.render("shortlist-email", {
        recipientName: "Karl",
        highlights: [],
      });

      expect(rendered.markdown).toContain("Hi Karl");
      expect(rendered.markdown).not.toContain("Highlights:");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("renders if blocks for non-empty strings", () => {
    const root = createFixtureRoot();
    try {
      const service = new NotificationTemplateService(root);
      const rendered = service.render("shortlist-wechat", { note: "Check ASAP" });

      expect(rendered.markdown).toContain("Note: Check ASAP");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("renders packet warning sections only when present", () => {
    const root = createFixtureRoot();
    try {
      const service = new NotificationTemplateService(root);
      const rendered = service.render("review-packet-wechat", {
        packetId: "packet-1",
        statusBreakdown: [{ label: "Offer", count: 2 }],
        warnings: ["Name edited"],
      });

      expect(rendered.markdown).toContain("# Review Packet packet-1");
      expect(rendered.markdown).toContain("## Status Breakdown");
      expect(rendered.markdown).toContain("- Offer: 2");
      expect(rendered.markdown).toContain("## Attention");
      expect(rendered.markdown).toContain("- Name edited");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("throws DataNotFoundError for missing templates", () => {
    const root = createFixtureRoot();
    try {
      const service = new NotificationTemplateService(root);
      expect(() => service.loadTemplate("missing-template")).toThrow(DataNotFoundError);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("throws FileParseError for invalid frontmatter", () => {
    const root = createFixtureRoot();
    try {
      const templatesDir = path.join(root, "config", "notifications");
      fs.writeFileSync(path.join(templatesDir, "broken.md"), ["---", "subject: hi"].join("\n"));

      const service = new NotificationTemplateService(root);
      expect(() => service.loadTemplate("broken")).toThrow(FileParseError);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
