// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("SEEK talent search request filtering", () => {
  it("captures roleTitles in the MAIN world and injects them into the first batched request", async () => {
    history.replaceState(
      null,
      "",
      "/talentsearch?searchQuery=CNC&market=MY&roleTitles=Sales%20Engineer%2CSales%20Manager",
    );
    sessionStorage.clear();

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: {} }), {
          headers: { "content-type": "application/json" },
        }),
    );
    window.fetch = fetchMock as unknown as typeof window.fetch;

    const hookPath = resolve(process.cwd(), "apps/browser-extension/page-hook.js");
    window.eval(readFileSync(hookPath, "utf8"));

    expect(sessionStorage.getItem("tr_seek_param_roleTitles")).toBe(
      "Sales Engineer,Sales Manager",
    );

    const requestBody = [
      {
        operationName: "SearchProfilesByNaturalLanguage",
        variables: { input: { roleTitles: { values: [], matchLatestOnly: true } } },
      },
    ];
    await window.fetch("https://hk.employer.seek.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const sentInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const sentBody = JSON.parse(String(sentInit?.body));
    expect(sentBody[0].variables.input.roleTitles).toEqual({
      values: ["Sales Engineer", "Sales Manager"],
      matchLatestOnly: true,
    });
  });
});
