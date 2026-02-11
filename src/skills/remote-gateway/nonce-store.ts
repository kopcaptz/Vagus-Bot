import crypto from 'crypto';
import { config } from '../../config/config.js';

/**
 * Keeps nonce values for TTL window to prevent accidental replay.
 * This is used client-side by gateway to guarantee nonce uniqueness.
 */
export class NonceStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlSeconds: number = config.skillGateway.nonceTtlSeconds) {}

  private cleanup(now = Date.now()): void {
    for (const [nonce, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(nonce);
    }
  }

  create(): string {
    this.cleanup();
    let nonce = crypto.randomBytes(16).toString('hex');
    while (this.seen.has(nonce)) {
      nonce = crypto.randomBytes(16).toString('hex');
    }
    this.seen.set(nonce, Date.now() + this.ttlSeconds * 1000);
    return nonce;
  }

  has(nonce: string): boolean {
    this.cleanup();
    return this.seen.has(nonce);
  }

  assertTimestampWithinSkew(timestampMs: number, nowMs: number = Date.now()): void {
    const skewMs = config.skillGateway.timestampSkewSeconds * 1000;
    if (Math.abs(nowMs - timestampMs) > skewMs) {
      throw new Error(`NONCE_REPLAY: timestamp out of skew window (${config.skillGateway.timestampSkewSeconds}s)`);
    }
  }
}
