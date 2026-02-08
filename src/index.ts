import { channelRegistry } from './channels/registry.js';
import { TelegramChannel } from './channels/telegram/index.js';
import { WebChannel } from './channels/web/index.js';
import { skillRegistry } from './skills/registry.js';
import { CoreSkill } from './skills/core/index.js';
import { startWebServer } from './server/web.js';
import { config } from './config/config.js';
import { initDatabase } from './db/database.js';
import { getContextConfig } from './config/context.js';

async function main() {
  console.log('🚀 Запуск Vagus Bot...\n');

  // Инициализация базы данных
  initDatabase();

  // Отладочная информация
  console.log('📋 Конфигурация:');
  console.log(`   OpenAI API Key: ${config.ai.openaiKey ? '✅ Установлен' : '❌ Не установлен'}`);
  console.log(`   Anthropic API Key: ${config.ai.anthropicKey ? '✅ Установлен' : '❌ Не установлен'}`);
  console.log(`   Telegram: ${config.telegram.enabled ? '✅ Включен' : '❌ Отключен'}`);

  // Контекстная память
  const contextConfig = getContextConfig();
  console.log(`\n🧠 Контекстная память:`);
  console.log(`   Статус: ${contextConfig.enabled ? '✅ Включена' : '❌ Отключена'}`);
  if (contextConfig.enabled) {
    console.log(`   Макс. сообщений: ${contextConfig.maxMessages}`);
    console.log(`   Макс. токенов: ${contextConfig.maxTokens}`);
  }

  // Безопасность
  console.log(`\n🔒 Безопасность:`);
  console.log(`   Web-панель: ${config.security.adminToken ? '✅ Защищена (ADMIN_TOKEN)' : '⚠️ Открыта (ADMIN_TOKEN не задан)'}`);
  console.log(`   Telegram: ${config.security.telegramAccessMode === 'allowlist' ? `✅ Allowlist (${config.security.telegramAllowlist.length} записей)` : '🌐 Открыт (open)'}`);

  // Skills
  if (config.tools.enabled) {
    skillRegistry.register(new CoreSkill());
    console.log(`\n🔧 Skills: ${skillRegistry.list().map(s => s.name).join(', ')}`);
  } else {
    console.log('\n🔧 Skills: отключены (TOOLS_ENABLED=false)');
  }

  console.log('');

  try {
    // 1. Регистрируем каналы
    channelRegistry.register(new WebChannel());
    if (config.telegram.enabled) {
      channelRegistry.register(new TelegramChannel());
    }

    // 2. Запускаем веб-сервер (Express + API роуты)
    await startWebServer();
    console.log('');

    // 3. Запускаем все каналы (Telegram polling и т.п.)
    await channelRegistry.startAll();

    console.log(`\n🌐 Веб-интерфейс: http://localhost:${config.server.port}`);
    console.log('✅ Все сервисы запущены!\n');
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️ Остановка сервисов...');
  await channelRegistry.stopAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏹️ Остановка сервисов...');
  await channelRegistry.stopAll();
  process.exit(0);
});

main().catch(console.error);
