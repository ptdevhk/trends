import { resolveApiUrl, resolveWorkspace, splitCsv, parsePositiveInteger, extractFilename, writePrettyJsonFile } from "./operator-utils.ts";

type BackupResponse = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveOutputPath(disposition: string | null, explicitPath: string | undefined): string {
  const trimmed = explicitPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const fromHeader = extractFilename(disposition);
  if (fromHeader) {
    return fromHeader;
  }

  return `resume-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

async function main(): Promise<void> {
  const apiUrl = resolveApiUrl();
  const workspace = resolveWorkspace();
  const outPath = process.env.OUT;
  const resumeIds = splitCsv(process.env.RESUME_IDS);
  const sourceHosts = splitCsv(process.env.SOURCE_HOSTS);
  const limit = parsePositiveInteger(process.env.LIMIT);

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/resumes/backup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspace,
    },
    body: JSON.stringify({
      ...(resumeIds.length > 0 ? { resumeIds } : {}),
      ...(sourceHosts.length > 0 ? { sourceHosts } : {}),
      ...(limit ? { limit } : {}),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`backup request failed (${response.status}): ${responseText.trim() || "no response body"}`);
  }

  let parsed: BackupResponse;
  try {
    const decoded = JSON.parse(responseText) as unknown;
    if (!isRecord(decoded)) {
      throw new Error("backup payload is not an object");
    }
    parsed = decoded as BackupResponse;
  } catch (error) {
    throw new Error(`decode backup response: ${error instanceof Error ? error.message : String(error)}`);
  }

  const resumes = Array.isArray(parsed.resumes) ? parsed.resumes : Array.isArray(parsed.data) ? parsed.data : [];
  const filePath = resolveOutputPath(response.headers.get("content-disposition"), outPath);
  await writePrettyJsonFile(filePath, parsed);

  console.log(JSON.stringify({
    success: true,
    apiUrl,
    workspace,
    file: filePath,
    count: resumes.length,
    bytes: Buffer.byteLength(responseText, "utf8"),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
