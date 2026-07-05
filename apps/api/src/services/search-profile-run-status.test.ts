import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readRunStatusStore } from "./search-profile-run-status.js";

describe("readRunStatusStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs and returns an empty store when the status file cannot be read", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("disk unavailable");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = readRunStatusStore("/tmp/trends-tests");

    expect(result).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      "search-profile-run-status read failed:",
      expect.objectContaining({ message: "disk unavailable" }),
    );
  });
});
