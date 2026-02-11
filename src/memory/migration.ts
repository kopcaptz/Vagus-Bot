/**
 * Memory v2 — миграция из старого формата (один файл {userId}.md) в users/{userId}/.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { appendFact, writeUserMeta } from './storage/md/write.js';
import { getLegacyPath } from './storage/md/read.js';
import { classifyFact, getPolicy } from './policy.js';
import { ingestFact } from './storage/sqlite/ingest.js';
import { initMemoryDb } from './storage/sqlite/db.js';
import type { FactLine, UserMeta } from './types.js';

const MEMORY_ROOT = path.join(process.cwd(), 'data', 'memory');
const USERS_DIR = path.join(MEMORY_ROOT, 'users');

function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function generateFactId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/**
 * Run migration for userId if legacy file exists and v2 structure does not.
 * Returns true if migration was performed.
 */
export async function runMigrationIfNeeded(userId: string): Promise<boolean> {
  const legacyPath = getLegacyPath(userId);
  const userDir = path.join(USERS_DIR, safeUserId(userId));
  const profilePath = path.join(userDir, 'profile.md');

  if (!fs.existsSync(legacyPath)) return false;
  if (fs.existsSync(profilePath)) return false;

  const backupPath = `${legacyPath}.bak`;
  fs.copyFileSync(legacyPath, backupPath);
  console.log(`[Memory v2] Backup: ${backupPath}`);

  if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });

  const content = fs.readFileSync(legacyPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  const policy = getPolicy();
  let profileCount = 0;
  let workingCount = 0;
  let archiveCount = 0;

  initMemoryDb();

  for (const line of lines) {
    const text = line.replace(/^\s*-\s*/, '').trim();
    if (!text) continue;

    const { type, importance, expiresAt } = classifyFact(text, undefined, policy);
    const id = type === 'profile' ? generateFactId('pf') : type === 'working' ? generateFactId('wk') : generateFactId('ar');
    const fact: FactLine = { id, type, importance, expiresAt, text };

    await appendFact(userId, fact);

    if (type === 'profile') profileCount++;
    else if (type === 'working') workingCount++;
    else archiveCount++;

    try {
      await ingestFact({
        userId,
        factId: id,
        text,
        source: 'migration',
        meta: { type, importance, expiresAt: expiresAt ?? undefined },
      });
    } catch (err) {
      console.warn(`[Memory v2] Ingest failed for ${id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  const meta: UserMeta = {
    version: 2,
    profileCount,
    workingCount,
    archiveCount,
  };
  await writeUserMeta(userId, meta);

  console.log(`[Memory v2] Migrated ${userId}: profile=${profileCount}, working=${workingCount}, archive=${archiveCount}`);
  return true;
}
