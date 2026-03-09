function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type WorkHistoryEvidence = {
  lines: string[];
  text: string;
};

function toRawEntries(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }

  if (isRecord(input) && Array.isArray(input.workHistory)) {
    return input.workHistory;
  }

  return [];
}

export function buildWorkHistoryEvidence(input: unknown): WorkHistoryEvidence {
  const lines = toRawEntries(input)
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizeWhitespace(entry);
      }
      if (isRecord(entry) && typeof entry.raw === "string") {
        return normalizeWhitespace(entry.raw);
      }
      return "";
    })
    .filter((line) => line.length > 0);

  return {
    lines,
    text: lines.join("\n").toLowerCase(),
  };
}
