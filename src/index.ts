import fs from 'fs';
import path from 'path';
import { channelRegistry } from './channels/registry.js';
import { TelegramChannel } from './channels/telegram/index.js';
import { WebChannel } from './channels/web/index.js';
import { skillRegistry } from './skills/registry.js';
import { CoreSkill } from './skills/core/index.js';
import { DriveSkill } from './skills/drive/index.js';
import { WebSearchSkill } from './skills/web-search/index.js';
import { MemorySkill } from './skills/memory/index.js';
import { SandboxSkill } from './skills/sandbox/index.js';
import { BrowserSkill } from './skills/browser/index.js';
import { CliGatewaySkill } from './skills/cli-gateway/index.js';
import { startWebServer } from './server/web.js';
import { config, ensureDefaultModel, getSelectedModel } from './config/config.js';
import { initDatabase } from './db/database.js';
import { getContextConfig } from './config/context.js';
import { userRateLimiter } from './server/rate-limit.js';
import { runCleanup } from './memory/jobs/cleanup.js';

async function main() {
  console.log('🚀 Запуск Vagus Bot...\n');

  // Инициализация базы данных
  initDatabase();
  // Memory v2: удаление истёкших working фактов при старте
  runCleanup();
  // Модель по умолчанию (DEFAULT_MODEL), чтобы бот работал сразу без выбора в веб-интерфейсе
  ensureDefaultModel();

  // Отладочная информация
  console.log('📋 Конфигурация:');
  console.log(`   OpenRouter API Key: ${config.ai.openrouterKey ? '✅ Установлен' : '❌ Не установлен'}`);
  console.log(`   Модель: ${getSelectedModel()}`);
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
  console.log(`   Web API: ${config.security.adminToken ? '✅ Защищен (ADMIN_TOKEN задан)' : '⛔ Заблокирован (ADMIN_TOKEN не задан)'}`);
  console.log(`   Telegram: ${config.security.telegramAccessMode === 'allowlist' ? `✅ Allowlist (${config.security.telegramAllowlist.length} записей)` : '🌐 Открыт (open)'}`);
  if (config.security.telegramOwner) {
    console.log(`   Telegram хозяин: ✅ ${config.security.telegramOwner} (гости: ${config.security.telegramGuestMode})`);
  }

  // Skills
  // Memory — всегда активна (core functionality)
  skillRegistry.register(new MemorySkill());

  if (config.tools.enabled) {
    skillRegistry.register(new CoreSkill());
    skillRegistry.register(new SandboxSkill());
    skillRegistry.register(new BrowserSkill());
    skillRegistry.register(new CliGatewaySkill());
    if (process.env.TAVILY_API_KEY) {
      skillRegistry.register(new WebSearchSkill());
    }
  }
  const driveRoot = config.drive.root;
  const resolvedDriveRoot = path.resolve(driveRoot);
  console.log('Checking path:', resolvedDriveRoot);
  console.log('Path exists:', fs.existsSync(resolvedDriveRoot));
  if (process.env.DRIVE_ROOT || (driveRoot && fs.existsSync(resolvedDriveRoot) && fs.statSync(resolvedDriveRoot).isDirectory())) {
    skillRegistry.register(new DriveSkill());
  }
  if (process.env.DRIVE_ROOT || driveRoot) {
    if (!fs.existsSync(resolvedDriveRoot)) {
      console.warn('WARNING: Drive root path is set but does not exist or is not a directory. Check the path (e.g. G: drive mounted, "Мой диск" folder present).');
    } else if (!fs.statSync(resolvedDriveRoot).isDirectory()) {
      console.warn('WARNING: Drive root path is not a directory.');
    } else {
      console.log('Drive (absolute path for all drive_* reads/writes):', resolvedDriveRoot);
    }
  }
  console.log(`\n🔧 Skills: ${skillRegistry.list().map(s => s.name).join(', ') || 'отключены'}`);

  console.log('');

  try {
    // 1. Регистрируем каналы (Telegram start() — no-op, если токен не задан)
    channelRegistry.register(new WebChannel());
    channelRegistry.register(new TelegramChannel());

    // 2. Запускаем веб-сервер (Express + API роуты)
    await startWebServer();
    console.log('');

    // 3. Запускаем все каналы (Telegram polling и т.п.)
    await channelRegistry.startAll();

    // 4. Периодическая очистка rate limiter
    setInterval(() => userRateLimiter.cleanup(), 60000);

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
