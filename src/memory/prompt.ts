/**
 * Memory v2 — сборка блоков памяти для системного промпта (pre-retrieval).
 */

import { runMigrationIfNeeded } from './migration.js';
import { readProfileFacts, readWorkingFacts } from './storage/md/read.js';
import { memorySearchWithFactId } from './storage/sqlite/search.js';

const PROFILE_MAX_CHARS = 800;
const WORKING_MAX_CHARS = 500;
const RELEVANT_MAX_CHARS = 2000;
const PROFILE_MAX_LINES = 20;
const RELEVANT_TOP_K = 5;

export interface BuildMemoryBlocksOptions {
  profileMaxChars?: number;
  workingMaxChars?: number;
  relevantMaxChars?: number;
  relevantTopK?: number;
}

/**
 * Build [PROFILE MEMORY], [WORKING MEMORY], [RELEVANT MEMORY FOR THIS TURN] blocks for system prompt.
 */
export async function buildMemoryBlocksForPrompt(
  userId: string,
  currentMessage: string,
  options: BuildMemoryBlocksOptions = {},
): Promise<string> {
  await runMigrationIfNeeded(userId);

  const profileMaxChars = options.profileMaxChars ?? PROFILE_MAX_CHARS;
  const workingMaxChars = options.workingMaxChars ?? WORKING_MAX_CHARS;
  const relevantMaxChars = options.relevantMaxChars ?? RELEVANT_MAX_CHARS;
  const relevantTopK = options.relevantTopK ?? RELEVANT_TOP_K;

  const profileFacts = readProfileFacts(userId).filter((f) => f.importance === 'high').slice(0, PROFILE_MAX_LINES);
  const workingFacts = readWorkingFacts(userId);

  let profileBlock = profileFacts.map((f) => `- ${f.text}`).join('\n');
  if (profileBlock.length > profileMaxChars) {
    profileBlock = profileBlock.substring(0, profileMaxChars) + '\n...';
  }

  let workingBlock = workingFacts.map((f) => `- ${f.text}`).join('\n');
  if (workingBlock.length > workingMaxChars) {
    workingBlock = workingBlock.substring(0, workingMaxChars) + '\n...';
  }

  let relevantBlock = '';
  if (currentMessage.trim()) {
    try {
      const res = await memorySearchWithFactId(userId, currentMessage, relevantTopK, 0, true);
      const lines = res.results.map((r) => `- (id=${r.fact_id}) ${r.preview}`);
      relevantBlock = lines.join('\n');
      if (relevantBlock.length > relevantMaxChars) {
        relevantBlock = relevantBlock.substring(0, relevantMaxChars) + '\n...';
      }
    } catch (err) {
      console.warn('[Memory v2] Pre-retrieval search failed:', err instanceof Error ? err.message : String(err));
    }
  }

  const parts: string[] = [];
  if (profileBlock) parts.push(`[PROFILE MEMORY]\n${profileBlock}`);
  if (workingBlock) parts.push(`[WORKING MEMORY]\n${workingBlock}`);
  if (relevantBlock) parts.push(`[RELEVANT MEMORY FOR THIS TURN]\n${relevantBlock}`);

  const totalChars = profileBlock.length + workingBlock.length + relevantBlock.length;
  console.log(`[Memory v2] Pre-retrieval: profile=${profileFacts.length}, working=${workingFacts.length}, relevant=${relevantBlock ? relevantTopK : 0}, totalChars≈${totalChars}`);

  return parts.length ? parts.join('\n\n') : '';
}
