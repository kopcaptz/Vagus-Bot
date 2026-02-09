/**
 * registry.ts — реестр каналов.
 *
 * Тонкий оркестратор жизненного цикла.
 * handleMessage() делегирует в router.routeMessage().
 */

import type { ChannelPlugin, IncomingMessage, MessageResult } from './types.js';
import { routeMessage } from './router.js';

class ChannelRegistry {
  private channels = new Map<string, ChannelPlugin>();

  /**
   * Обработать входящее сообщение (сохранить user/session/messages, команды, AI, вернуть ответ).
   * Каналы вызывают этот метод вместо прямого вызова routeMessage().
   */
  async handleMessage(msg: IncomingMessage): Promise<MessageResult | null> {
    return routeMessage(msg);
  }

  /** Зарегистрировать канал */
  register(plugin: ChannelPlugin): void {
    if (this.channels.has(plugin.id)) {
      console.warn(`⚠️ Канал "${plugin.id}" уже зарегистрирован, перезаписываю`);
    }
    this.channels.set(plugin.id, plugin);
    console.log(`📌 Канал зарегистрирован: ${plugin.name} (${plugin.id})`);
  }

  /** Получить канал по ID */
  get(id: string): ChannelPlugin | undefined {
    return this.channels.get(id);
  }

  /** Список всех зарегистрированных каналов */
  list(): ChannelPlugin[] {
    return Array.from(this.channels.values());
  }

  /** Запустить все каналы */
  async startAll(): Promise<void> {
    for (const plugin of this.channels.values()) {
      try {
        await plugin.start();
        console.log(`✅ Канал запущен: ${plugin.name}`);
      } catch (error) {
        console.error(`❌ Ошибка запуска канала ${plugin.name}:`, error);
      }
    }
  }

  /** Остановить все каналы */
  async stopAll(): Promise<void> {
    for (const plugin of this.channels.values()) {
      try {
        await plugin.stop();
        console.log(`⏹️ Канал остановлен: ${plugin.name}`);
      } catch (error) {
        console.error(`❌ Ошибка остановки канала ${plugin.name}:`, error);
      }
    }
  }
}

/** Единственный экземпляр реестра */
export const channelRegistry = new ChannelRegistry();
