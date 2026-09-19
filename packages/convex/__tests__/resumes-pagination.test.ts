import { describe, expect, it } from "vitest";

import {
  MAX_SAFE_LIST_WITH_INGEST_DOCS_PER_QUERY,
  resolveListWithIngestDocsPerQuery,
} from "../convex/lib/resumes_pagination.js";

describe("resolveListWithIngestDocsPerQuery", () => {
  it("caps websocket list pages at the fat-doc isolate budget", () => {
    expect(MAX_SAFE_LIST_WITH_INGEST_DOCS_PER_QUERY).toBe(16);
    expect(resolveListWithIngestDocsPerQuery(200)).toBe(16);
    expect(resolveListWithIngestDocsPerQuery(8)).toBe(8);
  });
});
