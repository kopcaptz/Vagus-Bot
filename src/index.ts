import { stopBot, getBot, isTelegramEnabled } from './bot/telegram.js';
import { startWebServer } from './server/web.js';
import { config } from './config/config.js';
import { initDatabase } from './db/database.js';
import { getContextConfig } from './config/context.js';

async function main() {
  console.log('🚀 Запуск простого бота...\n');
  
  // Инициализация базы данных
  initDatabase();
  
  // Отладочная информация о конфигурации
  console.log('📋 Конфигурация:');
  console.log(`   OpenAI API Key: ${config.ai.openaiKey ? '✅ Установлен' : '❌ Не установлен'}`);
  console.log(`   Anthropic API Key: ${config.ai.anthropicKey ? '✅ Установлен' : '❌ Не установлен'}`);
  console.log(`   Telegram: ${config.telegram.enabled ? '✅ Включен' : '❌ Отключен'}`);
  
  // Информация о контекстной памяти
  const contextConfig = getContextConfig();
  console.log(`\n🧠 Контекстная память:`);
  console.log(`   Статус: ${contextConfig.enabled ? '✅ Включена' : '❌ Отключена'}`);
  if (contextConfig.enabled) {
    console.log(`   Максимум сообщений: ${contextConfig.maxMessages}`);
    console.log(`   Максимум токенов: ${contextConfig.maxTokens}`);
    console.log(`   Системный промпт: ${contextConfig.includeSystemPrompt ? '✅ Включен' : '❌ Отключен'}`);
  }
  console.log('');
  
  try {
    // 1. Сначала веб-сервер (иначе await startBot() блокирует навсегда — grammY long polling)
    await startWebServer();
    console.log('');

    // 2. Telegram бот — запускаем без await, чтобы не блокировать процесс
    if (isTelegramEnabled()) {
      const botInstance = getBot();
      if (botInstance) {
        const me = await botInstance.api.getMe();
        console.log(`🤖 Telegram бот запущен: @${me.username}`);
        // bot.start() в grammY блокирует поток; запускаем фоном
        botInstance.start().catch((err: unknown) => console.error('❌ Telegram бот:', err));
      }
    } else {
      console.log('ℹ️ Telegram бот не запущен (токен не установлен)');
    }

    console.log(`🌐 Веб-интерфейс: http://localhost:${config.server.port}\n`);
    console.log('✅ Все сервисы запущены!');

  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️ Остановка сервисов...');
  await stopBot();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏹️ Остановка сервисов...');
  await stopBot();
  process.exit(0);
});

// Запуск
main().catch(console.error);
