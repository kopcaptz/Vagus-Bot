/**
 * memory_get: return chunks by ids in order; null for missing/wrong user.
 */

import { getMemoryDb } from './db.js';

export interface ChunkOut {
  id: string;
  text: string;
  created_at: number;
  source: string;
  meta: Record<string, unknown> | null;
}

interface MemoryRow {
  id: string;
  text: string;
  created_at: number;
  source: string;
  meta_json: string | null;
}

export function memoryGet(userId: string, ids: string[]): { chunks: (ChunkOut | null)[] } {
  if (ids.length === 0) {
    return { chunks: [] };
  }

  const db = getMemoryDb();
  const chunks: (ChunkOut | null)[] = [];
  const results = new Map<string, MemoryRow>();

  // SQLite limits variables per query (often 999 or similar). batching is safer.
  const CHUNK_SIZE = 900;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const batchIds = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = batchIds.map(() => '?').join(',');

    const stmt = db.prepare(
      `SELECT id, text, created_at, source, meta_json FROM memory_chunks WHERE id IN (${placeholders}) AND user_id = ?`
    );

    // The parameters are the IDs followed by the userId
    const rows = stmt.all(...batchIds, userId) as MemoryRow[];

    for (const row of rows) {
      results.set(row.id, row);
    }
  }

  for (const id of ids) {
    const row = results.get(id);
    if (!row) {
      chunks.push(null);
      continue;
    }

    let meta: Record<string, unknown> | null = null;
    if (row.meta_json) {
      try {
        meta = JSON.parse(row.meta_json) as Record<string, unknown>;
      } catch {
        meta = null;
      }
    }
    chunks.push({
      id: row.id,
      text: row.text,
      created_at: row.created_at,
      source: row.source,
      meta,
    });
  }

  return { chunks };
}
