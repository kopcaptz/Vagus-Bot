const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)\s*[=:]\s*['"]?[\w\-\.]{8,}['"]?/gi,
  /Bearer\s+[\w\-\.]+/gi,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9_]{36}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /sk-[A-Za-z0-9\-]{20,}/g,
  /[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/g,
  /-----BEGIN\s[\w\s]+KEY-----[\s\S]*?-----END\s[\w\s]+KEY-----/g,
];

export function scrubText(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function scrubObjectForLog(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return scrubText(raw).slice(0, 1000);
}
