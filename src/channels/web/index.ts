/**
 * Web Channel Plugin
 *
 * Тонкая обёртка для веб-интерфейса.
 * Web — это request/response канал: Express роуты в api.ts
 * вызывают routeMessage() напрямую и возвращают результат через res.json().
 * Этот плагин нужен только для регистрации в реестре.
 */

import type { ChannelPlugin, OutgoingMessage } from '../types.js';

export class WebChannel implements ChannelPlugin {
  readonly id = 'web';
  readonly name = 'Web';

  async start(): Promise<void> {
    // No-op: Express сервер уже запущен, роуты монтируются в api.ts
    console.log('🌐 Web канал активен (API-роуты)');
  }

  async stop(): Promise<void> {
    // No-op
  }

  async sendMessage(_msg: OutgoingMessage): Promise<void> {
    // No-op: Web — request/response, не push
  }
}
