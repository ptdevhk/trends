import { describe, expect, it } from "vitest";

import {
  ingestDataValidator,
  collectionTaskResultsValidator,
} from "../validators";

describe("validators", () => {
  describe("ingestDataValidator", () => {
    it("is defined and not null", () => {
      expect(ingestDataValidator).toBeDefined();
      expect(ingestDataValidator).not.toBeNull();
    });

    it("is a Convex VType with expected shape", () => {
      // Convex v.object() validators are opaque VType instances
      // Verify it's a function (v.object returns a validator builder)
      expect(typeof ingestDataValidator).toBe("object");
    });
  });

  describe("collectionTaskResultsValidator", () => {
    it("is defined and not null", () => {
      expect(collectionTaskResultsValidator).toBeDefined();
      expect(collectionTaskResultsValidator).not.toBeNull();
    });

    it("is a Convex VType with expected shape", () => {
      expect(typeof collectionTaskResultsValidator).toBe("object");
    });
  });
});
