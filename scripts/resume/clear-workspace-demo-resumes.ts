import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../packages/convex/convex/_generated/api.js";

const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";

type CliOptions = {
  convexUrl: string;
  json: boolean;
};

type CleanupResult = {
  success: true;
  convexUrl: string;
  deleted: number;
  tag: string;
};

function toOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCliValue(flag: string): string | undefined {
  const fullFlag = `--${flag}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === fullFlag) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(`${fullFlag}=`)) {
      return arg.slice(fullFlag.length + 1);
    }
  }
  return undefined;
}

function hasCliFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function parseCliOptions(): CliOptions {
  return {
    convexUrl: (toOptionalString(readCliValue("convex-url")) ?? toOptionalString(process.env.CONVEX_URL) ?? DEFAULT_CONVEX_URL).replace(/\/$/, ""),
    json: hasCliFlag("json"),
  };
}

export async function runWorkspaceDemoResumeCleanup(options: CliOptions): Promise<CleanupResult> {
  const client = new ConvexHttpClient(options.convexUrl);
  const result = await client.mutation(api.seed.clearWorkspaceDemoResumes, {});

  return {
    success: true,
    convexUrl: options.convexUrl,
    deleted: result.deleted,
    tag: result.tag,
  };
}

function printResult(result: CleanupResult): void {
  console.log(`Convex URL: ${result.convexUrl}`);
  console.log(`Deleted resumes: ${result.deleted}`);
  console.log(`Tag: ${result.tag}`);
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const result = await runWorkspaceDemoResumeCleanup(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printResult(result);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1];

if (entryFilePath && currentFilePath === entryFilePath) {
  main().catch((error: unknown) => {
    console.error("clear-workspace-demo-resumes failed:");
    console.error(error);
    process.exitCode = 1;
  });
}
