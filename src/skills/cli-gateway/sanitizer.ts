/**
 * sanitizer.ts — замена секретов в stdout/stderr на [REDACTED] перед логированием и ответом.
 */

const REDACTED = '[REDACTED]';
const MAX_OUTPUT_CHARS = 64 * 1024;

const PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Key-value secrets
  { pattern: /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)\s*[=:]\s*['"]?[\w\-\.]{8,}['"]?/gi, description: 'key=value secret' },
  // Bearer tokens
  { pattern: /\bBearer\s+[a-zA-Z0-9_.-]+\b/gi, description: 'Bearer' },
  // AWS Access Key
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, description: 'AWS access key' },
  // GitHub PAT (classic & fine-grained)
  { pattern: /\bghp_[A-Za-z0-9_]{36}\b/g, description: 'GitHub PAT classic' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, description: 'GitHub PAT fine-grained' },
  // OpenAI / OpenRouter keys
  { pattern: /\bsk-[A-Za-z0-9\-]{20,}\b/g, description: 'sk-* key' },
  // ENV style secrets
  { pattern: /\b[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+\b/g, description: 'ENV secret' },
  // Private keys (multi-line)
  { pattern: /-----BEGIN\s[\w\s]+KEY-----[\s\S]*?-----END\s[\w\s]+KEY-----/g, description: 'private key block' },
  // Connection strings
  { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi, description: 'connection string' },
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
  if (out.length > MAX_OUTPUT_CHARS) {
    const suffix = '\n[TRUNCATED: output exceeds 64KB]';
    out = out.slice(0, MAX_OUTPUT_CHARS - suffix.length) + suffix;
  }
  return out;
}
