import {
  resolveApiUrl,
  resolveWorkspace,
  splitCsv,
  parsePositiveInteger,
  extractFilename,
  writePortableBackupFile,
} from "./operator-utils.ts";

type BackupResponse = {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
  candidateActions?: unknown[];
  candidateStatus?: unknown[];
};

type BackupAuth = {
  cookie: string;
  csrfToken: string;
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

  return `output/resume-backups/resume-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

function extractSessionCookie(response: Response): string | undefined {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return undefined;
  }
  const match = /(?:^|,\s*)(trends_session=[^;]+)/i.exec(setCookie);
  return match?.[1]?.trim() || undefined;
}

async function loginToApi(apiUrl: string): Promise<BackupAuth> {
  const username = process.env.TRENDS_AUTH_USERNAME?.trim();
  const password = process.env.TRENDS_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error("TRENDS_AUTH_USERNAME and TRENDS_AUTH_PASSWORD are required for authenticated backup");
  }

  const loginUrl = `${apiUrl.replace(/\/$/, "")}/api/auth/login`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`auth login failed (${response.status}): ${text.trim() || "no response body"}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : undefined;
  if (!csrfToken) {
    throw new Error("auth login response missing csrfToken");
  }

  const cookie = extractSessionCookie(response);
  if (!cookie) {
    throw new Error("auth login response missing session cookie");
  }

  return { cookie, csrfToken };
}

async function main(): Promise<void> {
  const apiUrl = resolveApiUrl();
  const workspace = resolveWorkspace();
  const outPath = process.env.OUT;
  const resumeIds = splitCsv(process.env.RESUME_IDS);
  const sourceHosts = splitCsv(process.env.SOURCE_HOSTS);
  const limit = parsePositiveInteger(process.env.LIMIT);

  // Authenticate when TRENDS_AUTH_USERNAME/TRENDS_AUTH_PASSWORD are set.
  // The backup endpoint requires admin access; without auth the request
  // returns 401 against any auth-enabled deployment (prod, preview).
  let auth: BackupAuth | undefined;
  if (process.env.TRENDS_AUTH_USERNAME?.trim()) {
    auth = await loginToApi(apiUrl);
    console.log(`  authenticated as ${process.env.TRENDS_AUTH_USERNAME.trim()}`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workspace-Slug": workspace,
  };
  if (auth) {
    headers.Cookie = auth.cookie;
    headers["X-CSRF-Token"] = auth.csrfToken;
  }

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/resumes/backup`, {
    method: "POST",
    headers,
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
  const actions = Array.isArray(parsed.candidateActions) ? parsed.candidateActions : [];
  const status = Array.isArray(parsed.candidateStatus) ? parsed.candidateStatus : [];
  const filePath = resolveOutputPath(response.headers.get("content-disposition"), outPath);
  const bytes = await writePortableBackupFile(filePath, parsed);

  console.log(JSON.stringify({
    success: true,
    apiUrl,
    workspace,
    file: filePath,
    count: resumes.length,
    actions: actions.length,
    status: status.length,
    bytes,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
