// Тестирование контекстной памяти
import { initDatabase } from './src/db/database.ts';
import { saveMessage, createOrUpdateUser, createOrUpdateSession } from './src/db/queries.ts';
import { getContextForAI, getContextStats } from './src/db/context.ts';
import { getContextConfig, setContextConfig } from './src/config/context.ts';
import { processWithAI } from './src/ai/models.ts';

console.log('🧪 Тестирование контекстной памяти...\n');

// Инициализация БД
initDatabase();

// Настройка контекста
console.log('1️⃣ Настройка контекста...');
setContextConfig({
  enabled: true,
  maxMessages: 5,
  maxTokens: 1500,
  includeSystemPrompt: true,
});
const config = getContextConfig();
console.log('✅ Настройки контекста:');
console.log(`   Включен: ${config.enabled}`);
console.log(`   Максимум сообщений: ${config.maxMessages}`);
console.log(`   Максимум токенов: ${config.maxTokens}`);
console.log(`   Системный промпт: ${config.includeSystemPrompt}\n`);

// Создаем тестовый диалог
const testChatId = 'test_context_chat_789';
const testUserId = 'test_user_context';

console.log('2️⃣ Создание тестового диалога...');
createOrUpdateUser({
  user_id: testUserId,
  username: 'context_test_user',
  first_name: 'Тест',
  last_name: 'Контекста',
});

createOrUpdateSession({
  chat_id: testChatId,
  user_id: testUserId,
});

// Сохраняем последовательность сообщений для контекста
const dialog = [
  { user: 'Привет! Меня зовут Иван.', bot: 'Привет, Иван! Рад познакомиться. Как дела?' },
  { user: 'Отлично! Я изучаю программирование.', bot: 'Это замечательно! На каком языке программирования ты учишься?' },
  { user: 'Я изучаю Python. Можешь помочь?', bot: 'Конечно! Python - отличный выбор. С чем именно нужна помощь?' },
  { user: 'Как создать список в Python?', bot: 'В Python список создается с помощью квадратных скобок: my_list = [1, 2, 3]' },
];

console.log('3️⃣ Сохранение диалога в БД...');
for (const exchange of dialog) {
  // Сообщение пользователя
  saveMessage({
    chat_id: testChatId,
    user_id: testUserId,
    username: 'context_test_user',
    message_text: exchange.user,
    is_bot: false,
  });
  
  // Ответ бота
  saveMessage({
    chat_id: testChatId,
    user_id: 'bot',
    username: 'bot',
    message_text: exchange.bot,
    is_bot: true,
    ai_model: 'gpt-3.5-turbo',
    ai_provider: 'openai',
  });
}
console.log(`✅ Сохранено ${dialog.length * 2} сообщений\n`);

// Тестируем получение контекста
console.log('4️⃣ Получение контекста для нового сообщения...');
const newMessage = 'А как добавить элемент в список?';
const contextMessages = getContextForAI(testChatId, newMessage);

console.log(`📚 Контекст загружен: ${contextMessages.length} сообщений\n`);
console.log('📝 Сообщения в контексте:');
contextMessages.forEach((msg, idx) => {
  const roleEmoji = msg.role === 'system' ? '⚙️' : msg.role === 'assistant' ? '🤖' : '👤';
  const roleName = msg.role === 'system' ? 'Система' : msg.role === 'assistant' ? 'Ассистент' : 'Пользователь';
  const preview = msg.content.substring(0, 60) + (msg.content.length > 60 ? '...' : '');
  console.log(`   ${idx + 1}. ${roleEmoji} ${roleName}: ${preview}`);
});

console.log('\n');

// Статистика контекста
console.log('5️⃣ Статистика контекста:');
const stats = getContextStats(testChatId);
console.log(`   📊 Всего сообщений в чате: ${stats.totalMessages}`);
console.log(`   📚 Сообщений в контексте: ${stats.contextMessages}`);
console.log(`   💡 Примерное количество токенов: ${stats.estimatedTokens}`);

console.log('\n');

// Тестируем AI обработку с контекстом (если API ключ установлен)
console.log('6️⃣ Тест AI обработки с контекстом...');
try {
  const aiResponse = await processWithAI(newMessage, contextMessages);
  
  if (aiResponse) {
    console.log('✅ AI ответ получен:');
    console.log(`   Текст: ${aiResponse.text}`);
    console.log(`   Модель: ${aiResponse.model}`);
    console.log(`   Провайдер: ${aiResponse.provider}`);
    if (aiResponse.tokensUsed) {
      console.log(`   Токенов использовано: ${aiResponse.tokensUsed}`);
    }
  } else {
    console.log('⚠️ AI обработка недоступна (API ключ не установлен)');
  }
} catch (error) {
  console.log(`⚠️ Ошибка AI обработки: ${error.message}`);
  console.log('   (Это нормально, если API ключ не установлен)');
}

console.log('\n✅ Тест завершен!\n');
console.log('💡 Проверьте веб-интерфейс: http://localhost:3000');
console.log(`   - Введите Chat ID "${testChatId}" в секции "История сообщений"`);
console.log(`   - Введите Chat ID "${testChatId}" в секции "Контекстная память" -> "Предпросмотр контекста"`);
console.log(`   - Попробуйте тест AI с Chat ID "${testChatId}" для проверки контекста`);
