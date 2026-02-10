/**
 * Memory v2 — запись фактов в .md файлы.
 */

import fs from 'fs';
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

function ensureUserDir(userId: string): void {
  const dir = getUserDir(userId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
export function appendFact(userId: string, fact: FactLine): void {
  ensureUserDir(userId);
  const filePath = getPathForType(userId, fact.type);
  const line = formatFactLine(fact);
  fs.appendFileSync(filePath, line, 'utf-8');
}

/**
 * Delete a fact by id from whichever file contains it.
 * Returns the deleted fact and file, or null if not found.
 */
export function deleteFactById(userId: string, factId: string): { fact: FactLine; file: FactType } | null {
  const profilePath = getProfilePath(userId);
  const workingPath = getWorkingPath(userId);
  const archivePath = getArchivePath(userId);

  const files: [string, FactType][] = [
    [profilePath, 'profile'],
    [workingPath, 'working'],
    [archivePath, 'archive'],
  ];
  for (const [filePath, type] of files) {
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
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
      fs.writeFileSync(filePath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf-8');
      return { fact: deleted, file: type };
    }
  }

  return null;
}

/**
 * Update a fact by id: replace only the text body, keep id/type/imp/exp.
 */
export function updateFactById(userId: string, factId: string, newText: string): FactLine | null {
  const profilePath = getProfilePath(userId);
  const workingPath = getWorkingPath(userId);
  const archivePath = getArchivePath(userId);

  for (const filePath of [profilePath, workingPath, archivePath]) {
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
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
      fs.writeFileSync(filePath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf-8');
      return updated;
    }
  }

  return null;
}

/**
 * Read current user meta or default.
 */
export function readUserMeta(userId: string): UserMeta {
  const metaPath = getMetaPath(userId);
  if (!fs.existsSync(metaPath)) {
    return {
      version: 2,
      profileCount: 0,
      workingCount: 0,
      archiveCount: 0,
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Partial<UserMeta>;
    const defaults: UserMeta = { version: 2, profileCount: 0, workingCount: 0, archiveCount: 0 };
    return { ...defaults, ...data };
  } catch {
    return { version: 2, profileCount: 0, workingCount: 0, archiveCount: 0 };
  }
}

/**
 * Write user meta (e.g. after append or eviction).
 */
export function writeUserMeta(userId: string, meta: UserMeta): void {
  ensureUserDir(userId);
  const metaPath = getMetaPath(userId);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Recompute and persist counts from actual files.
 */
export function refreshUserMetaCounts(userId: string): UserMeta {
  const profile = readFactsFromFile(getProfilePath(userId));
  const working = readFactsFromFile(getWorkingPath(userId));
  const archive = readFactsFromFile(getArchivePath(userId));

  const meta: UserMeta = {
    version: 2,
    profileCount: profile.length,
    workingCount: working.length,
    archiveCount: archive.length,
  };
  writeUserMeta(userId, meta);
  return meta;
}

/**
 * Evict oldest archive facts (low importance first, then normal) to free space.
 * Removes up to howMany facts from archive.md and their chunks.
 * Returns number of facts evicted.
 */
export function evictOldestArchive(userId: string, howMany: number): number {
  if (howMany <= 0) return 0;
  const archivePath = getArchivePath(userId);
  if (!fs.existsSync(archivePath)) return 0;

  const facts = readFactsFromFile(archivePath);
  const order: Importance[] = ['low', 'normal', 'high'];
  const sorted = [...facts].sort((a, b) => order.indexOf(a.importance) - order.indexOf(b.importance));
  const toEvict = sorted.slice(0, howMany);
  if (toEvict.length === 0) return 0;

  for (const fact of toEvict) {
    deleteFactById(userId, fact.id);
    deleteChunksByFactId(userId, fact.id);
  }
  refreshUserMetaCounts(userId);
  return toEvict.length;
}
