/**
 * memory_search: embed query, load candidates (limit N), cosine similarity, topK.
 * Guardrail: only rows where embedding_dim == query_dim; limit candidates (e.g. 5000).
 */

import { getMemoryDb } from './db.js';
import { embedQuery, getEmbeddingDim } from './embeddings.js';
import { bufferToFloat32 } from './embeddingBlob.js';

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

export interface SearchResult {
  id: string;
  score: number;
  preview: string;
  created_at: number;
  source: string;
}

export async function memorySearch(
  userId: string,
  query: string,
  topK: number = 5,
  sinceMs: number = 0,
): Promise<{ results: SearchResult[] }> {
  const queryVec = await embedQuery(query);
  const queryDim = queryVec.length;

  const db = getMemoryDb();
  const rows = db.prepare(
    `SELECT id, text, embedding, embedding_dim, created_at, source
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
  }>;

  const withScore = rows.map((row) => {
    const vec = bufferToFloat32(row.embedding, row.embedding_dim);
    const score = cosineSimilarity(queryVec, vec);
    const preview = row.text.length > 200 ? row.text.slice(0, 200) + '...' : row.text;
    return {
      id: row.id,
      score,
      preview,
      created_at: row.created_at,
      source: row.source,
    };
  });

  withScore.sort((a, b) => b.score - a.score);
  const results = withScore.slice(0, topK);

  return { results };
}
