/**
 * Telegram Channel Plugin
 *
 * Реализует ChannelPlugin для Telegram через grammY.
 * Вызывает registry.handleMessage() и сам отправляет ответ через ctx.reply().
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { ChannelPlugin, OutgoingMessage, IncomingMessage, AccessRole } from '../types.js';
import type { ImageAttachment } from '../../ai/models.js';
import { channelRegistry } from '../registry.js';
import { config } from '../../config/config.js';

const TG_MAX_LENGTH = 4000; // margin below Telegram's 4096 limit

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
    const chunks = splitMessage(msg.text);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(msg.chatId, chunk);
    }
  }

  // ============================================
  // Allowlist guard
  // ============================================

  private isIdentityListed(list: string[], userId: string, username?: string): boolean {
    if (!list.length) return false;

    const normalizedUsername = username
      ? `@${username.replace(/^@/, '').toLowerCase()}`
      : '';

    return list.some((item) => {
      const normalizedItem = item.startsWith('@')
        ? `@${item.replace(/^@/, '').toLowerCase()}`
        : item;

      return normalizedItem === userId || (!!normalizedUsername && normalizedItem === normalizedUsername);
    });
  }

  private getAccessRole(ctx: Context): AccessRole {
    const owners = config.security.telegramOwners;
    if (owners.length === 0) return 'owner';

    const userId = ctx.from?.id?.toString() ?? '';
    const username = ctx.from?.username;
    return this.isIdentityListed(owners, userId, username) ? 'owner' : 'guest';
  }

  private isAllowed(ctx: Context): boolean {
    if (config.security.telegramAccessMode !== 'allowlist') return true;

    const allowlist = config.security.telegramAllowlist;
    if (allowlist.length === 0) return true;

    const userId = ctx.from?.id?.toString() ?? '';
    const username = ctx.from?.username;

    return this.isIdentityListed(allowlist, userId, username);
  }

  // ============================================
  // Message splitter
  // ============================================

  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  }

  // ============================================
  // Обработчики
  // ============================================

  private async handleText(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? '';
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id?.toString();
    if (!text || !chatId || !userId) return;

    if (!this.isAllowed(ctx)) {
      await ctx.reply('🔒 Доступ запрещён. Обратитесь к администратору бота.');
      return;
    }
    const accessRole = this.getAccessRole(ctx);

    // Отправляем статусное сообщение, которое будем обновлять
    const statusMsg = await ctx.reply('🤔 Думаю...');
    const onStatus = async (status: string) => {
      try {
        await ctx.api.editMessageText(chatId!, statusMsg.message_id, `⏳ ${status}`);
      } catch { /* ignore edit failures */ }
    };

    const incoming: IncomingMessage = {
      channelId: this.id,
      chatId: chatId.toString(),
      userId,
      accessRole,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      text,
      onStatus,
    };

    const result = await channelRegistry.handleMessage(incoming);

    // Удаляем статусное сообщение
    try { await ctx.api.deleteMessage(chatId!, statusMsg.message_id); } catch {}

    if (result) {
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
      await this.sendLongMessage(ctx, reply);
    }
  }

  private async handlePhoto(ctx: Context): Promise<void> {
    const photo = ctx.message?.photo;
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id?.toString();
    if (!photo?.length || !chatId || !userId) return;

    if (!this.isAllowed(ctx)) {
      await ctx.reply('🔒 Доступ запрещён. Обратитесь к администратору бота.');
      return;
    }
    const accessRole = this.getAccessRole(ctx);

    const caption = ctx.message?.caption ?? '';

    try {
      const largest = photo[photo.length - 1];
      const imageAttachment = await this.downloadPhoto(largest.file_id);

      const statusMsg = await ctx.reply('🤔 Смотрю изображение...');
      const onStatus = async (status: string) => {
        try {
          await ctx.api.editMessageText(chatId!, statusMsg.message_id, `⏳ ${status}`);
        } catch { /* ignore */ }
      };

      const incoming: IncomingMessage = {
        channelId: this.id,
        chatId: chatId.toString(),
        userId,
        accessRole,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        text: caption,
        images: [imageAttachment],
        onStatus,
      };

      const result = await channelRegistry.handleMessage(incoming);

      try { await ctx.api.deleteMessage(chatId!, statusMsg.message_id); } catch {}

      if (result) {
        let reply = `🤖 ${result.text}`;
        if (result.contextUsed && result.contextUsed > 0) {
          reply += `\n\n📚 Контекст: ${result.contextUsed} предыдущих сообщений`;
        }
        if (result.tokensUsed) reply += `\n💡 Токенов: ${result.tokensUsed}`;
        if (result.model) reply += `\n(Модель: ${result.model})`;
        await this.sendLongMessage(ctx, reply);
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

// ============================================
// Утилита: разбивка длинного текста
// ============================================

function splitMessage(text: string): string[] {
  if (text.length <= TG_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TG_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Ищем точку разрыва: сначала двойной перенос, потом одинарный, потом hard cut
    let cutIndex = remaining.lastIndexOf('\n\n', TG_MAX_LENGTH);
    if (cutIndex < TG_MAX_LENGTH * 0.3) {
      cutIndex = remaining.lastIndexOf('\n', TG_MAX_LENGTH);
    }
    if (cutIndex < TG_MAX_LENGTH * 0.3) {
      cutIndex = TG_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, cutIndex));
    remaining = remaining.slice(cutIndex).trimStart();
  }

  return chunks;
}
