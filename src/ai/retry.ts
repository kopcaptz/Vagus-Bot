/**
 * retry.ts — fetch с экспоненциальным backoff и поддержкой Retry-After.
 */

import { config } from '../config/config.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1000,
  retryableStatuses: [429, 500, 502, 503],
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch с автоматическим retry при transient-ошибках.
 * При 429 использует Retry-After header если есть.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: Partial<RetryOptions>,
): Promise<Response> {
  const opts: RetryOptions = {
    maxRetries: options?.maxRetries ?? config.ai.maxRetries,
    baseDelayMs: options?.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs,
    retryableStatuses: options?.retryableStatuses ?? DEFAULT_OPTIONS.retryableStatuses,
  };

  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Успех или не-retryable ошибка — возвращаем
      if (response.ok || !opts.retryableStatuses.includes(response.status)) {
        return response;
      }

      lastResponse = response;

      // Последняя попытка — возвращаем как есть
      if (attempt >= opts.maxRetries) {
        return response;
      }

      // Вычисляем задержку
      let delayMs = opts.baseDelayMs * Math.pow(2, attempt);

      // Для 429 — используем Retry-After если есть
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds) && seconds > 0) {
            delayMs = seconds * 1000;
          }
        }
      }

      console.log(`🔄 Retry ${attempt + 1}/${opts.maxRetries} после ${delayMs}ms (статус ${response.status})`);
      await sleep(delayMs);
    } catch (err) {
      lastError = err;

      // Последняя попытка — пробрасываем ошибку
      if (attempt >= opts.maxRetries) {
        throw err;
      }

      const delayMs = opts.baseDelayMs * Math.pow(2, attempt);
      console.log(`🔄 Retry ${attempt + 1}/${opts.maxRetries} после ${delayMs}ms (сетевая ошибка)`);
      await sleep(delayMs);
    }
  }

  // Если дошли сюда, возвращаем последний ответ или бросаем ошибку
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error('fetchWithRetry: all retries exhausted');
}
