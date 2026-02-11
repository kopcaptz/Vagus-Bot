import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { processWithAI, AIResponse, ImageAttachment } from '../../ai/models.js';
import { ContextMessage } from '../../db/context.js';
import { FactLine } from '../types.js';
import { readArchiveFacts } from '../storage/md/read.js';
import { appendFact, deleteFactById } from '../storage/md/write.js';
import { deleteChunksByFactId } from '../storage/sqlite/delete.js';
import { ingestFact } from '../storage/sqlite/ingest.js';

export type AIProcessor = (
  message: string,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>
) => Promise<AIResponse | null>;

const COMPACT_THRESHOLD = 50;
const BATCH_SIZE = 20;

/**
 * Memory v2 — сжатие старых archive.
 *
 * Проходит по пользователям, выбирает старые факты из archive (первые N строк),
 * группирует/суммаризует через LLM,
 * записывает суммарные факты и удаляет исходные чанки по fact_id.
 */
export async function runCompact(aiProcessor: AIProcessor = processWithAI): Promise<void> {
  const usersDir = path.join(process.cwd(), 'data', 'memory', 'users');
  if (!fs.existsSync(usersDir)) return;

  const userIds = fs.readdirSync(usersDir);
  // Log skipped to reduce noise, only log start/end if doing work?
  // But debugging is helpful.

  for (const userId of userIds) {
    try {
      await compactUserArchive(userId, aiProcessor);
    } catch (err) {
      console.error(`[Memory v2] Error compacting for user ${userId}:`, err);
    }
  }
}

async function compactUserArchive(userId: string, aiProcessor: AIProcessor): Promise<void> {
  // 1. Check if compaction is needed
  const facts = readArchiveFacts(userId);
  if (facts.length < COMPACT_THRESHOLD) return;

  // 2. Select facts to compact (oldest = top of file)
  const factsToCompact = facts.slice(0, BATCH_SIZE);
  if (factsToCompact.length === 0) return;

  console.log(`[Memory v2] Compacting ${factsToCompact.length} facts for user ${userId}...`);

  // 3. Prepare Prompt
  const factsText = factsToCompact.map((f, i) => `${i + 1}. ${f.text}`).join('\n');
  const prompt = `
You are a memory manager. Here is a list of old facts from the user's archive:

${factsText}

Please consolidate these into a smaller set of 3-5 key facts, merging duplicates and generalizing where appropriate to save space but keep important context.
Output ONLY a JSON array of strings, for example: ["Fact 1", "Fact 2"].
Do not include any explanation or markdown formatting other than the JSON array.
`;

  // 4. Call AI
  const response = await aiProcessor(prompt);
  if (!response || !response.text) {
    console.warn(`[Memory v2] No response from AI for user ${userId}`);
    return;
  }

  // 5. Parse Response
  let newTexts: string[] = [];
  try {
    // Remove markdown code blocks if present
    const cleanText = response.text
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '')
      .trim();

    newTexts = JSON.parse(cleanText);

    if (!Array.isArray(newTexts) || !newTexts.every(t => typeof t === 'string')) {
      throw new Error('Response is not an array of strings');
    }
  } catch (err) {
    console.warn(`[Memory v2] Failed to parse AI response for user ${userId}: ${response.text.slice(0, 100)}...`);
    return;
  }

  if (newTexts.length === 0) {
    console.warn(`[Memory v2] AI returned empty summary for user ${userId}, skipping compaction.`);
    return;
  }

  console.log(`[Memory v2] Generated ${newTexts.length} summary facts. Saving...`);

  // 6. Save new facts
  for (const text of newTexts) {
    const newId = randomUUID();
    const newFact: FactLine = {
      id: newId,
      type: 'archive',
      importance: 'normal',
      expiresAt: null,
      text: text.trim()
    };
    appendFact(userId, newFact);
    // Ingest into SQLite for search
    await ingestFact({ userId, factId: newId, text: newFact.text });
  }

  // 7. Delete old facts
  // We perform deletion after successful addition to ensure no data loss if addition fails (though we already added some).
  // Ideally this should be transactional, but FS+SQLite isn't.
  for (const oldFact of factsToCompact) {
    deleteFactById(userId, oldFact.id);
    deleteChunksByFactId(userId, oldFact.id);
  }

  console.log(`[Memory v2] Compaction complete for user ${userId}. Removed ${factsToCompact.length}, added ${newTexts.length}.`);
}
