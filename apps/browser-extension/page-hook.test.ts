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

  it("captures the MY name-search operation with a safe request snapshot", async () => {
    history.replaceState(
      null,
      "",
      "/talentsearch/profiles/search?searchQuery=John%20Doe&market=MY",
    );
    sessionStorage.clear();

    const responsePayload = {
      data: {
        talentSearchProfilesSearchByName: {
          result: {
            exactMatches: { node: [{ profileGuid: "guid-exact" }] },
            partialMatches: { node: [{ profileGuid: "guid-partial" }] },
          },
        },
      },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify(responsePayload), {
          headers: { "content-type": "application/json" },
        }),
    );
    window.fetch = fetchMock as unknown as typeof window.fetch;

    const hookWindow = window as typeof window & {
      __trResumeHookInstalled?: boolean;
    };
    hookWindow.__trResumeHookInstalled = false;
    const messages: MessageEvent[] = [];
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source === "tr-resume-api") messages.push(event);
    };
    window.addEventListener("message", onMessage);

    const hookPath = resolve(process.cwd(), "apps/browser-extension/page-hook.js");
    window.eval(readFileSync(hookPath, "utf8"));

    await window.fetch("https://hk.employer.seek.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName: "SearchProfilesByName",
        variables: {
          input: {
            searchQuery: "John Doe",
            market: "MY",
            roleTitles: { values: [], matchLatestOnly: true },
            locations: { values: ["24500"] },
            pageNumber: 1,
            pageSize: 20,
          },
          language: "en",
          locale: "en-MY",
        },
      }),
    });

    await vi.waitFor(() => {
      expect(messages.some((event) => event.data.operationName === "SearchProfilesByName")).toBe(true);
    });

    const message = messages.find(
      (event) => event.data.operationName === "SearchProfilesByName",
    )?.data;
    expect(message).toMatchObject({
      kind: "seekTalentSearch",
      sourceKey: "seek",
      operationName: "SearchProfilesByName",
      request: {
        operationName: "SearchProfilesByName",
        variables: {
          input: {
            searchQuery: "John Doe",
            market: "MY",
            roleTitles: { values: [], matchLatestOnly: true },
            locations: { values: ["24500"] },
            pageNumber: 1,
            pageSize: 20,
          },
          language: "en",
          locale: "en-MY",
        },
      },
    });
    expect(message.request).not.toHaveProperty("query");
    window.removeEventListener("message", onMessage);
  });
});
