/**
 * MemorySkill — долговременная память (Memory v2 API).
 *
 * memory_save, memory_read, memory_forget, memory_update — через memory v2.
 * memory_search / memory_get — векторный поиск (тот же SQLite с fact_id).
 */

import type { Skill, ToolDefinition } from '../types.js';
import { saveFact, readMemories, forgetFact, updateFact, memorySearchWithFactId } from '../../memory/index.js';
import { memoryGet } from './get.js';

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
            meta: { type: 'object', description: 'Опционально: type (profile|working|archive), importance, source, created_at' },
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
      {
        name: 'memory_forget',
        description: 'Удалить факт из памяти по id (например pf_xxx) или по фрагменту текста/запросу. Используй, когда пользователь просит забыть что-то.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя' },
            queryOrId: { type: 'string', description: 'ID факта (pf_xxx, wk_xxx, ar_xxx) или текст/запрос для поиска факта к удалению' },
          },
          required: ['userId', 'queryOrId'],
        },
      },
      {
        name: 'memory_update',
        description: 'Обновить текст факта по id или по запросу. Найди факт и замени его текст на newText.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'ID пользователя' },
            idOrQuery: { type: 'string', description: 'ID факта или запрос для поиска' },
            newText: { type: 'string', description: 'Новый текст факта' },
          },
          required: ['userId', 'idOrQuery', 'newText'],
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
        const result = await saveFact(userId, fact, meta);
        if (result.ok) return `Запомнено: "${fact}" (id=${result.factId}, type=${result.type})`;
        return `Не сохранено: ${result.reason}. ${fact.length > 60 ? fact.slice(0, 60) + '...' : fact}`;
      }
      case 'memory_read': {
        return await readMemories(userId);
      }
      case 'memory_search': {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) return 'Ошибка: query не указан.';
        const topK = typeof args.topK === 'number' ? Math.max(1, Math.min(20, args.topK)) : 5;
        const sinceMs = typeof args.sinceMs === 'number' ? args.sinceMs : 0;
        try {
          const { results } = await memorySearchWithFactId(userId, query, topK, sinceMs, true);
          const out = {
            results: results.map((r) => ({
              id: r.id,
              fact_id: r.fact_id || undefined,
              score: r.score,
              preview: r.preview,
              created_at: r.created_at,
              source: r.source,
            })),
          };
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
      case 'memory_forget': {
        const queryOrId = typeof args.queryOrId === 'string' ? args.queryOrId.trim() : '';
        if (!queryOrId) return 'Ошибка: укажите queryOrId (id факта или текст для поиска).';
        const result = await forgetFact(userId, queryOrId);
        if (result.ok) return `Удалено: ${result.deleted}`;
        return `Не удалено: ${result.reason}`;
      }
      case 'memory_update': {
        const idOrQuery = typeof args.idOrQuery === 'string' ? args.idOrQuery.trim() : '';
        const newText = typeof args.newText === 'string' ? args.newText.trim() : '';
        if (!idOrQuery || !newText) return 'Ошибка: укажите idOrQuery и newText.';
        const result = await updateFact(userId, idOrQuery, newText);
        if (result.ok) return `Обновлено: ${result.factId}`;
        return `Не обновлено: ${result.reason}`;
      }
      default:
        return `Неизвестный инструмент в MemorySkill: ${toolName}`;
    }
  }
}
