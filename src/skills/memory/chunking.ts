/**
 * Chunk text by paragraphs with max chunk size. Normalize whitespace.
 */

const DEFAULT_MAX_CHARS = 1000;
const MIN_CHUNK = 100;

export function chunkText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const paragraphs = normalized.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (current.length + p.length + 1 <= maxChars) {
      current = current ? `${current} ${p}` : p;
    } else {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (p.length > maxChars) {
        for (let i = 0; i < p.length; i += maxChars) {
          chunks.push(p.slice(i, i + maxChars));
        }
      } else {
        current = p;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks.filter((c) => c.length >= MIN_CHUNK || chunks.length === 1);
}
