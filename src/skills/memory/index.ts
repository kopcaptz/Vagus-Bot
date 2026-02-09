/**
 * MemorySkill — долговременная память пользователя.
 *
 * Хранит факты в data/memory/{userId}.md и в SQLite (memory_chunks) для семантического поиска.
 * memory_save: .md + ingest; memory_search / memory_get: векторный поиск.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Skill, ToolDefinition } from '../types.js';
import { initMemoryDb, getMemoryDb } from './db.js';
import { chunkText } from './chunking.js';
import { hashChunkText } from './hash.js';
import { embedTexts, setEmbeddingDim } from './embeddings.js';
import { float32ToBuffer } from './embeddingBlob.js';
import { memorySearch } from './search.js';
import { memoryGet } from './get.js';

const MEMORY_DIR = path.join(process.cwd(), 'data', 'memory');
const MAX_MEMORY_SIZE = 2000; // символов максимум при чтении

async function ingestToSemanticMemory(userId: string, fact: string, meta?: Record<string, unknown>): Promise<void> {
  initMemoryDb();
  const chunks = chunkText(fact);
  if (chunks.length === 0) return;

  let vectors: number[][];
  try {
    vectors = await embedTexts(chunks);
    if (vectors[0]) setEmbeddingDim(vectors[0].length);
  } catch (err) {
    const status = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] Embeddings failed (len=${fact.length}), .md saved only. status=${status.slice(0, 80)}`);
    return;
  }

  const source = (meta?.source as string) ?? 'manual';
  const created_at = typeof meta?.created_at === 'number' ? meta.created_at : Date.now();
  const metaJson = meta ? JSON.stringify(meta) : null;
  const db = getMemoryDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO memory_chunks (id, user_id, source, text, embedding, embedding_dim, hash, created_at, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const vec = vectors[i]!;
    const id = randomUUID();
    const hash = hashChunkText(chunk);
    const embedding = float32ToBuffer(vec);
    stmt.run(id, userId, source, chunk, embedding, vec.length, hash, created_at, metaJson);
  }
}

// Убедимся, что директория существует
function ensureMemoryDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function getMemoryPath(userId: string): string {
  // Санитизация userId: убираем всё кроме букв, цифр, дефисов, подчёркиваний
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `${safe}.md`);
}

export class MemorySkill implements Skill {
  readonly id = 'memory';
  readonly name = 'Memory';
  readonly description = 'Long-term memory for user facts';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'memory_save',
        description: 'Сохранить важный факт о пользователе в долговременную память. Используй для: имён, предпочтений, проектов, целей, важных дат. Один факт за вызов.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя (из контекста)' },
            fact: { type: 'string', description: 'Факт для запоминания (одна строка)' },
            meta: { type: 'object', description: 'Опционально: source, created_at, др.' },
          },
          required: ['userId', 'fact'],
        },
      },
      {
        name: 'memory_read',
        description: 'Прочитать все сохранённые факты о пользователе.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя' },
          },
          required: ['userId'],
        },
      },
      {
        name: 'memory_search',
        description: 'Семантический поиск по сохранённой памяти пользователя. Используй, когда нужно вспомнить прошлые решения, факты, людей, даты. Возвращает id и превью релевантных фрагментов.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя' },
            query: { type: 'string', description: 'Поисковый запрос по смыслу' },
            topK: { type: 'number', description: 'Макс. число результатов (по умолчанию 5)' },
            sinceMs: { type: 'number', description: 'Только записи после этой метки времени (unix ms)' },
          },
          required: ['userId', 'query'],
        },
      },
      {
        name: 'memory_get',
        description: 'Получить полный текст фрагментов по id из memory_search. Возвращает массив чанков (null для отсутствующих/чужих id).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя' },
            ids: { type: 'array', items: { type: 'string' }, description: 'Список id из memory_search' },
          },
          required: ['userId', 'ids'],
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    const userId = typeof args.userId === 'string' ? args.userId.trim() : '';
    if (!userId) return 'Ошибка: userId не указан.';

    switch (toolName) {
      case 'memory_save': {
        const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
        if (!fact) return 'Ошибка: пустой факт.';
        const meta = args.meta && typeof args.meta === 'object' ? (args.meta as Record<string, unknown>) : undefined;
        return this.saveFact(userId, fact, meta);
      }
      case 'memory_read': {
        return this.readMemories(userId);
      }
      case 'memory_search': {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) return 'Ошибка: query не указан.';
        const topK = typeof args.topK === 'number' ? Math.max(1, Math.min(20, args.topK)) : 5;
        const sinceMs = typeof args.sinceMs === 'number' ? args.sinceMs : 0;
        try {
          const out = await memorySearch(userId, query, topK, sinceMs);
          return JSON.stringify(out);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Ошибка memory_search: ${msg}`;
        }
      }
      case 'memory_get': {
        const ids = Array.isArray(args.ids) ? args.ids.filter((x): x is string => typeof x === 'string') : [];
        const out = memoryGet(userId, ids);
        return JSON.stringify(out);
      }
      default:
        return `Неизвестный инструмент в MemorySkill: ${toolName}`;
    }
  }

  // ============================================
  // Приватные методы
  // ============================================

  private saveFact(userId: string, fact: string, meta?: Record<string, unknown>): string {
    ensureMemoryDir();
    const filePath = getMemoryPath(userId);

    // Проверяем дублирование (как раньше)
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      const factLower = fact.toLowerCase();
      const lines = existing.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^-\s*/, '').trim().toLowerCase();
        if (cleaned && factLower.includes(cleaned)) {
          return `Факт уже сохранён: "${fact}"`;
        }
        if (cleaned && cleaned.includes(factLower)) {
          return `Похожий факт уже есть: "${line.trim()}"`;
        }
      }
    }

    // .md — всегда (совместимость)
    const line = `- ${fact}\n`;
    fs.appendFileSync(filePath, line, 'utf-8');
    console.log(`🧠 Memory saved [${userId}]: ${fact}`);

    // Ingest в SQLite (fail-soft, не блокируем ответ)
    void ingestToSemanticMemory(userId, fact, meta);

    return `Запомнено: "${fact}"`;
  }

  private readMemories(userId: string): string {
    const filePath = getMemoryPath(userId);

    if (!fs.existsSync(filePath)) {
      return 'Нет сохранённых воспоминаний.';
    }

    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return 'Нет сохранённых воспоминаний.';

    return content;
  }
}

/**
 * Загрузить воспоминания пользователя для инъекции в system prompt.
 * Вызывается из context.ts, не из AI.
 */
export function loadUserMemories(userId: string): string | null {
  const filePath = getMemoryPath(userId);

  if (!fs.existsSync(filePath)) return null;

  let content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return null;

  // Обрезаем если слишком длинное
  if (content.length > MAX_MEMORY_SIZE) {
    content = content.substring(0, MAX_MEMORY_SIZE) + '\n... (память обрезана)';
  }

  return content;
}
