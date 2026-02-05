import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError } from "./errors.js";

export type JobDescriptionFile = {
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
  title?: string;
};

export class JobDescriptionService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getDescriptionsDir(): string {
    return path.join(this.projectRoot, "config", "job-descriptions");
  }

  listFiles(includeReadme = false): JobDescriptionFile[] {
    const dir = this.getDescriptionsDir();
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir)
      .filter((filename) => filename.endsWith(".md"))
      .filter((filename) => includeReadme || filename.toLowerCase() !== "readme.md")
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf8");
        return {
          name: filename.replace(/\.md$/i, ""),
          filename,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
          title: extractTitle(content),
        } satisfies JobDescriptionFile;
      });

    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  loadFile(name: string): { item: JobDescriptionFile; content: string } {
    const dir = this.getDescriptionsDir();
    const normalizedName = name.replace(/\.md$/i, "");
    const filename = `${normalizedName}.md`;
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      const available = this.listFiles(true).map((item) => item.name).join(", ");
      throw new DataNotFoundError(`Job description not found: ${name}`, {
        suggestion: available ? `Available: ${available}` : "No job descriptions available",
      });
    }

    const content = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const item: JobDescriptionFile = {
      name: normalizedName,
      filename,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
      title: extractTitle(content),
    };

    return { item, content };
  }
}

function extractTitle(content: string): string | undefined {
  const lines = content.split("\n");
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line === "---") break;
      const match = /^title:\s*(.+)$/.exec(line);
      if (match) {
        return match[1].replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.replace(/^#\s+/, "").trim();
    }
  }
  return undefined;
}
