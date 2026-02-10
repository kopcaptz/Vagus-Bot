/**
 * Memory v2 — запись фактов в .md файлы.
 */

import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { formatFactLine, parseFactLine } from './format.js';
import type { FactLine, FactType, UserMeta } from '../../types.js';
import {
  getUserDir,
  getProfilePath,
  getWorkingPath,
  getArchivePath,
  getMetaPath,
  readFactsFromFile,
} from './read.js';
import { deleteChunksByFactId } from '../sqlite/delete.js';
import type { Importance } from '../../types.js';

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureUserDir(userId: string): Promise<void> {
  const dir = getUserDir(userId);
  await fs.mkdir(dir, { recursive: true });
}

function getPathForType(userId: string, type: FactType): string {
  switch (type) {
    case 'profile': return getProfilePath(userId);
    case 'working': return getWorkingPath(userId);
    case 'archive': return getArchivePath(userId);
  }
}

/**
 * Append a fact to the appropriate .md file.
 */
export async function appendFact(userId: string, fact: FactLine): Promise<void> {
  await ensureUserDir(userId);
  const filePath = getPathForType(userId, fact.type);
  const line = formatFactLine(fact);
  await fs.appendFile(filePath, line, 'utf-8');
}

/**
 * Delete a fact by id from whichever file contains it.
 * Returns the deleted fact and file, or null if not found.
 */
export async function deleteFactById(userId: string, factId: string): Promise<{ fact: FactLine; file: FactType } | null> {
  const profilePath = getProfilePath(userId);
  const workingPath = getWorkingPath(userId);
  const archivePath = getArchivePath(userId);

  const files: [string, FactType][] = [
    [profilePath, 'profile'],
    [workingPath, 'working'],
    [archivePath, 'archive'],
  ];
  for (const [filePath, type] of files) {
    if (!(await exists(filePath))) continue;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    let deleted: FactLine | null = null;

    for (const line of lines) {
      const fact = parseFactLine(line);
      if (fact && fact.id === factId) {
        deleted = fact;
        continue; // skip this line
      }
      if (line.trim()) newLines.push(line);
    }

    if (deleted) {
      await fs.writeFile(filePath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf-8');
      return { fact: deleted, file: type };
    }
  }

  return null;
}

/**
 * Update a fact by id: replace only the text body, keep id/type/imp/exp.
 */
export async function updateFactById(userId: string, factId: string, newText: string): Promise<FactLine | null> {
  const profilePath = getProfilePath(userId);
  const workingPath = getWorkingPath(userId);
  const archivePath = getArchivePath(userId);

  for (const filePath of [profilePath, workingPath, archivePath]) {
    if (!(await exists(filePath))) continue;

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    let updated: FactLine | null = null;

    for (const line of lines) {
      const fact = parseFactLine(line);
      if (fact && fact.id === factId) {
        updated = { ...fact, text: newText };
        newLines.push(formatFactLine(updated));
        continue;
      }
      if (line.trim()) newLines.push(line);
    }

    if (updated) {
      await fs.writeFile(filePath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf-8');
      return updated;
    }
  }

  return null;
}

/**
 * Read current user meta or default.
 */
export async function readUserMeta(userId: string): Promise<UserMeta> {
  const metaPath = getMetaPath(userId);
  try {
    const content = await fs.readFile(metaPath, 'utf-8');
    const data = JSON.parse(content) as Partial<UserMeta>;
    const defaults: UserMeta = { version: 2, profileCount: 0, workingCount: 0, archiveCount: 0 };
    return { ...defaults, ...data };
  } catch {
    return { version: 2, profileCount: 0, workingCount: 0, archiveCount: 0 };
  }
}

/**
 * Write user meta (e.g. after append or eviction).
 */
export async function writeUserMeta(userId: string, meta: UserMeta): Promise<void> {
  await ensureUserDir(userId);
  const metaPath = getMetaPath(userId);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Recompute and persist counts from actual files.
 */
export async function refreshUserMetaCounts(userId: string): Promise<UserMeta> {
  const [profile, working, archive] = await Promise.all([
    readFactsFromFile(getProfilePath(userId)),
    readFactsFromFile(getWorkingPath(userId)),
    readFactsFromFile(getArchivePath(userId)),
  ]);

  const meta: UserMeta = {
    version: 2,
    profileCount: profile.length,
    workingCount: working.length,
    archiveCount: archive.length,
  };
  await writeUserMeta(userId, meta);
  return meta;
}

/**
 * Evict oldest archive facts (low importance first, then normal) to free space.
 * Removes up to howMany facts from archive.md and their chunks.
 * Returns number of facts evicted.
 */
export async function evictOldestArchive(userId: string, howMany: number): Promise<number> {
  if (howMany <= 0) return 0;
  const archivePath = getArchivePath(userId);
  // exists check is optional as readFactsFromFile handles missing file

  const facts = await readFactsFromFile(archivePath);
  if (facts.length === 0) return 0;

  const order: Importance[] = ['low', 'normal', 'high'];
  const sorted = [...facts].sort((a, b) => order.indexOf(a.importance) - order.indexOf(b.importance));
  const toEvict = sorted.slice(0, howMany);
  if (toEvict.length === 0) return 0;

  for (const fact of toEvict) {
    await deleteFactById(userId, fact.id);
    deleteChunksByFactId(userId, fact.id);
  }
  await refreshUserMetaCounts(userId);
  return toEvict.length;
}
