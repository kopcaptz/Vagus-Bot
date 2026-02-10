/**
 * sanitizer.ts — замена секретов в stdout/stderr на [REDACTED] перед логированием и ответом.
 */

const REDACTED = '[REDACTED]';

const PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // OpenAI / API keys
  { pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/gi, description: 'sk-...' },
  // Bearer tokens
  { pattern: /\bBearer\s+[a-zA-Z0-9_.-]+\b/gi, description: 'Bearer' },
  // Long hex strings (e.g. tokens, hashes) — 32+ hex chars
  { pattern: /\b[a-fA-F0-9]{32,}\b/g, description: 'hex' },
  // Generic "key:value" long secrets
  { pattern: /\b[A-Za-z0-9_-]{30,}:[A-Za-z0-9_-]+\b/g, description: 'key:value' },
];

/**
 * Заменяет в строке последовательности, похожие на ключи/токены, на [REDACTED].
 * Применять к stdout/stderr перед логированием и перед возвратом в ответе.
 */
export function scrubSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { pattern } of PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}
