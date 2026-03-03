import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError, FileParseError } from "./errors.js";

export type NotificationTemplateId = string;

export type LoadedNotificationTemplate = {
  id: NotificationTemplateId;
  filename: string;
  updatedAt: string;
  size: number;
  subject?: string;
  bodyTemplate: string;
};

export type RenderedNotificationTemplate = {
  subject?: string;
  markdown: string;
};

const templateIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const templateFrontmatterSchema = z
  .object({
    subject: z.string().optional(),
  })
  .passthrough();

type RenderContext = {
  root: Record<string, unknown>;
  thisValue?: unknown;
  index?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toStringValue(item)).filter(Boolean).join(", ");
  if (isRecord(value)) return JSON.stringify(value);
  return "";
}

function isTruthy(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getPathValue(root: Record<string, unknown>, dottedPath: string): unknown {
  const trimmed = dottedPath.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function resolveValue(token: string, ctx: RenderContext): unknown {
  const trimmed = token.trim();
  if (trimmed === "this") return ctx.thisValue;
  if (trimmed === "@index") return ctx.index;
  return getPathValue(ctx.root, trimmed);
}

function findClosingTag(template: string, startIndex: number, blockType: "if" | "each"): { start: number; end: number } {
  let depth = 1;
  let cursor = startIndex;

  while (cursor < template.length) {
    const open = template.indexOf("{{", cursor);
    if (open === -1) break;
    const close = template.indexOf("}}", open + 2);
    if (close === -1) break;

    const tag = template.slice(open + 2, close).trim();
    if (tag.startsWith(`#${blockType}`)) {
      depth += 1;
    } else if (tag === `/${blockType}`) {
      depth -= 1;
      if (depth === 0) {
        return { start: open, end: close + 2 };
      }
    }
    cursor = close + 2;
  }

  throw new Error(`Unclosed block: {{#${blockType}}}`);
}

function renderTemplateString(template: string, ctx: RenderContext): string {
  let output = "";
  let cursor = 0;

  while (cursor < template.length) {
    const open = template.indexOf("{{", cursor);
    if (open === -1) {
      output += template.slice(cursor);
      break;
    }

    output += template.slice(cursor, open);
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      output += template.slice(open);
      break;
    }

    const tag = template.slice(open + 2, close).trim();
    if (tag.startsWith("#")) {
      const [blockTypeRaw, ...rest] = tag.slice(1).trim().split(/\s+/);
      const blockType = blockTypeRaw === "if" || blockTypeRaw === "each" ? blockTypeRaw : undefined;
      const expr = rest.join(" ").trim();

      if (!blockType || !expr) {
        output += template.slice(open, close + 2);
        cursor = close + 2;
        continue;
      }

      const closing = findClosingTag(template, close + 2, blockType);
      const inner = template.slice(close + 2, closing.start);

      if (blockType === "if") {
        const value = resolveValue(expr, ctx);
        if (isTruthy(value)) {
          output += renderTemplateString(inner, ctx);
        }
      } else {
        const value = resolveValue(expr, ctx);
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) {
            output += renderTemplateString(inner, {
              ...ctx,
              thisValue: value[index],
              index,
            });
          }
        }
      }

      cursor = closing.end;
      continue;
    }

    if (tag.startsWith("/")) {
      // Unexpected closing tag in current context; treat it as literal.
      output += template.slice(open, close + 2);
      cursor = close + 2;
      continue;
    }

    output += toStringValue(resolveValue(tag, ctx));
    cursor = close + 2;
  }

  return output;
}

export class NotificationTemplateService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getTemplatesDir(): string {
    return path.join(this.projectRoot, "config", "notifications");
  }

  listTemplates(includeReadme = false): LoadedNotificationTemplate[] {
    const dir = this.getTemplatesDir();
    if (!fs.existsSync(dir)) return [];

    return fs
      .readdirSync(dir)
      .filter((filename) => filename.endsWith(".md"))
      .filter((filename) => includeReadme || filename.toLowerCase() !== "readme.md")
      .map((filename) => {
        const id = filename.replace(/\.md$/i, "");
        const filePath = path.join(dir, filename);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = this.parseFrontmatterAndBody(content, filePath);

        return {
          id,
          filename,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
          subject: parsed.subject,
          bodyTemplate: parsed.body,
        } satisfies LoadedNotificationTemplate;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  loadTemplate(templateId: string): LoadedNotificationTemplate {
    const id = templateIdSchema.parse(templateId);
    const dir = this.getTemplatesDir();
    const filePath = path.join(dir, `${id}.md`);

    if (!fs.existsSync(filePath)) {
      const available = this.listTemplates(true).map((item) => item.id).join(", ");
      throw new DataNotFoundError(`Notification template not found: ${id}`, {
        suggestion: available ? `Available: ${available}` : "No notification templates available",
      });
    }

    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = this.parseFrontmatterAndBody(content, filePath);

    return {
      id,
      filename: `${id}.md`,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
      subject: parsed.subject,
      bodyTemplate: parsed.body,
    };
  }

  render(templateId: string, data: Record<string, unknown>): RenderedNotificationTemplate {
    const template = this.loadTemplate(templateId);
    const ctx: RenderContext = { root: data };

    const markdown = renderTemplateString(template.bodyTemplate, ctx);
    const subject = template.subject ? renderTemplateString(template.subject, ctx) : undefined;
    return { subject, markdown };
  }

  private parseFrontmatterAndBody(
    content: string,
    filepath: string,
  ): { subject?: string; body: string } {
    const lines = content.split("\n");
    if (lines[0]?.trim() !== "---") {
      return { body: content };
    }

    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }

    if (end === -1) {
      throw new FileParseError(filepath, "Invalid frontmatter: no closing ---");
    }

    const frontmatterYaml = lines.slice(1, end).join("\n");
    let frontmatter: unknown;
    try {
      frontmatter = parseYaml(frontmatterYaml);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      throw new FileParseError(filepath, `Invalid frontmatter YAML: ${message}`);
    }

    const parsedFrontmatter = templateFrontmatterSchema.safeParse(frontmatter);
    if (!parsedFrontmatter.success) {
      throw new FileParseError(filepath, "Invalid template frontmatter schema");
    }

    const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
    return { subject: parsedFrontmatter.data.subject, body };
  }
}

export const notificationTemplateService = new NotificationTemplateService();

