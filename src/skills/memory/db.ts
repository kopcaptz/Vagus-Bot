/**
 * SQLite layer for semantic memory (memory_chunks).
 * Uses better-sqlite3 (same as main app DB). DB file: data/memory.sqlite.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'memory.sqlite');

let db: Database.Database | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function initMemoryDb(): void {
  if (db) return;
  ensureDataDir();
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
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_user_created ON memory_chunks(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_user_hash ON memory_chunks(user_id, hash);
  `);
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
}
