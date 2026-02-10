/**
 * Memory v2 — delete chunks by fact_id.
 */

import { getMemoryDb } from './db.js';

export function deleteChunksByFactId(userId: string, factId: string): number {
  const db = getMemoryDb();
  const stmt = db.prepare(`DELETE FROM memory_chunks WHERE user_id = ? AND fact_id = ?`);
  const result = stmt.run(userId, factId);
  return result.changes;
}
