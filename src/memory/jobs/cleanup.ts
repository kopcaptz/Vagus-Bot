/**
 * Memory v2 — удаление истёкших working фактов из .md и SQLite.
 */

import fs from 'fs';
import path from 'path';
import { getWorkingPath } from '../storage/md/read.js';
import { refreshUserMetaCounts } from '../storage/md/write.js';
import { deleteChunksByFactId } from '../storage/sqlite/delete.js';
import { initMemoryDb } from '../storage/sqlite/db.js';
import { parseFactLine } from '../storage/md/format.js';

const MEMORY_ROOT = path.join(process.cwd(), 'data', 'memory');
const USERS_DIR = path.join(MEMORY_ROOT, 'users');

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Remove expired working facts for one user. Returns number of facts removed.
 */
export function cleanupUserWorking(userId: string): number {
  const workingPath = getWorkingPath(userId);
  if (!fs.existsSync(workingPath)) return 0;

  const lines = fs.readFileSync(workingPath, 'utf-8').split('\n');
  const today = getToday();
  const kept: string[] = [];
  let removed = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const fact = parseFactLine(line);
    if (!fact) {
      kept.push(line);
      continue;
    }
    if (fact.expiresAt && fact.expiresAt < today) {
      deleteChunksByFactId(userId, fact.id);
      removed++;
    } else {
      kept.push(line);
    }
  }

  if (removed > 0) {
    fs.writeFileSync(workingPath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8');
    refreshUserMetaCounts(userId);
    console.log(`[Memory v2] Cleanup ${userId}: removed ${removed} expired working facts`);
  }
  return removed;
}

/**
 * Run cleanup for all users in data/memory/users/.
 */
export function runCleanup(): number {
  if (!fs.existsSync(USERS_DIR)) return 0;
  initMemoryDb();

  const dirs = fs.readdirSync(USERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  let total = 0;
  for (const d of dirs) {
    total += cleanupUserWorking(d.name);
  }
  return total;
}
