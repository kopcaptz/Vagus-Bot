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

export function memoryGet(userId: string, ids: string[]): { chunks: (ChunkOut | null)[] } {
  if (ids.length === 0) {
    return { chunks: [] };
  }

  const db = getMemoryDb();
  const chunks: (ChunkOut | null)[] = [];

  const stmt = db.prepare(
    `SELECT id, text, created_at, source, meta_json FROM memory_chunks WHERE id = ? AND user_id = ?`,
  );

  for (const id of ids) {
    const row = stmt.get(id, userId) as { id: string; text: string; created_at: number; source: string; meta_json: string | null } | undefined;
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
