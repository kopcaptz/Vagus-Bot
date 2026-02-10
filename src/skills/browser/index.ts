/**
 * BrowserSkill — Глаза в интернете.
 *
 * Загружает веб-страницу, извлекает контент через Readability,
 * конвертирует в Markdown через Turndown.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import type { Skill, ToolDefinition } from '../types.js';
import { safeFetch } from './ssrf.js';

const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_OUTPUT = 10000; // символов в ответе
const FETCH_TIMEOUT = 15000; // 15 секунд

export class BrowserSkill implements Skill {
  readonly id = 'browser';
  readonly name = 'Web Reader';
  readonly description = 'Чтение веб-страниц и извлечение контента в Markdown';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'web_fetch',
        description: 'Загрузить веб-страницу и извлечь её содержимое как чистый Markdown. Используй для чтения статей, документации, Википедии, GitHub README.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL страницы для загрузки' },
          },
          required: ['url'],
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (toolName !== 'web_fetch') {
      return `Неизвестный инструмент в BrowserSkill: ${toolName}`;
    }

    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return 'Ошибка: URL не указан.';

    // Валидация URL
    try {
      new URL(url);
    } catch {
      return `Ошибка: некорректный URL: ${url}`;
    }

    try {
      return await this.fetchAndParse(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('forbidden') || msg.includes('Access to private IP')) {
        return `Ошибка: доступ к локальным адресам запрещён (${msg}).`;
      }
      return `Ошибка загрузки: ${msg}`;
    }
  }

  private async fetchAndParse(url: string): Promise<string> {
    // Загрузка HTML с защитой от SSRF
    const response = await safeFetch(url, {
      headers: {
        'User-Agent': 'VagusBot/1.0 (Readability)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });

    if (!response.ok) {
      return `Ошибка HTTP ${response.status}: ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      // Для не-HTML просто возвращаем текст
      const text = await response.text();
      return text.length > MAX_OUTPUT
        ? text.substring(0, MAX_OUTPUT) + '\n\n... (обрезано)'
        : text;
    }

    // Ограничение размера
    const html = await this.readLimited(response);

    // Парсинг через linkedom
    const { document } = parseHTML(html);

    // Извлечение контента через Readability
    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article || !article.content) {
      // Fallback: вернуть text content
      const fallback = document.body?.textContent?.trim() ?? '';
      if (!fallback) return 'Не удалось извлечь контент со страницы.';
      const text = fallback.substring(0, MAX_OUTPUT);
      return `Title: ${document.title || 'Untitled'}\n\n${text}`;
    }

    // Конвертация HTML -> Markdown
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    let markdown = turndown.turndown(article.content);

    // Обрезка
    if (markdown.length > MAX_OUTPUT) {
      markdown = markdown.substring(0, MAX_OUTPUT) + '\n\n... (контент обрезан)';
    }

    return `Title: ${article.title}\n\n${markdown}`;
  }

  private async readLimited(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return await response.text();

    const decoder = new TextDecoder();
    let html = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.length > MAX_HTML_SIZE) {
        reader.cancel();
        break;
      }
    }

    return html;
  }
}
