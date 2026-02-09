import { createHash } from 'crypto';

/**
 * Stable hash for deduplication. Normalize text (trim, collapse whitespace) then SHA-256.
 */
export function hashChunkText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
