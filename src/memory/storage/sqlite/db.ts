/**
 * Memory v2 — SQLite for semantic chunks.
 * Path: data/sqlite/memory.sqlite. Column fact_id for forget/update.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SQLITE_DIR = path.join(DATA_DIR, 'sqlite');
const DB_PATH = path.join(SQLITE_DIR, 'memory.sqlite');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'memory.sqlite');

let db: Database.Database | null = null;

function ensureSqliteDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SQLITE_DIR)) fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

/**
 * Migrate legacy DB from data/memory.sqlite to data/sqlite/memory.sqlite if needed.
 */
function migrateLegacyPath(): void {
  if (fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  ensureSqliteDir();
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  console.log('[Memory v2] Migrated DB from data/memory.sqlite to data/sqlite/memory.sqlite');
}

export function initMemoryDb(): void {
  if (db) return;
  ensureSqliteDir();
  migrateLegacyPath();
  db = new Database(DB_PATH);
  runMigrations();
}

function runMigrations(): void {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_dim INTEGER NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      meta_json TEXT,
      fact_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_user_created ON memory_chunks(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_user_hash ON memory_chunks(user_id, hash);
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_fact_id ON memory_chunks(user_id, fact_id);
  `);
  try {
    db.exec(`ALTER TABLE memory_chunks ADD COLUMN fact_id TEXT`);
  } catch {
    // column already exists
  }
}

export function getMemoryDb(): Database.Database {
  if (!db) initMemoryDb();
  return db!;
}

export function closeMemoryDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export interface MemoryChunkRow {
  id: string;
  user_id: string;
  source: string;
  text: string;
  embedding: Buffer;
  embedding_dim: number;
  hash: string;
  created_at: number;
  meta_json: string | null;
  fact_id: string | null;
}

export function getDbPath(): string {
  return DB_PATH;
}
