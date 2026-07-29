/**
 * Attended MY company-industry evidence bootstrap.
 *
 * Default mode is dry-run: validate the reviewed input and write a
 * deterministic plan without contacting the API. Pass --apply to create a
 * governed proposal, upload its reviewed evidence candidates, and approve one
 * immutable verdict revision per company. The command also captures prior
 * current revisions in a rollback packet; rollback is a compensating revision,
 * never deletion or mutation of history.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildMyBootstrapPlan,
  buildMyBootstrapRollbackPacket,
  type MyBootstrapApplyResult,
  type MyBootstrapBeforeState,
  type MyBootstrapCompanyInput,
  type MyBootstrapCompanyPlan,
} from "./my-bootstrap-plan.js";

type ApiAuth = { cookie: string; csrfToken: string };

type CliOptions = {
  inputPath: string;
  outputDir: string;
  apiUrl: string;
  workspaceSlug: string;
  apply: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \\",
    "    --input <reviewed-evidence.json> [--output-dir <dir>] \\",
    "    [--api-url http://localhost:3000] [--workspace dev] [--apply]",
    "",
    "Default is dry-run. --apply requires:",
    "  TRENDS_AUTH_USERNAME",
    "  TRENDS_AUTH_PASSWORD",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  let inputPath = "";
  let outputDir = "";
  let apiUrl = process.env.API_URL ?? "http://localhost:3000";
  let workspaceSlug = process.env.WORKSPACE_SLUG ?? "dev";
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply") {
      apply = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      console.log(usage());
      process.exit(0);
    }
    const value = args[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--input") inputPath = value;
    else if (flag === "--output-dir") outputDir = value;
    else if (flag === "--api-url") apiUrl = value;
    else if (flag === "--workspace") workspaceSlug = value;
    else throw new Error(`Unknown argument: ${flag}`);
    index += 1;
  }

  if (!inputPath) {
    throw new Error(`--input is required\n\n${usage()}`);
  }
  return {
    inputPath: path.resolve(inputPath),
    outputDir: path.resolve(
      outputDir || path.dirname(inputPath),
    ),
    apiUrl: apiUrl.replace(/\/$/, ""),
    workspaceSlug: workspaceSlug.trim() || "dev",
    apply,
  };
}

async function loginToApi(apiUrl: string): Promise<ApiAuth> {
  const username = process.env.TRENDS_AUTH_USERNAME?.trim();
  const password = process.env.TRENDS_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error(
      "TRENDS_AUTH_USERNAME and TRENDS_AUTH_PASSWORD are required for --apply",
    );
  }
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(
      `auth login failed (${response.status}): ${(await response.text()).trim()}`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
  const cookie = response.headers
    .get("set-cookie")
    ?.match(/(?:^|,\s*)(trends_session=[^;]+)/i)?.[1]
    ?.trim();
  if (!csrfToken || !cookie) {
    throw new Error("auth login response missing CSRF token or session cookie");
  }
  return { cookie, csrfToken };
}

async function requestJson(
  options: CliOptions,
  auth: ApiAuth,
  pathname: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${options.apiUrl}${pathname}`, {
    ...init,
    headers: {
      "X-Workspace-Slug": options.workspaceSlug,
      "X-CSRF-Token": auth.csrfToken,
      Cookie: auth.cookie,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${pathname} failed (${response.status}): ${(await response.text()).trim()}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function captureBeforeState(
  options: CliOptions,
  auth: ApiAuth,
  company: MyBootstrapCompanyPlan,
): Promise<MyBootstrapBeforeState> {
  const response = await requestJson(
    options,
    auth,
    `/api/company-industry-bundles/${encodeURIComponent(company.companyKey)}`,
  );
  const profile =
    response.profile && typeof response.profile === "object"
      ? response.profile
      : undefined;
  const currentRevisionId =
    profile &&
    typeof (profile as Record<string, unknown>).currentRevisionId === "string"
      ? ((profile as Record<string, unknown>).currentRevisionId as string)
      : undefined;
  return {
    companyKey: company.companyKey,
    ...(currentRevisionId ? { currentRevisionId } : {}),
    ...(profile !== undefined ? { profile } : {}),
  };
}

async function applyCompany(
  options: CliOptions,
  auth: ApiAuth,
  company: MyBootstrapCompanyPlan,
  before: MyBootstrapBeforeState,
): Promise<MyBootstrapApplyResult> {
  try {
    await requestJson(options, auth, "/api/company-industry-proposals", {
      method: "POST",
      body: JSON.stringify({
        proposalId: company.proposalId,
        companyKey: company.companyKey,
        triggerReasons: ["missing_approved_profile"],
        priority: 100,
        currentRevisionId: before.currentRevisionId,
        suggestedIndustryClass: company.industryClass,
        suggestedVerificationLevel: company.verificationLevel,
        materialChangeSummary: `Attended MY bootstrap for ${company.employerName}`,
      }),
    });

    for (const source of company.sources) {
      await requestJson(
        options,
        auth,
        "/api/company-industry-evidence-sources",
        {
          method: "POST",
          body: JSON.stringify({
            sourceId: source.sourceId,
            companyKey: source.companyKey,
            proposalId: source.proposalId,
            url: source.url,
            sourceType: source.sourceType,
            trustTier: source.trustTier,
            title: source.title,
            evidenceExcerpt: source.evidenceExcerpt,
            fetchedAt: source.fetchedAt,
            contentFingerprint: source.contentFingerprint,
            fetchStatus: "fetched",
            suggestedIndustryClass: company.industryClass,
          }),
        },
      );
    }

    await requestJson(
      options,
      auth,
      `/api/company-industry-proposals/${encodeURIComponent(company.proposalId)}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          revisionId: company.revisionId,
          expectedCurrentRevisionId: before.currentRevisionId,
          verificationLevel: company.verificationLevel,
          industryClass: company.industryClass,
          approvedSourceIds: company.sources.map((source) => source.sourceId),
          evidenceSummary: company.evidenceSummary,
          decisionReason: company.decisionReason,
          taxonomyVersion: company.taxonomyVersion,
          ruleVersion: company.ruleVersion,
          nextReviewAt: company.nextReviewAt,
        }),
      },
    );

    return {
      companyKey: company.companyKey,
      proposalId: company.proposalId,
      revisionId: company.revisionId,
      sourceIds: company.sources.map((source) => source.sourceId),
      success: true,
    };
  } catch (error) {
    return {
      companyKey: company.companyKey,
      proposalId: company.proposalId,
      revisionId: company.revisionId,
      sourceIds: company.sources.map((source) => source.sourceId),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(await readFile(options.inputPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Input file must contain a JSON array");
  }

  const plan = buildMyBootstrapPlan(raw as MyBootstrapCompanyInput[]);
  const stem = path.basename(options.inputPath, path.extname(options.inputPath));
  const planPath = path.join(options.outputDir, `${stem}-bootstrap-plan.json`);
  const resultPath = path.join(options.outputDir, `${stem}-apply-results.json`);
  const rollbackPath = path.join(
    options.outputDir,
    `${stem}-rollback-packet.json`,
  );
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  if (!options.apply) {
    console.log(
      `Dry-run valid: ${plan.companies.length} company plan(s). Plan written to ${planPath}`,
    );
    return;
  }

  const auth = await loginToApi(options.apiUrl);
  const beforeStates: MyBootstrapBeforeState[] = [];
  const results: MyBootstrapApplyResult[] = [];
  for (const company of plan.companies) {
    const before = await captureBeforeState(options, auth, company);
    beforeStates.push(before);
    const result = await applyCompany(options, auth, company, before);
    results.push(result);
    console.log(
      `${result.success ? "approved" : "failed"}: ${company.companyKey}${result.error ? ` — ${result.error}` : ""}`,
    );
  }

  const rollback = buildMyBootstrapRollbackPacket(
    plan,
    beforeStates,
    results,
  );
  await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await writeFile(
    rollbackPath,
    `${JSON.stringify(rollback, null, 2)}\n`,
    "utf8",
  );

  const failed = results.filter((result) => !result.success);
  console.log(
    `Apply complete: ${results.length - failed.length}/${results.length} approved. Results: ${resultPath}. Rollback packet: ${rollbackPath}`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
