import { afterEach, describe, expect, it, vi } from "vitest";

const pragmaMock = vi.fn();
const execMock = vi.fn();
const prepareMock = vi.fn();
const closeMock = vi.fn();
const constructorMock = vi.fn(() => ({
  pragma: pragmaMock,
  exec: execMock,
  prepare: prepareMock,
  close: closeMock,
}));

vi.mock("better-sqlite3", () => ({
  default: constructorMock,
}));

describe("getResumeScreeningDb", () => {
  afterEach(async () => {
    const { resetResumeScreeningDb } = await import("./database");
    resetResumeScreeningDb();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("continues when enabling WAL hits SQLITE_BUSY", async () => {
    const tableInfoAllMock = vi.fn(() => [
      { name: "breakdown" },
      { name: "score_source" },
      { name: "workspace_slug" },
    ]);
    prepareMock.mockReturnValue({
      all: tableInfoAllMock,
    });
    pragmaMock.mockImplementation((statement: string) => {
      if (statement === "journal_mode") {
        return "delete";
      }
      if (statement === "journal_mode = WAL") {
        const error = new Error("database is locked");
        Object.assign(error, { code: "SQLITE_BUSY" });
        throw error;
      }
      return undefined;
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getResumeScreeningDb } = await import("./database");

    const db = getResumeScreeningDb(process.cwd());

    expect(db).toBeDefined();
    expect(pragmaMock).toHaveBeenCalledWith("busy_timeout = 5000");
    expect(pragmaMock).toHaveBeenCalledWith("journal_mode", { simple: true });
    expect(pragmaMock).toHaveBeenCalledWith("journal_mode = WAL");
    expect(pragmaMock).toHaveBeenCalledWith("foreign_keys = ON");
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate column errors during concurrent schema upgrades", async () => {
    prepareMock.mockReturnValue({
      all: vi.fn(() => []),
    });
    pragmaMock.mockImplementation((statement: string) => {
      if (statement === "journal_mode") {
        return "wal";
      }
      return undefined;
    });
    execMock.mockImplementation((statement: string) => {
      if (statement.includes("ALTER TABLE search_sessions ADD COLUMN workspace_slug")) {
        const error = new Error("duplicate column name: workspace_slug");
        Object.assign(error, { code: "SQLITE_ERROR" });
        throw error;
      }
      return undefined;
    });

    const { getResumeScreeningDb } = await import("./database");

    expect(() => getResumeScreeningDb(process.cwd())).not.toThrow();
  });
});
