/**
 * registry.ts — реестр каналов.
 *
 * Тонкий оркестратор жизненного цикла.
 * НЕ содержит логику обработки сообщений (это router.ts).
 */

import type { ChannelPlugin } from './types.js';

class ChannelRegistry {
  private channels = new Map<string, ChannelPlugin>();

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
