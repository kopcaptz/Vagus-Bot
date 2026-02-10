/**
 * Memory v2 — фасад API памяти.
 */

import { randomUUID } from 'crypto';
import { runMigrationIfNeeded } from './migration.js';
import { readProfileFacts, readWorkingFacts, readAllFacts, findFactById } from './storage/md/read.js';
import { appendFact, deleteFactById, updateFactById, readUserMeta, refreshUserMetaCounts, evictOldestArchive } from './storage/md/write.js';
import { validateFact, classifyFact, getPolicy } from './policy.js';
import { ingestFact } from './storage/sqlite/ingest.js';
import { deleteChunksByFactId } from './storage/sqlite/delete.js';
import { memorySearchWithFactId } from './storage/sqlite/search.js';
import { initMemoryDb } from './storage/sqlite/db.js';
import type { FactLine, FactType, UserMeta } from './types.js';

const MAX_MEMORY_SIZE = 2000;

function generateFactId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/**
 * Backward-compat: load memories as a single string (profile + non-expired working), max 2000 chars.
 */
export async function loadUserMemoriesCompat(userId: string): Promise<string | null> {
  await runMigrationIfNeeded(userId);
  const profile = readProfileFacts(userId);
  const working = readWorkingFacts(userId);
  if (profile.length === 0 && working.length === 0) return null;

  const lines: string[] = [];
  for (const f of profile) lines.push(`- ${f.text}`);
  for (const f of working) lines.push(`- ${f.text}`);
  let content = lines.join('\n');
  if (content.length > MAX_MEMORY_SIZE) {
    content = content.substring(0, MAX_MEMORY_SIZE) + '\n... (память обрезана)';
  }
  return content || null;
}

/**
 * Save a fact (v2): validate, classify, dedup, append to .md, ingest with fact_id.
 */
export async function saveFact(
  userId: string,
  factText: string,
  meta?: Record<string, unknown>,
): Promise<{ ok: true; factId: string; type: FactType } | { ok: false; reason: string }> {
  await runMigrationIfNeeded(userId);

  const policy = getPolicy();
  const validation = validateFact(factText, policy);
  if (!validation.ok) {
    console.log(`[Memory v2] Save rejected: ${validation.reason} for "${factText.slice(0, 50)}..."`);
    return { ok: false, reason: validation.reason ?? 'validation' };
  }

  const text = factText.trim();
  const { type, importance, expiresAt } = classifyFact(text, meta, policy);
  const prefix = type === 'profile' ? 'pf' : type === 'working' ? 'wk' : 'ar';
  const factId = generateFactId(prefix);
  const fact: FactLine = { id: factId, type, importance, expiresAt, text };

  const existing = readAllFacts(userId);
  const textLower = text.toLowerCase();
  for (const f of existing) {
    const fLower = f.text.toLowerCase();
    if (textLower.includes(fLower) || fLower.includes(textLower)) {
      console.log(`[Memory v2] Save rejected: duplicate (substring) "${factId}"`);
      return { ok: false, reason: 'duplicate' };
    }
  }

  initMemoryDb();
  try {
    const { results } = await memorySearchWithFactId(userId, text, 3, 0, false);
    const maxScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
    if (maxScore >= policy.semanticDedupThreshold) {
      console.log(`[Memory v2] Save rejected: semantic_duplicate (score=${maxScore.toFixed(2)})`);
      return { ok: false, reason: 'semantic_duplicate' };
    }
  } catch (_) {
    // If embedding/search fails, proceed without semantic dedup
  }

  let userMeta = readUserMeta(userId);
  if (type === 'profile' && userMeta.profileCount >= policy.maxProfileFacts) {
    console.log(`[Memory v2] Save rejected: profile limit (${policy.maxProfileFacts})`);
    return { ok: false, reason: 'limit' };
  }
  if (type === 'working' && userMeta.workingCount >= policy.maxWorkingFacts) {
    console.log(`[Memory v2] Save rejected: working limit (${policy.maxWorkingFacts})`);
    return { ok: false, reason: 'limit' };
  }
  const total = userMeta.profileCount + userMeta.workingCount + userMeta.archiveCount;
  if (total + 1 > policy.maxFactsPerUser) {
    const toEvict = total + 1 - policy.maxFactsPerUser;
    const evicted = evictOldestArchive(userId, toEvict);
    if (evicted > 0) console.log(`[Memory v2] Evicted ${evicted} archive fact(s) for [${userId}]`);
    userMeta = readUserMeta(userId);
  }

  appendFact(userId, fact);
  refreshUserMetaCounts(userId);

  console.log(`[Memory v2] Saved [${userId}] ${factId} type=${type} imp=${importance}`);

  try {
    await ingestFact({
      userId,
      factId,
      text,
      source: 'manual',
      meta: { type, importance, expiresAt: expiresAt ?? undefined },
    });
  } catch (err) {
    console.warn(`[Memory v2] Ingest failed for ${factId}:`, err instanceof Error ? err.message : String(err));
  }

  return { ok: true, factId, type };
}

/**
 * Forget a fact by id or by search query.
 */
export async function forgetFact(userId: string, queryOrId: string): Promise<{ ok: true; deleted: string } | { ok: false; reason: string }> {
  await runMigrationIfNeeded(userId);
  initMemoryDb();

  const idLike = /^[a-z]{2}_[a-zA-Z0-9-]+$/.test(queryOrId.trim());
  let factId: string | null = null;

  if (idLike) {
    const found = findFactById(userId, queryOrId.trim());
    if (found) factId = found.fact.id;
  }
  if (!factId) {
    const { memorySearchWithFactId } = await import('./storage/sqlite/search.js');
    const res = await memorySearchWithFactId(userId, queryOrId, 1);
    if (res.results.length > 0 && res.results[0]!.fact_id) {
      factId = res.results[0]!.fact_id;
    }
  }

  if (!factId) {
    return { ok: false, reason: 'not_found' };
  }

  const deleted = deleteFactById(userId, factId);
  if (!deleted) {
    return { ok: false, reason: 'not_found' };
  }

  const n = deleteChunksByFactId(userId, factId);
  refreshUserMetaCounts(userId);
  console.log(`[Memory v2] Forget [${userId}] ${factId}, ${n} chunks removed`);
  return { ok: true, deleted: factId };
}

/**
 * Update a fact by id or query: replace text, re-ingest.
 */
export async function updateFact(userId: string, idOrQuery: string, newText: string): Promise<{ ok: true; factId: string } | { ok: false; reason: string }> {
  await runMigrationIfNeeded(userId);
  initMemoryDb();

  const idLike = /^[a-z]{2}_[a-zA-Z0-9-]+$/.test(idOrQuery.trim());
  let factId: string | null = null;

  if (idLike) {
    const found = findFactById(userId, idOrQuery.trim());
    if (found) factId = found.fact.id;
  }
  if (!factId) {
    const { memorySearchWithFactId } = await import('./storage/sqlite/search.js');
    const res = await memorySearchWithFactId(userId, idOrQuery, 1);
    if (res.results.length > 0 && res.results[0]!.fact_id) {
      factId = res.results[0]!.fact_id;
    }
  }

  if (!factId) {
    return { ok: false, reason: 'not_found' };
  }

  const updated = updateFactById(userId, factId, newText.trim());
  if (!updated) {
    return { ok: false, reason: 'not_found' };
  }

  deleteChunksByFactId(userId, factId);
  await ingestFact({
    userId,
    factId,
    text: updated.text,
    source: 'manual',
    meta: { type: updated.type, importance: updated.importance, expiresAt: updated.expiresAt ?? undefined },
  });
  console.log(`[Memory v2] Update [${userId}] ${factId}`);
  return { ok: true, factId };
}

/**
 * Read all memories as string (for memory_read tool).
 */
export async function readMemories(userId: string): Promise<string> {
  await runMigrationIfNeeded(userId);
  const facts = readAllFacts(userId);
  if (facts.length === 0) return 'Нет сохранённых воспоминаний.';
  return facts.map((f) => `- ${f.text}`).join('\n');
}

export { runMigrationIfNeeded, memorySearchWithFactId };
export type { FactLine, UserMeta };
