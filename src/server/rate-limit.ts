/**
 * rate-limit.ts — скользящее окно, per-user rate limiter.
 *
 * In-memory, без внешних зависимостей.
 */

export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  /** Проверить, разрешён ли запрос. true = ОК, false = лимит */
  check(userId: string): boolean {
    const now = Date.now();
    const timestamps = this.windows.get(userId) ?? [];
    const valid = timestamps.filter(t => t > now - this.windowMs);

    if (valid.length >= this.maxRequests) {
      this.windows.set(userId, valid);
      return false;
    }

    valid.push(now);
    this.windows.set(userId, valid);
    return true;
  }

  /** Очистить устаревшие записи (вызывать периодически) */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter(t => t > now - this.windowMs);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}

export const userRateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_MAX ?? '20', 10),
  parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
);
