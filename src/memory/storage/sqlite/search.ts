/**
 * Memory v2 — semantic search with fact_id and optional decay.
 */

import { getMemoryDb } from './db.js';
import { embedQuery, getEmbeddingDim } from '../../../skills/memory/embeddings.js';
import { bufferToFloat32 } from '../../../skills/memory/embeddingBlob.js';
import { getPolicy } from '../../policy.js';
import type { SearchResultWithFactId } from '../../types.js';

const MAX_CANDIDATES = 5000;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SearchResultV2 {
  results: SearchResultWithFactId[];
}

/**
 * Search memory chunks; returns chunk id, fact_id, score, preview.
 * Applies decay to score for older chunks (archive/normal) when applyDecay is true.
 */
export async function memorySearchWithFactId(
  userId: string,
  query: string,
  topK: number = 5,
  sinceMs: number = 0,
  applyDecay: boolean = true,
): Promise<SearchResultV2> {
  const queryVec = await embedQuery(query);
  const queryDim = queryVec.length;
  const policy = getPolicy();
  const now = Date.now();

  const db = getMemoryDb();
  const rows = db.prepare(
    `SELECT id, text, embedding, embedding_dim, created_at, source, fact_id, meta_json
     FROM memory_chunks
     WHERE user_id = ? AND embedding_dim = ? AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(userId, queryDim, sinceMs, MAX_CANDIDATES) as Array<{
    id: string;
    text: string;
    embedding: Buffer;
    embedding_dim: number;
    created_at: number;
    source: string;
    fact_id: string | null;
    meta_json: string | null;
  }>;

  const withScore: SearchResultWithFactId[] = rows.map((row) => {
    const vec = bufferToFloat32(row.embedding, row.embedding_dim);
    let score = cosineSimilarity(queryVec, vec);
    let type: 'profile' | 'working' | 'archive' | undefined;
    let importance: 'high' | 'normal' | 'low' | undefined;

    if (applyDecay && row.meta_json) {
      try {
        const meta = JSON.parse(row.meta_json) as Record<string, unknown>;
        type = meta.type as typeof type;
        importance = meta.importance as typeof importance;
        if ((type === 'archive' || importance === 'normal') && type !== 'profile' && importance !== 'high') {
          const ageDays = (now - row.created_at) / (1000 * 60 * 60 * 24);
          score *= Math.exp(-ageDays / policy.halfLifeDays);
        }
      } catch {
        const ageDays = (now - row.created_at) / (1000 * 60 * 60 * 24);
        score *= Math.exp(-ageDays / policy.halfLifeDays);
      }
    }

    const fact_id = row.fact_id ?? '';
    const preview = row.text.length > 200 ? row.text.slice(0, 200) + '...' : row.text;
    return {
      id: row.id,
      fact_id,
      score,
      preview,
      created_at: row.created_at,
      source: row.source,
      type,
      importance,
    };
  });

  withScore.sort((a, b) => b.score - a.score);
  const results = withScore.slice(0, topK);
  return { results };
}
