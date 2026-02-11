/**
 * Memory v2 — чтение фактов из .md файлов.
 */

import fs from 'fs';
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
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const facts: FactLine[] = [];

    for (const line of lines) {
      const fact = parseFactLine(line);
      if (fact) facts.push(fact);
    }

    return facts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
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
  return [
    ...profile,
    ...working,
    ...archive,
  ];
}

/**
 * Find a fact by id in any of the three files.
 */
export async function findFactById(userId: string, factId: string): Promise<{ fact: FactLine; file: FactType } | null> {
  const profile = await readProfileFacts(userId);
  const pFact = profile.find((f) => f.id === factId);
  if (pFact) return { fact: pFact, file: 'profile' };

  const working = await readFactsFromFile(getWorkingPath(userId));
  const wk = working.find((f) => f.id === factId);
  if (wk) return { fact: wk, file: 'working' };

  const archive = await readArchiveFacts(userId);
  const arFact = archive.find((f) => f.id === factId);
  if (arFact) return { fact: arFact, file: 'archive' };

  return null;
}

export function getLegacyPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_ROOT, `${safe}.md`);
}
