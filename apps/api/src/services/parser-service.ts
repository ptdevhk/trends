import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { DataNotFoundError, FileParseError } from "./errors.js";
import type { DbType } from "./db.js";
import { findProjectRoot, formatDate, getAvailableDates, getLatestAvailableDate, openDatabase } from "./db.js";

export type TitleInfo = {
  ranks?: number[];
  url?: string;
  mobileUrl?: string;
  published_at?: string;
  summary?: string;
  author?: string;
  first_time?: string;
  last_time?: string;
  count?: number;
};

export type TitlesBySource = Record<string, Record<string, TitleInfo>>;

export class ParserService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  resolveDate(date: Date | undefined, dbType: DbType): Date {
    // If a specific date was requested, do not fall back silently.
    if (date) {
      const db = openDatabase(this.projectRoot, date, dbType);
      if (db) {
        db.close();
        return date;
      }

      throw new DataNotFoundError(`No ${dbType} database for ${formatDate(date)}`, {
        suggestion: "Run the crawler to generate output, e.g. `make dev-crawl` or `./scripts/dev.sh --fresh`",
      });
    }

    // Default (no date): prefer today's DB when available, otherwise fall back to the latest DB on disk.
    const today = new Date();
    const todayDb = openDatabase(this.projectRoot, today, dbType);
    if (todayDb) {
      todayDb.close();
      return today;
    }

    const latest = getLatestAvailableDate(this.projectRoot, dbType);
    if (latest) return latest;

    throw new DataNotFoundError(`No ${dbType} database found under output/${dbType}`, {
      suggestion: "Run the crawler to generate output, e.g. `make dev-crawl` or `./scripts/dev.sh --fresh`",
    });
  }

  readAllTitlesForDate(options: {
    date?: Date;
    sourceIds?: string[];
    dbType?: DbType;
  }): { allTitles: TitlesBySource; idToName: Record<string, string>; timestampsMs: Record<string, number>; dateStr: string } {
    const dbType = options.dbType ?? "news";
    const date = this.resolveDate(options.date, dbType);
    const dateStr = formatDate(date);

    const db = openDatabase(this.projectRoot, date, dbType);
    if (!db) {
      throw new DataNotFoundError(`No ${dbType} database for ${dateStr}`, {
        suggestion: "Run the crawler to generate output, e.g. `make dev-crawl` or `./scripts/dev.sh --fresh`",
      });
    }

    try {
      if (dbType === "news") {
        return { ...this.readNewsFromSqlite(db, options.sourceIds), dateStr };
      }
      return { ...this.readRssFromSqlite(db, options.sourceIds), dateStr };
    } finally {
      db.close();
    }
  }

  private readNewsFromSqlite(
    db: ReturnType<typeof openDatabase> extends infer R ? (R extends null ? never : R) : never,
    platformIds?: string[]
  ): { allTitles: TitlesBySource; idToName: Record<string, string>; timestampsMs: Record<string, number> } {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='news_items'").get();
    if (!table) {
      throw new DataNotFoundError("Table news_items not found in database");
    }

    const allTitles: TitlesBySource = {};
    const idToName: Record<string, string> = {};
    const timestampsMs: Record<string, number> = {};

    const whereClause = platformIds && platformIds.length > 0
      ? `WHERE n.platform_id IN (${platformIds.map(() => "?").join(",")})`
      : "";

    const rows = db.prepare(`
      SELECT n.id as id,
             n.platform_id as platform_id,
             COALESCE(p.name, n.platform_id) as platform_name,
             n.title as title,
             n.rank as rank,
             n.url as url,
             n.mobile_url as mobile_url,
             n.first_crawl_time as first_crawl_time,
             n.last_crawl_time as last_crawl_time,
             n.crawl_count as crawl_count
        FROM news_items n
        LEFT JOIN platforms p ON n.platform_id = p.id
        ${whereClause}
    `).all(...(platformIds ?? [])) as Array<{
      id: number;
      platform_id: string;
      platform_name: string;
      title: string;
      rank: number;
      url: string | null;
      mobile_url: string | null;
      first_crawl_time: string | null;
      last_crawl_time: string | null;
      crawl_count: number | null;
    }>;

    const newsIds = rows.map((r) => r.id);
    const rankHistoryMap = new Map<number, number[]>();

    if (newsIds.length > 0) {
      const placeholders = newsIds.map(() => "?").join(",");
      const rhRows = db.prepare(`
        SELECT news_item_id as news_item_id, rank as rank
          FROM rank_history
         WHERE news_item_id IN (${placeholders})
         ORDER BY news_item_id, crawl_time
      `).all(...newsIds) as Array<{ news_item_id: number; rank: number }>;

      for (const row of rhRows) {
        const list = rankHistoryMap.get(row.news_item_id) ?? [];
        list.push(row.rank);
        rankHistoryMap.set(row.news_item_id, list);
      }
    }

    for (const row of rows) {
      idToName[row.platform_id] = row.platform_name;
      allTitles[row.platform_id] ??= {};

      const ranks = rankHistoryMap.get(row.id) ?? [row.rank];
      allTitles[row.platform_id][row.title] = {
        ranks,
        url: row.url ?? "",
        mobileUrl: row.mobile_url ?? "",
        first_time: row.first_crawl_time ?? "",
        last_time: row.last_crawl_time ?? "",
        count: row.crawl_count ?? 1,
      };
    }

    const crawlTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crawl_records'").get();
    if (crawlTable) {
      const crawlRows = db.prepare("SELECT crawl_time as crawl_time, created_at as created_at FROM crawl_records ORDER BY crawl_time").all() as Array<{
        crawl_time: string;
        created_at: string | null;
      }>;

      for (const row of crawlRows) {
        const ts = row.created_at ? Date.parse(row.created_at.replace(" ", "T")) : NaN;
        timestampsMs[`${row.crawl_time}.db`] = Number.isFinite(ts) ? ts : Date.now();
      }
    }

    if (Object.keys(allTitles).length === 0) {
      throw new DataNotFoundError("No news items found in database");
    }

    return { allTitles, idToName, timestampsMs };
  }

  private readRssFromSqlite(
    db: ReturnType<typeof openDatabase> extends infer R ? (R extends null ? never : R) : never,
    feedIds?: string[]
  ): { allTitles: TitlesBySource; idToName: Record<string, string>; timestampsMs: Record<string, number> } {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rss_items'").get();
    if (!table) {
      throw new DataNotFoundError("Table rss_items not found in database");
    }

    const allTitles: TitlesBySource = {};
    const idToName: Record<string, string> = {};
    const timestampsMs: Record<string, number> = {};

    const whereClause = feedIds && feedIds.length > 0
      ? `WHERE i.feed_id IN (${feedIds.map(() => "?").join(",")})`
      : "";

    const rows = db.prepare(`
      SELECT i.feed_id as feed_id,
             COALESCE(f.name, i.feed_id) as feed_name,
             i.title as title,
             i.url as url,
             i.published_at as published_at,
             i.summary as summary,
             i.author as author,
             i.first_crawl_time as first_crawl_time,
             i.last_crawl_time as last_crawl_time,
             i.crawl_count as crawl_count
        FROM rss_items i
        LEFT JOIN rss_feeds f ON i.feed_id = f.id
        ${whereClause}
       ORDER BY i.published_at DESC
    `).all(...(feedIds ?? [])) as Array<{
      feed_id: string;
      feed_name: string;
      title: string;
      url: string | null;
      published_at: string | null;
      summary: string | null;
      author: string | null;
      first_crawl_time: string | null;
      last_crawl_time: string | null;
      crawl_count: number | null;
    }>;

    for (const row of rows) {
      idToName[row.feed_id] = row.feed_name;
      allTitles[row.feed_id] ??= {};
      allTitles[row.feed_id][row.title] = {
        url: row.url ?? "",
        published_at: row.published_at ?? "",
        summary: row.summary ?? "",
        author: row.author ?? "",
        first_time: row.first_crawl_time ?? "",
        last_time: row.last_crawl_time ?? "",
        count: row.crawl_count ?? 1,
      };
    }

    const crawlTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rss_crawl_records'").get();
    if (crawlTable) {
      const crawlRows = db.prepare("SELECT crawl_time as crawl_time, created_at as created_at FROM rss_crawl_records ORDER BY crawl_time").all() as Array<{
        crawl_time: string;
        created_at: string | null;
      }>;

      for (const row of crawlRows) {
        const ts = row.created_at ? Date.parse(row.created_at.replace(" ", "T")) : NaN;
        timestampsMs[`${row.crawl_time}.db`] = Number.isFinite(ts) ? ts : Date.now();
      }
    }

    if (Object.keys(allTitles).length === 0) {
      throw new DataNotFoundError("No RSS items found in database");
    }

    return { allTitles, idToName, timestampsMs };
  }

  parseYamlConfig(configPath?: string): Record<string, unknown> {
    const filePath = configPath ? path.resolve(configPath) : path.join(this.projectRoot, "config", "config.yaml");
    if (!fs.existsSync(filePath)) {
      throw new FileParseError(filePath, "Config file not found");
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      return (yaml.load(content) ?? {}) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new FileParseError(filePath, msg);
    }
  }

  getAvailableDates(dbType: DbType = "news"): string[] {
    return getAvailableDates(this.projectRoot, dbType);
  }

  parseFrequencyWords(wordsPath?: string): WordGroup[] {
    const filePath = wordsPath ? path.resolve(wordsPath) : path.join(this.projectRoot, "config", "frequency_words.txt");
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf8");
    return loadFrequencyWords(content);
  }
}

type ParsedWord = {
  word: string;
  is_regex: boolean;
  pattern?: RegExp;
  display_name?: string;
};

export type WordGroup = {
  required: ParsedWord[];
  normal: ParsedWord[];
  group_key: string;
  display_name?: string;
  max_count: number;
};

function parseWord(wordLine: string): ParsedWord {
  let display_name: string | undefined;
  let wordConfig = wordLine.trim();

  const arrowIndex = wordConfig.indexOf("=>");
  if (arrowIndex !== -1) {
    const left = wordConfig.slice(0, arrowIndex).trim();
    const right = wordConfig.slice(arrowIndex + 2).trim();
    wordConfig = left;
    if (right) display_name = right;
  }

  const regexMatch = /^\/(.+)\/[a-z]*$/.exec(wordConfig);
  if (regexMatch) {
    const patternStr = regexMatch[1];
    try {
      return {
        word: patternStr,
        is_regex: true,
        pattern: new RegExp(patternStr, "i"),
        display_name,
      };
    } catch {
      // Fall through to substring match.
    }
  }

  return { word: wordConfig, is_regex: false, display_name };
}

function wordMatches(word: ParsedWord, titleLower: string): boolean {
  if (word.is_regex && word.pattern) return word.pattern.test(titleLower);
  return titleLower.includes(word.word.toLowerCase());
}

export function loadFrequencyWords(content: string): WordGroup[] {
  const rawGroups = content
    .split("\n\n")
    .map((g) => g.trim())
    .filter(Boolean);

  const processed: WordGroup[] = [];
  let currentSection = "WORD_GROUPS";

  for (const groupText of rawGroups) {
    const lines = groupText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length === 0) continue;

    // Section marker
    if (lines[0].startsWith("[") && lines[0].endsWith("]")) {
      const section = lines[0].slice(1, -1).toUpperCase();
      if (section === "GLOBAL_FILTER" || section === "WORD_GROUPS") {
        currentSection = section;
        lines.shift();
      }
    }

    if (currentSection === "GLOBAL_FILTER") {
      // Not used by topics counting; skip.
      continue;
    }

    let groupAlias: string | undefined;
    if (lines[0]?.startsWith("[") && lines[0].endsWith("]")) {
      const alias = lines[0].slice(1, -1).trim();
      if (alias.toUpperCase() !== "GLOBAL_FILTER" && alias.toUpperCase() !== "WORD_GROUPS") {
        groupAlias = alias;
        lines.shift();
      }
    }

    const required: ParsedWord[] = [];
    const normal: ParsedWord[] = [];
    let max_count = 0;

    for (const line of lines) {
      if (line.startsWith("@")) {
        const count = Number.parseInt(line.slice(1), 10);
        if (Number.isFinite(count) && count > 0) max_count = count;
        continue;
      }
      if (line.startsWith("!")) {
        // Filter words are not used by topics counting; ignore.
        continue;
      }
      if (line.startsWith("+")) {
        required.push(parseWord(line.slice(1)));
        continue;
      }
      normal.push(parseWord(line));
    }

    if (required.length === 0 && normal.length === 0) continue;

    const group_key = (normal.length > 0 ? normal : required).map((w) => w.word).join(" ");
    const allWords = [...normal, ...required];
    const displayParts = allWords.map((w) => w.display_name ?? w.word);
    const display_name = groupAlias ?? (displayParts.length > 0 ? displayParts.join(" / ") : undefined);

    processed.push({ required, normal, group_key, display_name, max_count });
  }

  return processed;
}

export function matchWordGroup(group: WordGroup, title: string): boolean {
  const titleLower = title.toLowerCase();
  if (group.required.length > 0) {
    const allRequiredPresent = group.required.every((w) => wordMatches(w, titleLower));
    if (!allRequiredPresent) return false;
  }
  if (group.normal.length > 0) {
    const anyNormalPresent = group.normal.some((w) => wordMatches(w, titleLower));
    if (!anyNormalPresent) return false;
  }
  return true;
}

export function matchWordGroupAny(group: WordGroup, title: string): boolean {
  const titleLower = title.toLowerCase();
  const allWords = [...group.required, ...group.normal];
  return allWords.some((w) => wordMatches(w, titleLower));
}
