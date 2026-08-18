import { describe, expect, it } from "vitest";

import { createApp, openApiConfig } from "./app.js";

describe("OpenAPI streaming response typing", () => {
  it("generates the 3.1 document including the SSE match-stream route", () => {
    const doc = createApp().getOpenAPI31Document(openApiConfig);
    expect(doc.paths?.["/api/resumes/match-stream"]?.post).toBeDefined();
  });

  it("types the match-stream response as text/event-stream, not application/json", () => {
    const doc = createApp().getOpenAPI31Document(openApiConfig);
    const content =
      doc.paths?.["/api/resumes/match-stream"]?.post?.responses?.["200"]
        ?.content;
    expect(content).toEqual(
      expect.objectContaining({
        "text/event-stream": expect.objectContaining({
          schema: expect.any(Object),
        }),
      }),
    );
    expect(content?.["application/json"]).toBeUndefined();
  });
});
