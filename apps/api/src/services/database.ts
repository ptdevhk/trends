import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { findProjectRoot } from "./db.js";
import { logger } from "./logger.js";

const DEFAULT_DB_FILENAME = "resume_screening.db";

let cachedDb: Database.Database | null = null;

function getSqliteErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

function configureResumeScreeningDb(db: Database.Database): void {
  db.pragma("busy_timeout = 5000");

  try {
    const currentJournalMode = db.pragma("journal_mode", { simple: true });
    if (String(currentJournalMode).toLowerCase() !== "wal") {
      db.pragma("journal_mode = WAL");
    }
  } catch (error) {
    logger.error("Failed to enable WAL for resume screening DB", error, { service: "database" });
    if (getSqliteErrorCode(error) !== "SQLITE_BUSY") {
      throw error;
    }
  }

  db.pragma("foreign_keys = ON");
}

export function getResumeScreeningDb(projectRoot?: string): Database.Database {
  if (cachedDb) return cachedDb;

  const root = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  const outputDir = path.join(root, "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dbPath = path.join(outputDir, DEFAULT_DB_FILENAME);
  const db = new Database(dbPath);
  configureResumeScreeningDb(db);

  initSchema(db);
  cachedDb = db;
  return db;
}

export function resetResumeScreeningDb(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
  }
}

function getExistingTableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name?: unknown }>;

  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name : ""))
      .filter((name) => name.length > 0)
  );
}

function initSchema(db: Database.Database): void {
  const existingTables = getExistingTableNames(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      display_name TEXT,
      status TEXT DEFAULT 'active',
      role TEXT DEFAULT 'recruiter',
      team_id TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT,
      settings TEXT
    );

    CREATE TABLE IF NOT EXISTS search_sessions (
      id TEXT PRIMARY KEY,
      workspace_slug TEXT DEFAULT 'dev',
      user_id TEXT,
      job_description_id TEXT,
      sample_name TEXT,
      filters TEXT,
      share_title TEXT,
      search_state TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resume_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      user_id TEXT,
      resume_id TEXT NOT NULL,
      job_description_id TEXT NOT NULL,
      sample_name TEXT,
      score INTEGER NOT NULL,
      recommendation TEXT NOT NULL,
      highlights TEXT,
      concerns TEXT,
      summary TEXT,
      breakdown TEXT,
      score_source TEXT DEFAULT 'ai',
      ai_model TEXT,
      processing_time_ms INTEGER,
      matched_at TEXT NOT NULL,
      UNIQUE(resume_id, job_description_id),
      FOREIGN KEY (session_id) REFERENCES search_sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_matches_job ON resume_matches(job_description_id);
    CREATE INDEX IF NOT EXISTS idx_matches_resume ON resume_matches(resume_id);
    CREATE INDEX IF NOT EXISTS idx_matches_score ON resume_matches(score DESC);
    CREATE INDEX IF NOT EXISTS idx_matches_job_score ON resume_matches(job_description_id, score DESC);
    CREATE INDEX IF NOT EXISTS idx_matches_session ON resume_matches(session_id);
    CREATE INDEX IF NOT EXISTS idx_matches_user ON resume_matches(user_id);

    CREATE TABLE IF NOT EXISTS match_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      job_description_id TEXT NOT NULL,
      sample_name TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER,
      avg_score REAL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (session_id) REFERENCES search_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_match_runs_session ON match_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_match_runs_job ON match_runs(job_description_id);
    CREATE INDEX IF NOT EXISTS idx_match_runs_started ON match_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS candidate_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      session_id TEXT,
      resume_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES search_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_actions_resume ON candidate_actions(resume_id);
    CREATE INDEX IF NOT EXISTS idx_actions_user ON candidate_actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_actions_type ON candidate_actions(action_type);

    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      provider_tenant TEXT,
      email TEXT,
      display_name TEXT,
      raw_profile_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_subject, provider_tenant),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_password_credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      scrypt_n INTEGER NOT NULL,
      scrypt_r INTEGER NOT NULL,
      scrypt_p INTEGER NOT NULL,
      key_length INTEGER NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      password_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_oidc_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      nonce TEXT,
      redirect_to TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_memberships (
      user_id TEXT NOT NULL,
      workspace_slug TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, workspace_slug),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace ON workspace_memberships(workspace_slug);

    CREATE TABLE IF NOT EXISTS workspace_summary_runs (
      id TEXT PRIMARY KEY,
      workspace_slug TEXT NOT NULL DEFAULT 'dev',
      period TEXT NOT NULL DEFAULT 'daily',
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      channel TEXT,
      template_id TEXT,
      dry_run INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      report_json TEXT NOT NULL,
      content_text TEXT,
      delivery_json TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_summary_runs_workspace ON workspace_summary_runs(workspace_slug);
    CREATE INDEX IF NOT EXISTS idx_workspace_summary_runs_started ON workspace_summary_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS review_packet_runs (
      id TEXT PRIMARY KEY,
      workspace_slug TEXT NOT NULL DEFAULT 'dev',
      source TEXT NOT NULL,
      sample_name TEXT,
      session_id TEXT,
      job_description_id TEXT,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      packet_filename TEXT,
      exported_at TEXT NOT NULL,
      feedback_imported_at TEXT,
      summary_sent_at TEXT,
      summary_channel TEXT,
      items_json TEXT NOT NULL,
      stats_json TEXT,
      context_json TEXT,
      error TEXT,
      FOREIGN KEY (session_id) REFERENCES search_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_review_packet_runs_workspace ON review_packet_runs(workspace_slug);
    CREATE INDEX IF NOT EXISTS idx_review_packet_runs_exported ON review_packet_runs(exported_at DESC);
  `);

  if (existingTables.has("users")) {
    ensureColumn(db, "users", "display_name", "TEXT");
    ensureColumn(db, "users", "status", "TEXT DEFAULT 'active'");
  }

  if (existingTables.has("resume_matches")) {
    ensureColumn(db, "resume_matches", "breakdown", "TEXT");
    ensureColumn(db, "resume_matches", "score_source", "TEXT DEFAULT 'ai'");
  }

  if (existingTables.has("search_sessions")) {
    ensureColumn(db, "search_sessions", "workspace_slug", "TEXT DEFAULT 'dev'");
    ensureColumn(db, "search_sessions", "share_title", "TEXT");
    ensureColumn(db, "search_sessions", "search_state", "TEXT");
  }
}

function isDuplicateColumnError(error: unknown, column: string): boolean {
  if (getSqliteErrorCode(error) !== "SQLITE_ERROR") {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`duplicate column name: ${column}`);
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (isDuplicateColumnError(error, column)) {
      return;
    }
    throw error;
  }
}
