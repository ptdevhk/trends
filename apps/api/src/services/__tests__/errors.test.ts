import { describe, it, expect } from "vitest";
import { DataNotFoundError, FileParseError } from "../errors.js";

describe("DataNotFoundError", () => {
  it("is an instance of Error", () => {
    const error = new DataNotFoundError("not found");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DataNotFoundError);
  });

  it("sets name to DataNotFoundError", () => {
    const error = new DataNotFoundError("not found");
    expect(error.name).toBe("DataNotFoundError");
  });

  it("sets message", () => {
    const error = new DataNotFoundError("No data for 2026-01-01");
    expect(error.message).toBe("No data for 2026-01-01");
  });

  it("sets suggestion when provided", () => {
    const error = new DataNotFoundError("not found", { suggestion: "Run the crawler" });
    expect(error.suggestion).toBe("Run the crawler");
  });

  it("leaves suggestion undefined when not provided", () => {
    const error = new DataNotFoundError("not found");
    expect(error.suggestion).toBeUndefined();
  });
});

describe("FileParseError", () => {
  it("is an instance of Error", () => {
    const error = new FileParseError("/path/to/file", "parse failed");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FileParseError);
  });

  it("sets name to FileParseError", () => {
    const error = new FileParseError("/path/to/file", "parse failed");
    expect(error.name).toBe("FileParseError");
  });

  it("sets message", () => {
    const error = new FileParseError("/path/to/file", "parse failed");
    expect(error.message).toBe("parse failed");
  });

  it("sets filepath", () => {
    const error = new FileParseError("/path/to/file.yaml", "invalid YAML");
    expect(error.filepath).toBe("/path/to/file.yaml");
  });
});
