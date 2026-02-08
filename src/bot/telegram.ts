import { Bot } from 'grammy';
import { config } from '../config/config.js';
import { handleMessage, handlePhotoMessage, handleError } from './handlers.js';

let bot: Bot | null = null;

export function isTelegramEnabled(): boolean {
  return config.telegram.enabled;
}

export function getBot(): Bot | null {
  if (!config.telegram.enabled) {
    return null;
  }

  if (!bot) {
    bot = new Bot(config.telegram.token);

    bot.on('message:text', handleMessage);
    bot.on('message:photo', handlePhotoMessage);

    bot.catch(handleError);

    console.log('✅ Telegram бот инициализирован');
  }

  return bot;
}

export async function startBot(): Promise<boolean> {
  if (!config.telegram.enabled) {
    console.log('ℹ️ Telegram бот отключен (токен не установлен)');
    return false;
  }
  
  try {
    const botInstance = getBot();
    if (botInstance) {
      await botInstance.start();
      console.log('🚀 Telegram бот запущен!');
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Ошибка запуска Telegram бота:', error);
    return false;
  }
}

export async function stopBot() {
  if (bot) {
    await bot.stop();
    console.log('⏹️ Telegram бот остановлен');
  }
}
