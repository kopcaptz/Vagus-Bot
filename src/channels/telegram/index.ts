/**
 * Telegram Channel Plugin
 *
 * Реализует ChannelPlugin для Telegram через grammY.
 * Вызывает routeMessage() и сам отправляет ответ через ctx.reply().
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { ChannelPlugin, OutgoingMessage, IncomingMessage } from '../types.js';
import type { ImageAttachment } from '../../ai/models.js';
import { routeMessage } from '../router.js';
import { config } from '../../config/config.js';

export class TelegramChannel implements ChannelPlugin {
  readonly id = 'telegram';
  readonly name = 'Telegram';

  private bot: Bot | null = null;

  // ============================================
  // Lifecycle
  // ============================================

  async start(): Promise<void> {
    if (!config.telegram.enabled) {
      console.log('ℹ️ Telegram канал отключён (токен не установлен)');
      return;
    }

    this.bot = new Bot(config.telegram.token);

    this.bot.on('message:text', (ctx) => this.handleText(ctx));
    this.bot.on('message:photo', (ctx) => this.handlePhoto(ctx));
    this.bot.catch((err) => console.error('❌ Telegram ошибка:', err));

    // Получаем информацию о боте
    const me = await this.bot.api.getMe();
    console.log(`🤖 Telegram бот: @${me.username}`);

    // Запускаем long polling в фоне (не await — блокирует)
    this.bot.start().catch((err: unknown) => console.error('❌ Telegram polling:', err));
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessage(msg.chatId, msg.text);
  }

  // ============================================
  // Allowlist guard
  // ============================================

  private isAllowed(ctx: Context): boolean {
    if (config.security.telegramAccessMode !== 'allowlist') return true;

    const allowlist = config.security.telegramAllowlist;
    if (allowlist.length === 0) return true; // пустой allowlist = все разрешены

    const userId = ctx.from?.id?.toString() ?? '';
    const username = ctx.from?.username ?? '';

    return allowlist.includes(userId) || allowlist.includes(`@${username}`);
  }

  // ============================================
  // Обработчики
  // ============================================

  private async handleText(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? '';
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id?.toString();
    if (!text || !chatId || !userId) return;

    // Проверка allowlist
    if (!this.isAllowed(ctx)) {
      await ctx.reply('🔒 Доступ запрещён. Обратитесь к администратору бота.');
      return;
    }

    const incoming: IncomingMessage = {
      channelId: this.id,
      chatId: chatId.toString(),
      userId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      text,
    };

    const result = await routeMessage(incoming);
    if (result) {
      // Формируем ответ с метаданными для Telegram
      let reply = `🤖 ${result.text}`;
      if (result.contextUsed && result.contextUsed > 0) {
        reply += `\n\n📚 Контекст: ${result.contextUsed} предыдущих сообщений`;
      }
      if (result.tokensUsed) {
        reply += `\n💡 Токенов: ${result.tokensUsed}`;
      }
      if (result.model) {
        reply += `\n(Модель: ${result.model})`;
      }
      await ctx.reply(reply);
    }
  }

  private async handlePhoto(ctx: Context): Promise<void> {
    const photo = ctx.message?.photo;
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id?.toString();
    if (!photo?.length || !chatId || !userId) return;

    // Проверка allowlist
    if (!this.isAllowed(ctx)) {
      await ctx.reply('🔒 Доступ запрещён. Обратитесь к администратору бота.');
      return;
    }

    const caption = ctx.message?.caption ?? '';

    try {
      // Скачиваем наибольшее фото
      const largest = photo[photo.length - 1];
      const imageAttachment = await this.downloadPhoto(largest.file_id);

      const incoming: IncomingMessage = {
        channelId: this.id,
        chatId: chatId.toString(),
        userId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        text: caption,
        images: [imageAttachment],
      };

      await ctx.reply('🤔 Смотрю изображение...');
      const result = await routeMessage(incoming);
      if (result) {
        let reply = `🤖 ${result.text}`;
        if (result.contextUsed && result.contextUsed > 0) {
          reply += `\n\n📚 Контекст: ${result.contextUsed} предыдущих сообщений`;
        }
        if (result.tokensUsed) reply += `\n💡 Токенов: ${result.tokensUsed}`;
        if (result.model) reply += `\n(Модель: ${result.model})`;
        await ctx.reply(reply);
      }
    } catch (error) {
      console.error('❌ Ошибка обработки фото:', error);
      await ctx.reply('❌ Не удалось проанализировать изображение.');
    }
  }

  // ============================================
  // Утилиты
  // ============================================

  private async downloadPhoto(fileId: string): Promise<ImageAttachment> {
    if (!this.bot) throw new Error('Бот не инициализирован');
    const file = await this.bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Не удалось скачать фото: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const mediaType = file.file_path?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { data: base64, mediaType };
  }
}
