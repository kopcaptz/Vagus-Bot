/**
 * Memory v2 — правила сохранения: валидация, классификация, лимиты.
 */

import type { FactLine, FactType, Importance, ValidationResult, PolicyConfig } from './types.js';
import { DEFAULT_POLICY } from './types.js';

const QUESTION_STARTS = [
  'найди', 'сделай', 'покажи', 'объясни', 'почему', 'как', 'когда', 'можешь', 'давай',
  'find', 'show', 'explain', 'why', 'how', 'when', 'can you', 'could you', 'what is',
];
const COMMAND_PATTERNS = [
  /\bnpm\s+install\b/i,
  /\bcd\s+/i,
  /\bnpx\s+/i,
  /сделай\s+промт/i,
  /сделай\s+промпт/i,
];
const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{20,}/i,
  /\bBearer\s+[a-zA-Z0-9_.-]+/i,
  /\b[A-Za-z0-9_-]{30,}:[A-Za-z0-9_-]+/,
];

export function validateFact(
  text: string,
  policy: PolicyConfig = DEFAULT_POLICY,
): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length < policy.minLen) {
    return { ok: false, reason: 'length' };
  }
  if (trimmed.length > policy.maxLen) {
    return { ok: false, reason: 'length' };
  }
  if (trimmed.endsWith('?')) {
    return { ok: false, reason: 'question' };
  }
  const lower = trimmed.toLowerCase();
  for (const start of QUESTION_STARTS) {
    if (lower.startsWith(start)) {
      return { ok: false, reason: 'question' };
    }
  }
  for (const re of COMMAND_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, reason: 'command' };
    }
  }
  for (const re of SECRET_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, reason: 'secret' };
    }
  }
  return { ok: true };
}

/**
 * Classify fact into type and importance; optionally set expiresAt for working.
 */
export function classifyFact(
  text: string,
  meta?: Record<string, unknown>,
  policy: PolicyConfig = DEFAULT_POLICY,
): { type: FactType; importance: Importance; expiresAt: string | null } {
  if (meta?.type === 'profile' || meta?.type === 'working' || meta?.type === 'archive') {
    const type = meta.type as FactType;
    const importance = (meta.importance as Importance) ?? (type === 'profile' ? 'high' : 'normal');
    let expiresAt: string | null = null;
    if (meta.expiresAt && typeof meta.expiresAt === 'string') expiresAt = meta.expiresAt;
    if (type === 'working' && !expiresAt) {
      const d = new Date();
      d.setDate(d.getDate() + policy.workingDefaultDays);
      expiresAt = d.toISOString().slice(0, 10);
    }
    return { type, importance, expiresAt };
  }

  const lower = text.toLowerCase();
  const profileKeywords = ['имя', 'зовут', 'я ', 'меня', 'предпочитаю', 'русский', 'английский', 'язык', 'работа', 'профессия', 'живу', 'живёт'];
  const workingKeywords = ['сейчас', 'ставим', 'чиним', 'задача', 'план', 'делаем', 'работаем над', 'текущ'];

  for (const k of profileKeywords) {
    if (lower.includes(k)) {
      return { type: 'profile', importance: 'high', expiresAt: null };
    }
  }
  for (const k of workingKeywords) {
    if (lower.includes(k)) {
      const d = new Date();
      d.setDate(d.getDate() + policy.workingDefaultDays);
      return { type: 'working', importance: 'normal', expiresAt: d.toISOString().slice(0, 10) };
    }
  }

  return { type: 'archive', importance: 'low', expiresAt: null };
}

export function getPolicy(): PolicyConfig {
  return { ...DEFAULT_POLICY };
}
