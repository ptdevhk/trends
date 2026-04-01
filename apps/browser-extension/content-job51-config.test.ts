import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const CONTENT_FILE_URL = new URL("./content.js", import.meta.url);
const CONTENT_SOURCE_PROMISE = readFile(CONTENT_FILE_URL, "utf8");

type Job51Helpers = {
  resolveJob51CollectionLimits: (limit: number, maxPages: number) => {
    limit: number;
    maxPages: number;
  };
  resolveJob51DetailFetchDelayMs: () => number;
  resolveJob51AutoSyncDetailWaitMode: () => string;
};

function extractConstNumber(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  if (!match?.[1]) {
    throw new Error(`Failed to extract constant ${name}`);
  }
  return Number(match[1]);
}

function extractFunctionSource(source: string, name: string): string {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  if (start < 0) {
    throw new Error(`Failed to find function ${name}`);
  }

  const bodyStart = source.indexOf("{", start);
  if (bodyStart < 0) {
    throw new Error(`Failed to find function body for ${name}`);
  }

  let depth = 1;
  for (let index = bodyStart + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Failed to extract function source for ${name}`);
}

async function loadJob51Helpers(search: string): Promise<Job51Helpers> {
  const source = await CONTENT_SOURCE_PROMISE;
  const job51SafeLimit = extractConstNumber(source, "JOB51_SAFE_LIMIT");
  const job51SafeMaxPages = extractConstNumber(source, "JOB51_SAFE_MAX_PAGES");
  const defaultDelay = extractConstNumber(source, "JOB51_DETAIL_FETCH_DELAY_MS");
  const unsafeDelay = extractConstNumber(
    source,
    "JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS",
  );

  const hasUnsafeSource = extractFunctionSource(
    source,
    "hasJob51UnsafeLimitsOverride",
  );
  const resolveLimitsSource = extractFunctionSource(
    source,
    "resolveJob51CollectionLimits",
  );
  const resolveDelaySource = extractFunctionSource(
    source,
    "resolveJob51DetailFetchDelayMs",
  );
  const normalizeResumeTextSource = extractFunctionSource(
    source,
    "normalizeResumeText",
  );
  const resolveWaitModeSource = extractFunctionSource(
    source,
    "resolveJob51AutoSyncDetailWaitMode",
  );

  const factory = new Function(
    "window",
    "JOB51_SAFE_LIMIT",
    "JOB51_SAFE_MAX_PAGES",
    "JOB51_DETAIL_FETCH_DELAY_MS",
    "JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS",
    `${hasUnsafeSource}
${normalizeResumeTextSource}
${resolveLimitsSource}
${resolveDelaySource}
${resolveWaitModeSource}
return {
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
  resolveJob51AutoSyncDetailWaitMode,
};`,
  ) as (
    window: { location: { search: string } },
    job51SafeLimit: number,
    job51SafeMaxPages: number,
    defaultDelay: number,
    unsafeDelay: number,
  ) => Job51Helpers;

  return factory(
    { location: { search } },
    job51SafeLimit,
    job51SafeMaxPages,
    defaultDelay,
    unsafeDelay,
  );
}

describe("job51 content config", () => {
  it("keeps 200+ standard runs capped and uses the conservative delay", async () => {
    const helpers = await loadJob51Helpers("?keyword=CNC");

    expect(helpers.resolveJob51CollectionLimits(250, 8)).toEqual({
      limit: 50,
      maxPages: 1,
    });
    expect(helpers.resolveJob51CollectionLimits(0, 0)).toEqual({
      limit: 50,
      maxPages: 1,
    });
    expect(helpers.resolveJob51DetailFetchDelayMs()).toBe(5000);
    expect(helpers.resolveJob51AutoSyncDetailWaitMode()).toBe("background");
  });

  it("unlocks 200+ unsafe runs and uses the faster unsafe delay", async () => {
    const helpers = await loadJob51Helpers("?keyword=CNC&tr_unsafe_limits=1");

    expect(helpers.resolveJob51CollectionLimits(250, 8)).toEqual({
      limit: 250,
      maxPages: 8,
    });
    expect(helpers.resolveJob51CollectionLimits(0, 0)).toEqual({
      limit: 50,
      maxPages: 1,
    });
    expect(helpers.resolveJob51DetailFetchDelayMs()).toBe(1000);
  });

  it("lets 51job auto sync wait for the first page when explicitly requested", async () => {
    const helpers = await loadJob51Helpers(
      "?keyword=CNC&tr_job51_detail_wait=page1",
    );

    expect(helpers.resolveJob51AutoSyncDetailWaitMode()).toBe("page1");
  });
});
