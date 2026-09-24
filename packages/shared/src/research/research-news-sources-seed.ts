/**
 * Node-only loader for the research news-source seed catalog.
 *
 * Kept OUT of the browser/Convex import graph: `readFileSync`/`resolve` are Node
 * primitives that break Vite client bundling and Convex edge-runtime sync when
 * pulled in via `@trends/shared`'s index barrel. The pure parse/merge functions
 * and types live in `./research-news-sources.ts`; only this file touches the
 * filesystem, and only Node-side callers (api service / build-live) import it
 * via the `@trends/shared/research-news-sources-seed` subpath.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseResearchNewsSourcesSeed,
  type NewsSourcesSeed,
} from "./research-news-sources.js";

export { parseResearchNewsSourcesSeed } from "./research-news-sources.js";
export type { NewsSourcesSeed } from "./research-news-sources.js";

function defaultProjectRoot(): string {
  const cwd = resolve(process.cwd());
  try {
    readFileSync(resolve(cwd, "config/research_news_sources.yaml"), "utf8");
    return cwd;
  } catch {
    const candidate = resolve(cwd, "../..");
    try {
      readFileSync(resolve(candidate, "config/research_news_sources.yaml"), "utf8");
      return candidate;
    } catch {
      return cwd;
    }
  }
}

export function loadResearchNewsSourcesSeed(projectRoot?: string): NewsSourcesSeed {
  const root = projectRoot ?? defaultProjectRoot();
  const path = resolve(root, "config/research_news_sources.yaml");
  const doc = parseYaml(readFileSync(path, "utf8"));
  return parseResearchNewsSourcesSeed(doc);
}
