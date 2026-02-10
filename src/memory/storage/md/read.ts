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
export function readFactsFromFile(filePath: string): FactLine[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const facts: FactLine[] = [];

  for (const line of lines) {
    const fact = parseFactLine(line);
    if (fact) facts.push(fact);
  }

  return facts;
}

/**
 * Read profile facts (all).
 */
export function readProfileFacts(userId: string): FactLine[] {
  return readFactsFromFile(getProfilePath(userId));
}

/**
 * Read working facts, optionally filtering out expired (expiresAt < today).
 */
export function readWorkingFacts(userId: string, filterExpired: boolean = true): FactLine[] {
  const facts = readFactsFromFile(getWorkingPath(userId));
  if (!filterExpired) return facts;

  const today = new Date().toISOString().slice(0, 10);
  return facts.filter((f) => !f.expiresAt || f.expiresAt >= today);
}

/**
 * Read archive facts.
 */
export function readArchiveFacts(userId: string): FactLine[] {
  return readFactsFromFile(getArchivePath(userId));
}

/**
 * Read all facts for a user (profile + non-expired working + archive).
 */
export function readAllFacts(userId: string): FactLine[] {
  return [
    ...readProfileFacts(userId),
    ...readWorkingFacts(userId),
    ...readArchiveFacts(userId),
  ];
}

/**
 * Find a fact by id in any of the three files.
 */
export function findFactById(userId: string, factId: string): { fact: FactLine; file: FactType } | null {
  const profile = readProfileFacts(userId).find((f) => f.id === factId);
  if (profile) return { fact: profile, file: 'profile' };

  const working = readFactsFromFile(getWorkingPath(userId));
  const wk = working.find((f) => f.id === factId);
  if (wk) return { fact: wk, file: 'working' };

  const archive = readArchiveFacts(userId).find((f) => f.id === factId);
  if (archive) return { fact: archive, file: 'archive' };

  return null;
}

export function getLegacyPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_ROOT, `${safe}.md`);
}
