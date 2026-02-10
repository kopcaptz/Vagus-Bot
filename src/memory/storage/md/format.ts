/**
 * Memory v2 — формат строки факта в .md и парсинг.
 *
 * Format: - [id:pf_001] [t:profile] [imp:high] Text body.
 * Optional: [exp:YYYY-MM-DD] for working.
 */

import type { FactLine, FactType, Importance } from '../../types.js';

const TAG_REG = /\[([a-z]+):([^\]]+)\]/g;

function parseTags(line: string): Record<string, string> {
  const tags: Record<string, string> = {};
  let m: RegExpExecArray | null;
  TAG_REG.lastIndex = 0;
  while ((m = TAG_REG.exec(line)) !== null) {
    tags[m[1]!] = m[2]!;
  }
  return tags;
}

/**
 * Extract fact body (text after all tags). Tags are [key:value].
 */
function extractBody(line: string): string {
  const withoutBullet = line.replace(/^\s*-\s*/, '').trim();
  const withoutTags = withoutBullet.replace(TAG_REG, '').trim();
  return withoutTags.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a single .md line into FactLine or null if not a valid fact line.
 */
export function parseFactLine(line: string): FactLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return null;

  const tags = parseTags(trimmed);
  const id = tags['id'];
  const type = tags['t'] as FactType | undefined;
  const imp = tags['imp'] as Importance | undefined;
  const exp = tags['exp'];
  const text = extractBody(trimmed);

  if (!id || !type || !imp) return null;
  if (type !== 'profile' && type !== 'working' && type !== 'archive') return null;
  if (imp !== 'high' && imp !== 'normal' && imp !== 'low') return null;

  return {
    id,
    type,
    importance: imp,
    expiresAt: exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null,
    text,
  };
}

/**
 * Parse a legacy line (old format: "- text only") as archive fact with generated id.
 */
export function parseLegacyFactLine(line: string, generatedId: string): FactLine {
  const trimmed = line.trim();
  const text = trimmed.replace(/^\s*-\s*/, '').trim();
  return {
    id: generatedId,
    type: 'archive',
    importance: 'low',
    expiresAt: null,
    text: text || '(empty)',
  };
}

/**
 * Format FactLine to .md line string.
 */
export function formatFactLine(fact: FactLine): string {
  const parts = [`[id:${fact.id}]`, `[t:${fact.type}]`, `[imp:${fact.importance}]`];
  if (fact.expiresAt) parts.push(`[exp:${fact.expiresAt}]`);
  return `- ${parts.join(' ')} ${fact.text}\n`;
}
