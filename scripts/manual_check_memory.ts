/**
 * Ручная проверка Memory v2: миграция, сохранение, чтение, забывание.
 *
 * Запуск из корня simple-bot:
 *   npx tsx scripts/manual_check_memory.ts [userId]
 *
 * Пример:
 *   npx tsx scripts/manual_check_memory.ts test-user
 */

import { runMigrationIfNeeded } from '../src/memory/migration.js';
import { saveFact, readMemories, forgetFact } from '../src/memory/index.js';

const userId = process.argv[2]?.trim() || 'test-user';

async function main() {
  console.log('Memory v2 manual check for userId:', userId);
  console.log('');

  const migrated = await runMigrationIfNeeded(userId);
  console.log('Migration run:', migrated ? 'yes (legacy → v2)' : 'no (already v2 or no legacy)');
  console.log('');

  const toSave = 'Пользователь предпочитает русский язык.';
  const saveResult = await saveFact(userId, toSave);
  console.log('Save result:', saveResult.ok ? `ok factId=${saveResult.factId} type=${saveResult.type}` : `rejected: ${saveResult.reason}`);
  console.log('');

  const content = await readMemories(userId);
  console.log('Read memories (first 500 chars):', content.slice(0, 500));
  console.log('');

  if (saveResult.ok && saveResult.factId) {
    const forgetResult = await forgetFact(userId, saveResult.factId);
    console.log('Forget by id:', forgetResult.ok ? `deleted ${forgetResult.deleted}` : forgetResult.reason);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
