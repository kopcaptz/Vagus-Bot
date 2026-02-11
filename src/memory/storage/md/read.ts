/**
 * Memory v2 — чтение фактов из .md файлов.
 */

import fs from 'fs/promises';
import path from 'path';
import { parseFactLine } from './format.js';
import type { FactLine, FactType } from '../../types.js';

const MEMORY_ROOT = path.join(process.cwd(), 'data', 'memory');
const USERS_DIR = path.join(MEMORY_ROOT, 'users');

export function getUserDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(USERS_DIR, safe);
}

export function getProfilePath(userId: string): string {
  return path.join(getUserDir(userId), 'profile.md');
}

export function getWorkingPath(userId: string): string {
  return path.join(getUserDir(userId), 'working.md');
}

export function getArchivePath(userId: string): string {
  return path.join(getUserDir(userId), 'archive.md');
}

export function getMetaPath(userId: string): string {
  return path.join(getUserDir(userId), 'meta.json');
}

/**
 * Read and parse all fact lines from a single .md file.
 */
export async function readFactsFromFile(filePath: string): Promise<FactLine[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const facts: FactLine[] = [];

    for (const line of lines) {
      const fact = parseFactLine(line);
      if (fact) facts.push(fact);
    }

    return facts;
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Read profile facts (all).
 */
export async function readProfileFacts(userId: string): Promise<FactLine[]> {
  return readFactsFromFile(getProfilePath(userId));
}

/**
 * Read working facts, optionally filtering out expired (expiresAt < today).
 */
export async function readWorkingFacts(userId: string, filterExpired: boolean = true): Promise<FactLine[]> {
  const facts = await readFactsFromFile(getWorkingPath(userId));
  if (!filterExpired) return facts;

  const today = new Date().toISOString().slice(0, 10);
  return facts.filter((f) => !f.expiresAt || f.expiresAt >= today);
}

/**
 * Read archive facts.
 */
export async function readArchiveFacts(userId: string): Promise<FactLine[]> {
  return readFactsFromFile(getArchivePath(userId));
}

/**
 * Read all facts for a user (profile + non-expired working + archive).
 */
export async function readAllFacts(userId: string): Promise<FactLine[]> {
  const [profile, working, archive] = await Promise.all([
    readProfileFacts(userId),
    readWorkingFacts(userId),
    readArchiveFacts(userId),
  ]);

  return [...profile, ...working, ...archive];
}

/**
 * Find a fact by id in any of the three files.
 */
export async function findFactById(userId: string, factId: string): Promise<{ fact: FactLine; file: FactType } | null> {
  // Check profile first
  const profileFacts = await readProfileFacts(userId);
  const profile = profileFacts.find((f) => f.id === factId);
  if (profile) return { fact: profile, file: 'profile' };

  // Check working
  const workingFacts = await readFactsFromFile(getWorkingPath(userId)); // explicit file read to avoid filtering if any? findFactById probably wants raw facts?
  // Wait, readWorkingFacts filters expired by default. findFactById might want to find expired facts too?
  // The original code used readFactsFromFile(getWorkingPath(userId)) directly for working.
  // So I should do the same.

  const wk = workingFacts.find((f) => f.id === factId);
  if (wk) return { fact: wk, file: 'working' };

  // Check archive
  const archiveFacts = await readArchiveFacts(userId);
  const archive = archiveFacts.find((f) => f.id === factId);
  if (archive) return { fact: archive, file: 'archive' };

  return null;
}

export function getLegacyPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_ROOT, `${safe}.md`);
}
