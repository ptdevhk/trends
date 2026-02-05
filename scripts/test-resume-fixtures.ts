#!/usr/bin/env npx tsx
/**
 * Validate resume fixtures used by CI.
 * Run with: npx tsx scripts/test-resume-fixtures.ts
 */

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const fixturesDir = path.join(projectRoot, "tests", "fixtures", "resumes");

console.log("=".repeat(60));
console.log("Resume Fixtures Validation");
console.log("=".repeat(60));

if (!fs.existsSync(fixturesDir)) {
  console.error(`❌ Missing fixtures directory: ${fixturesDir}`);
  process.exit(1);
}

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("❌ No JSON fixtures found in tests/fixtures/resumes");
  process.exit(1);
}

let issues = 0;

for (const filename of files) {
  const filePath = path.join(fixturesDir, filename);
  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`❌ ${filename}: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`);
    issues += 1;
    continue;
  }

  const items = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data))
      ? (parsed as { data: unknown[] }).data
      : (parsed && typeof parsed === "object" && Array.isArray((parsed as { resumes?: unknown }).resumes))
        ? (parsed as { resumes: unknown[] }).resumes
        : null;

  if (!items) {
    console.error(`❌ ${filename}: expected array or object with data/resumes array`);
    issues += 1;
    continue;
  }

  if (items.length === 0) {
    console.error(`❌ ${filename}: empty resume list`);
    issues += 1;
    continue;
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      console.error(`❌ ${filename}: item ${index + 1} is not an object`);
      issues += 1;
      return;
    }

    const record = item as Record<string, unknown>;
    const name = record.name;
    const jobIntention = record.jobIntention;

    if (typeof name !== "string" || !name.trim()) {
      console.error(`❌ ${filename}: item ${index + 1} missing name`);
      issues += 1;
    }

    if (typeof jobIntention !== "string" || !jobIntention.trim()) {
      console.error(`❌ ${filename}: item ${index + 1} missing jobIntention`);
      issues += 1;
    }

    const workHistory = record.workHistory;
    if (workHistory !== undefined) {
      if (Array.isArray(workHistory)) {
        workHistory.forEach((entry, idx) => {
          if (!entry || typeof entry !== "object" || typeof (entry as { raw?: unknown }).raw !== "string") {
            console.error(`❌ ${filename}: item ${index + 1} workHistory[${idx}] invalid`);
            issues += 1;
          }
        });
      } else if (typeof workHistory !== "string") {
        console.error(`❌ ${filename}: item ${index + 1} workHistory must be array or string`);
        issues += 1;
      }
    }
  });
}

if (issues === 0) {
  console.log("✅ All fixtures look valid");
} else {
  console.log(`⚠️ Found ${issues} issue(s)`);
  process.exit(1);
}

console.log("=".repeat(60));
