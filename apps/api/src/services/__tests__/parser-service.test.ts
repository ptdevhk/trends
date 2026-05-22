import { describe, it, expect } from "vitest";
import {
  parseWord,
  wordMatches,
  loadFrequencyWords,
  matchWordGroup,
  matchWordGroupAny,
} from "../parser-service.js";

describe("parseWord", () => {
  it("parses a plain word", () => {
    const result = parseWord("AI");
    expect(result.word).toBe("AI");
    expect(result.is_regex).toBe(false);
    expect(result.pattern).toBeUndefined();
    expect(result.display_name).toBeUndefined();
  });

  it("parses a word with display name alias", () => {
    const result = parseWord("artificial intelligence => AI");
    expect(result.word).toBe("artificial intelligence");
    expect(result.display_name).toBe("AI");
  });

  it("parses a regex word", () => {
    const result = parseWord("/AI|ML/i");
    expect(result.word).toBe("AI|ML");
    expect(result.is_regex).toBe(true);
    expect(result.pattern).toBeInstanceOf(RegExp);
  });

  it("parses a regex word with display name", () => {
    const result = parseWord("/\\bGPT\\d/ => GPT");
    expect(result.word).toBe("\\bGPT\\d");
    expect(result.is_regex).toBe(true);
    expect(result.display_name).toBe("GPT");
  });

  it("falls back to substring for invalid regex", () => {
    const result = parseWord("/[invalid/");
    expect(result.word).toBe("/[invalid/");
    expect(result.is_regex).toBe(false);
  });

  it("handles arrow with empty right side", () => {
    const result = parseWord("test =>");
    expect(result.word).toBe("test");
    expect(result.display_name).toBeUndefined();
  });

  it("trims whitespace around arrow", () => {
    const result = parseWord("  hello  =>  Hi  ");
    expect(result.word).toBe("hello");
    expect(result.display_name).toBe("Hi");
  });
});

describe("wordMatches", () => {
  it("matches a plain word case-insensitively", () => {
    expect(wordMatches({ word: "AI", is_regex: false }, "advances in ai")).toBe(true);
    expect(wordMatches({ word: "AI", is_regex: false }, "ml algorithms")).toBe(false);
  });

  it("matches a regex pattern", () => {
    const word = { word: "GPT\\d+", is_regex: true, pattern: /\bGPT\d+\b/i } as const;
    expect(wordMatches(word, "OpenAI GPT4 launched")).toBe(true);
    expect(wordMatches(word, "OpenAI GPT released")).toBe(false);
  });

  it("falls back to substring when pattern is missing", () => {
    expect(wordMatches({ word: "test", is_regex: true }, "test title")).toBe(true);
    expect(wordMatches({ word: "missing", is_regex: true }, "test title")).toBe(false);
  });
});

describe("loadFrequencyWords", () => {
  it("parses a simple word group", () => {
    const content = "AI\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].normal.map((w) => w.word)).toEqual(["AI", "ML"]);
    expect(groups[0].required).toHaveLength(0);
  });

  it("parses required words with + prefix", () => {
    const content = "+AI\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].required.map((w) => w.word)).toEqual(["AI"]);
    expect(groups[0].normal.map((w) => w.word)).toEqual(["ML"]);
  });

  it("parses group alias in brackets", () => {
    const content = "[Artificial Intelligence]\nAI\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].display_name).toBe("Artificial Intelligence");
  });

  it("parses max_count with @ prefix", () => {
    const content = "AI\n@5";
    const groups = loadFrequencyWords(content);
    expect(groups[0].max_count).toBe(5);
  });

  it("ignores comment lines starting with #", () => {
    const content = "# comment\nAI\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].normal).toHaveLength(2);
  });

  it("ignores filter lines starting with !", () => {
    const content = "AI\n!bad word\nML";
    const groups = loadFrequencyWords(content);
    expect(groups[0].normal).toHaveLength(2);
  });

  it("skips GLOBAL_FILTER section", () => {
    const content = "[GLOBAL_FILTER]\nAI\n\n[WORD_GROUPS]\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].normal.map((w) => w.word)).toEqual(["ML"]);
  });

  it("skips empty groups", () => {
    const content = "# just a comment\n\nAI";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].normal.map((w) => w.word)).toEqual(["AI"]);
  });

  it("handles display name aliases in words", () => {
    const content = "artificial intelligence => AI";
    const groups = loadFrequencyWords(content);
    expect(groups[0].normal[0].word).toBe("artificial intelligence");
    expect(groups[0].normal[0].display_name).toBe("AI");
    expect(groups[0].display_name).toBe("AI");
  });

  it("generates group_key from normal words", () => {
    const content = "AI\nML";
    const groups = loadFrequencyWords(content);
    expect(groups[0].group_key).toBe("AI ML");
  });

  it("generates group_key from required words when no normal words", () => {
    const content = "+AI\n+ML";
    const groups = loadFrequencyWords(content);
    expect(groups[0].group_key).toBe("AI ML");
  });

  it("parses multiple groups separated by blank lines", () => {
    const content = "AI\n\nML";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(2);
    expect(groups[0].normal.map((w) => w.word)).toEqual(["AI"]);
    expect(groups[1].normal.map((w) => w.word)).toEqual(["ML"]);
  });

  it("handles regex words in groups", () => {
    const content = "/\\bGPT\\d+/";
    const groups = loadFrequencyWords(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].normal[0].is_regex).toBe(true);
    expect(groups[0].normal[0].pattern).toBeInstanceOf(RegExp);
  });
});

describe("matchWordGroup", () => {
  it("matches when any normal word is present", () => {
    const group = {
      required: [],
      normal: [{ word: "AI", is_regex: false }],
      group_key: "AI",
      max_count: 0,
    };
    expect(matchWordGroup(group, "AI advances")).toBe(true);
    expect(matchWordGroup(group, "ML algorithms")).toBe(false);
  });

  it("requires all required words to be present", () => {
    const group = {
      required: [{ word: "AI", is_regex: false }],
      normal: [{ word: "future", is_regex: false }],
      group_key: "AI future",
      max_count: 0,
    };
    expect(matchWordGroup(group, "AI and the future")).toBe(true);
    expect(matchWordGroup(group, "AI today")).toBe(false);
    expect(matchWordGroup(group, "future of ML")).toBe(false);
  });

  it("matches with only required words", () => {
    const group = {
      required: [{ word: "AI", is_regex: false }, { word: "ML", is_regex: false }],
      normal: [],
      group_key: "AI ML",
      max_count: 0,
    };
    expect(matchWordGroup(group, "AI meets ML")).toBe(true);
    expect(matchWordGroup(group, "AI only")).toBe(false);
  });

  it("matches case-insensitively", () => {
    const group = {
      required: [],
      normal: [{ word: "AI", is_regex: false }],
      group_key: "AI",
      max_count: 0,
    };
    expect(matchWordGroup(group, "the ai revolution")).toBe(true);
  });

  it("matches regex words", () => {
    const group = {
      required: [],
      normal: [{ word: "GPT\\d+", is_regex: true, pattern: /\bGPT\d+\b/i }],
      group_key: "GPT\\d+",
      max_count: 0,
    };
    expect(matchWordGroup(group, "GPT4 is here")).toBe(true);
    expect(matchWordGroup(group, "GPT released")).toBe(false);
  });
});

describe("matchWordGroupAny", () => {
  it("matches when any word matches (required or normal)", () => {
    const group = {
      required: [{ word: "AI", is_regex: false }],
      normal: [{ word: "future", is_regex: false }],
      group_key: "AI future",
      max_count: 0,
    };
    expect(matchWordGroupAny(group, "AI today")).toBe(true);
    expect(matchWordGroupAny(group, "future tech")).toBe(true);
    expect(matchWordGroupAny(group, "cloud computing")).toBe(false);
  });

  it("matches with only required words", () => {
    const group = {
      required: [{ word: "AI", is_regex: false }],
      normal: [],
      group_key: "AI",
      max_count: 0,
    };
    expect(matchWordGroupAny(group, "AI today")).toBe(true);
    expect(matchWordGroupAny(group, "ML today")).toBe(false);
  });

  it("matches case-insensitively", () => {
    const group = {
      required: [],
      normal: [{ word: "Python", is_regex: false }],
      group_key: "Python",
      max_count: 0,
    };
    expect(matchWordGroupAny(group, "python developer")).toBe(true);
  });
});
