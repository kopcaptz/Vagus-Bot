/**
 * Embeddings client — OpenAI-compatible HTTP API.
 * Uses fetchWithRetry; no secrets in logs.
 */

import { config } from '../../config/config.js';
import { fetchWithRetry } from '../../ai/retry.js';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = config.embeddings.apiKey;
  if (!apiKey) {
    throw new Error('EMBEDDINGS_API_KEY (or OPENROUTER_API_KEY) not set');
  }
  const baseUrl = (config.embeddings.baseUrl || '').replace(/\/$/, '');
  const url = `${baseUrl}/embeddings`;
  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.embeddings.model,
        input: texts.length === 1 ? texts[0] : texts,
      }),
      signal: AbortSignal.timeout(config.embeddings.timeoutMs),
    },
    { maxRetries: 2 },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Embeddings API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  const list = data?.data;
  if (!Array.isArray(list) || list.length !== texts.length) {
    throw new Error('Embeddings API: unexpected response shape');
  }
  const vectors = list.map((d) => d.embedding);
  if (vectors[0] && cachedDim === null) {
    cachedDim = vectors[0].length;
  }
  return vectors;
}

export async function embedQuery(query: string): Promise<number[]> {
  const vectors = await embedTexts([query]);
  return vectors[0]!;
}

/** Dimension of the configured model (from first successful call). */
let cachedDim: number | null = null;

export function getEmbeddingDim(): number | null {
  return cachedDim;
}

export function setEmbeddingDim(dim: number): void {
  cachedDim = dim;
}
