import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { findProjectRoot } from "./db.js";

const DEFAULT_DB_FILENAME = "resume_screening.db";

let cachedDb: Database.Database | null = null;

export function getResumeScreeningDb(projectRoot?: string): Database.Database {
  if (cachedDb) return cachedDb;

  const root = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  const outputDir = path.join(root, "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dbPath = path.join(outputDir, DEFAULT_DB_FILENAME);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      role TEXT DEFAULT 'recruiter',
      team_id TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT,
      settings TEXT
    );

    CREATE TABLE IF NOT EXISTS search_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      job_description_id TEXT,
      sample_name TEXT,
      filters TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_matches_session ON resume_matches(session_id);
    CREATE INDEX IF NOT EXISTS idx_matches_user ON resume_matches(user_id);

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
  `);
}
