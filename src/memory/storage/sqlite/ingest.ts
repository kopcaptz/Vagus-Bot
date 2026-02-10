/**
 * Memory v2 — ingest fact text into memory_chunks with fact_id.
 */

import { randomUUID } from 'crypto';
import { chunkText } from '../../../skills/memory/chunking.js';
import { hashChunkText } from '../../../skills/memory/hash.js';
import { embedTexts, setEmbeddingDim } from '../../../skills/memory/embeddings.js';
import { float32ToBuffer } from '../../../skills/memory/embeddingBlob.js';
import { getMemoryDb } from './db.js';

export interface IngestOptions {
  userId: string;
  factId: string;
  text: string;
  source?: string;
  created_at?: number;
  meta?: Record<string, unknown>;
}

/**
 * Ingest a fact into memory_chunks. Each chunk gets the same fact_id.
 */
export async function ingestFact(opts: IngestOptions): Promise<void> {
  const { userId, factId, text, source = 'manual', meta } = opts;
  const created_at = opts.created_at ?? Date.now();

  const chunks = chunkText(text);
  if (chunks.length === 0) return;

  let vectors: number[][];
  try {
    vectors = await embedTexts(chunks);
    if (vectors[0]) setEmbeddingDim(vectors[0].length);
  } catch (err) {
    const status = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory v2] Embeddings failed (len=${text.length}), .md only. status=${status.slice(0, 80)}`);
    return;
  }

  const metaJson = meta ? JSON.stringify({ ...meta, fact_id: factId }) : JSON.stringify({ fact_id: factId });
  const db = getMemoryDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO memory_chunks (id, user_id, source, text, embedding, embedding_dim, hash, created_at, meta_json, fact_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const vec = vectors[i]!;
    const id = randomUUID();
    const hash = hashChunkText(chunk);
    const embedding = float32ToBuffer(vec);
    stmt.run(id, userId, source, chunk, embedding, vec.length, hash, created_at, metaJson, factId);
  }
}
