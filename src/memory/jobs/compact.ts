/**
 * Memory v2 — сжатие старых archive.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { processWithAI } from '../../ai/models.js';
import { readArchiveFacts, getArchivePath } from '../storage/md/read.js';
import { ingestFact } from '../storage/sqlite/ingest.js';
import { deleteChunksByFactId } from '../storage/sqlite/delete.js';
import { initMemoryDb } from '../storage/sqlite/db.js';
import { refreshUserMetaCounts } from '../storage/md/write.js';
import { formatFactLine, parseFactLine } from '../storage/md/format.js';
import type { FactLine } from '../types.js';

const USERS_DIR = path.join(process.cwd(), 'data', 'memory', 'users');
const BATCH_SIZE = 5;
const MIN_ARCHIVE_SIZE = 10;

// Export dependencies for testing
export const _deps = {
  fs,
  processWithAI,
  readArchiveFacts,
  ingestFact,
  deleteChunksByFactId,
  refreshUserMetaCounts,
  formatFactLine,
  parseFactLine,
  getArchivePath,
  initMemoryDb,
  randomUUID,
};

/**
 * Summarize old archive facts into fewer facts.
 */
export async function runCompact(): Promise<void> {
  if (!_deps.fs.existsSync(USERS_DIR)) return;
  _deps.initMemoryDb();

  const dirs = _deps.fs.readdirSync(USERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    try {
      await compactUserArchive(d.name);
    } catch (err) {
      console.error(`[Memory v2] Compact failed for ${d.name}:`, err);
    }
  }
}

async function compactUserArchive(userId: string): Promise<void> {
  const facts = _deps.readArchiveFacts(userId);
  if (facts.length < MIN_ARCHIVE_SIZE) return;

  // Select oldest facts (first BATCH_SIZE)
  const toCompact = facts.slice(0, BATCH_SIZE);

  // Construct prompt
  const factText = toCompact.map((f, i) => `${i + 1}. ${f.text}`).join('\n');
  const prompt = `You are a memory manager. I will provide a list of old memory facts.
Please consolidate them into a SINGLE concise fact (or at most 2 if very distinct).
Preserve key details but remove redundancy.
Output ONLY the new fact text(s), one per line. Do not use bullet points or metadata tags.

Old facts:
${factText}

New consolidated fact(s):`;

  // Call LLM
  const response = await _deps.processWithAI(prompt);
  if (!response || !response.text) {
    console.warn(`[Memory v2] Compact: no response from AI for ${userId}`);
    return;
  }

  const newLines = response.text.split('\n').map(l => l.trim()).filter(l => l);
  if (newLines.length === 0) return;

  // Create new facts
  const newFacts: FactLine[] = [];
  for (const text of newLines) {
    // Strip leading bullets if LLM added them
    const cleanText = text.replace(/^[-*•]\s+/, '').trim();
    if (!cleanText) continue;

    const factId = `ar_${_deps.randomUUID().slice(0, 8)}`;
    newFacts.push({
      id: factId,
      type: 'archive',
      importance: 'normal', // Default to normal for summarized
      expiresAt: null,
      text: cleanText,
    });
  }

  if (newFacts.length === 0) return;

  // Ingest new facts (sqlite)
  for (const f of newFacts) {
    await _deps.ingestFact({
      userId,
      factId: f.id,
      text: f.text,
      source: 'auto_compact',
      meta: { type: f.type, importance: f.importance },
    });
  }

  // Rewrite archive.md: remove compacted, append new
  const archivePath = _deps.getArchivePath(userId);
  if (_deps.fs.existsSync(archivePath)) {
    const fileContent = _deps.fs.readFileSync(archivePath, 'utf-8');
    const fileLines = fileContent.split('\n');
    const idsToDelete = new Set(toCompact.map(f => f.id));

    const outputLines: string[] = [];
    for (const line of fileLines) {
      const parsed = _deps.parseFactLine(line);
      if (parsed && idsToDelete.has(parsed.id)) {
        continue; // Skip
      }
      if (line.trim()) outputLines.push(line);
    }

    // Append new facts
    for (const f of newFacts) {
      outputLines.push(_deps.formatFactLine(f).trim());
    }

    _deps.fs.writeFileSync(archivePath, outputLines.join('\n') + '\n', 'utf-8');
  }

  // Delete old chunks (sqlite)
  for (const f of toCompact) {
    await _deps.deleteChunksByFactId(userId, f.id);
  }

  _deps.refreshUserMetaCounts(userId);
  console.log(`[Memory v2] Compacted ${toCompact.length} facts into ${newFacts.length} for ${userId}`);
}
