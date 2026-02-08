// Тестирование функций базы данных
import { saveMessage, createOrUpdateUser, createOrUpdateSession, getMessageHistory, getDatabaseStats, getAllUsers } from './src/db/queries.ts';

console.log('🧪 Тестирование базы данных...\n');

// 1. Создаем тестового пользователя
console.log('1️⃣ Создание пользователя...');
createOrUpdateUser({
  user_id: 'test_user_123',
  username: 'test_user',
  first_name: 'Тест',
  last_name: 'Пользователь',
});
console.log('✅ Пользователь создан\n');

// 2. Создаем сессию
console.log('2️⃣ Создание сессии...');
createOrUpdateSession({
  chat_id: 'test_chat_456',
  user_id: 'test_user_123',
});
console.log('✅ Сессия создана\n');

// 3. Сохраняем несколько сообщений
console.log('3️⃣ Сохранение сообщений...');

saveMessage({
  chat_id: 'test_chat_456',
  user_id: 'test_user_123',
  username: 'test_user',
  message_text: 'Привет, бот!',
  is_bot: false,
});

saveMessage({
  chat_id: 'test_chat_456',
  user_id: 'bot',
  username: 'bot',
  message_text: 'Привет! Как дела?',
  is_bot: true,
});

saveMessage({
  chat_id: 'test_chat_456',
  user_id: 'test_user_123',
  username: 'test_user',
  message_text: 'Отлично! Тестируем базу данных.',
  is_bot: false,
});

saveMessage({
  chat_id: 'test_chat_456',
  user_id: 'bot',
  username: 'bot',
  message_text: 'Супер! База данных работает отлично!',
  is_bot: true,
  ai_model: 'gpt-4',
  ai_provider: 'openai',
});

console.log('✅ Сообщения сохранены\n');

// 4. Получаем историю
console.log('4️⃣ Загрузка истории сообщений...');
const history = getMessageHistory('test_chat_456', 10);
console.log(`📜 Найдено ${history.length} сообщений:\n`);

history.forEach((msg, idx) => {
  const sender = msg.is_bot ? '🤖 Бот' : `👤 ${msg.username}`;
  const model = msg.ai_model ? ` [${msg.ai_model}]` : '';
  console.log(`   ${idx + 1}. ${sender}${model}: ${msg.message_text}`);
});

console.log('\n');

// 5. Получаем статистику
console.log('5️⃣ Статистика базы данных:');
const stats = getDatabaseStats();
console.log(`   💬 Всего сообщений: ${stats.totalMessages}`);
console.log(`   👤 Всего пользователей: ${stats.totalUsers}`);
console.log(`   📝 Всего сессий: ${stats.totalSessions}`);
console.log(`   🟢 Активных сессий: ${stats.activeSessions}`);

console.log('\n');

// 6. Получаем всех пользователей
console.log('6️⃣ Список пользователей:');
const users = getAllUsers();
users.forEach((user) => {
  console.log(`   👤 ${user.first_name || user.username} (ID: ${user.user_id})`);
  console.log(`      Сообщений: ${user.message_count}, Последний визит: ${user.last_seen}`);
});

console.log('\n✅ Тест завершен!\n');
console.log('💡 Проверьте веб-интерфейс: http://localhost:3000');
console.log('   - Обновите статистику');
console.log('   - Введите Chat ID "test_chat_456" в секции "История сообщений"');
