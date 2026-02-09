/**
 * WebSearchSkill — поиск актуальной информации в интернете через Tavily API.
 */

import type { Skill, ToolDefinition } from '../types.js';

export class WebSearchSkill implements Skill {
  readonly id = 'web-search';
  readonly name = 'Веб-поиск';
  readonly description = 'Поиск актуальной информации в интернете через Tavily API';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'web_search',
        description: 'Поиск в интернете актуальных новостей, фактов или документации.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Поисковый запрос' },
          },
          required: ['query'],
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (toolName !== 'web_search') {
      return `Неизвестный инструмент в WebSearchSkill: ${toolName}`;
    }

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return 'Ошибка: пустой поисковый запрос.';
    }

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return 'Ошибка: TAVILY_API_KEY не задан в .env.';
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return `Ошибка Tavily API (${response.status}): ${errText || 'неизвестная ошибка'}`;
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      // Формируем читаемый ответ
      const lines: string[] = [];

      if (data.answer) {
        lines.push(`Ответ: ${data.answer}`);
        lines.push('');
      }

      if (data.results && data.results.length > 0) {
        lines.push('Источники:');
        for (const r of data.results) {
          const title = r.title || 'Без заголовка';
          const url = r.url || '';
          const snippet = r.content ? r.content.substring(0, 200) : '';
          lines.push(`- ${title}`);
          if (url) lines.push(`  ${url}`);
          if (snippet) lines.push(`  ${snippet}...`);
        }
      }

      return lines.length > 0 ? lines.join('\n') : 'Результатов не найдено.';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Ошибка веб-поиска: ${msg}`;
    }
  }
}
