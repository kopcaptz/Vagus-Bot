// Простой тест контекстной памяти
import { saveMessage, createOrUpdateUser, createOrUpdateSession } from './src/db/queries.ts';
import { getContextForAI } from './src/db/context.ts';
import { processWithAI } from './src/ai/models.ts';
import { getContextConfig, setContextConfig } from './src/config/context.ts';

console.log('🧪 Простой тест контекстной памяти\n');

// Убеждаемся, что контекст включен
setContextConfig({ enabled: true, maxMessages: 10, maxTokens: 2000, includeSystemPrompt: true });
const config = getContextConfig();
console.log(`✅ Контекстная память: ${config.enabled ? 'ВКЛЮЧЕНА' : 'ОТКЛЮЧЕНА'}\n`);

const cliChatId = process.argv[2];
const testChatId = cliChatId && cliChatId.trim().length > 0 ? cliChatId.trim() : 'test_simple_context';
const testUserId = 'test_user_simple';

// Создаем пользователя и сессию
createOrUpdateUser({
  user_id: testUserId,
  username: 'test_user',
  first_name: 'Тест',
});

createOrUpdateSession({
  chat_id: testChatId,
  user_id: testUserId,
});

console.log(`1️⃣ Создаю тестовый диалог для chat_id="${testChatId}"...\n`);

// Сохраняем сообщения
saveMessage({
  chat_id: testChatId,
  user_id: testUserId,
  username: 'test_user',
  message_text: 'Меня зовут Иван, и я изучаю Python программирование',
  is_bot: false,
});

saveMessage({
  chat_id: testChatId,
  user_id: 'bot',
  username: 'bot',
  message_text: 'Привет, Иван! Python - отличный выбор для изучения программирования.',
  is_bot: true,
});

saveMessage({
  chat_id: testChatId,
  user_id: testUserId,
  username: 'test_user',
  message_text: 'Мой любимый цвет - синий',
  is_bot: false,
});

console.log('✅ Сообщения сохранены\n');

// Проверяем контекст
console.log('2️⃣ Проверяю контекст...\n');
const question = 'Как меня зовут и какой мой любимый цвет?';
const contextMessages = getContextForAI(testChatId, question);

console.log(`📚 Контекст загружен: ${contextMessages.length} сообщений\n`);
console.log('Сообщения в контексте:');
contextMessages.forEach((msg, idx) => {
  const roleEmoji = msg.role === 'system' ? '⚙️' : msg.role === 'assistant' ? '🤖' : '👤';
  console.log(`   ${idx + 1}. ${roleEmoji} ${msg.role}: ${msg.content.substring(0, 60)}...`);
});

console.log('\n3️⃣ Тестирую AI с контекстом...\n');

try {
  const aiResponse = await processWithAI(question, contextMessages);
  
  if (aiResponse) {
    console.log('✅ Ответ AI:');
    console.log(`   ${aiResponse.text}\n`);
    console.log(`   Модель: ${aiResponse.model}`);
    console.log(`   Провайдер: ${aiResponse.provider}`);
    if (aiResponse.tokensUsed) {
      console.log(`   Токенов использовано: ${aiResponse.tokensUsed}`);
    }
    
    // Проверяем, упоминает ли ответ имя и цвет
    const lowerText = aiResponse.text.toLowerCase();
    if ((lowerText.includes('иван') || lowerText.includes('ivan')) && 
        (lowerText.includes('синий') || lowerText.includes('синий') || lowerText.includes('blue'))) {
      console.log('\n🎉 УСПЕХ! AI помнит информацию из контекста!');
    } else if (lowerText.includes('иван') || lowerText.includes('ivan')) {
      console.log('\n✅ Частичный успех! AI помнит имя, но не упомянул цвет.');
    } else {
      console.log('\n⚠️ AI не упомянул информацию из контекста. Проверьте ответ выше.');
    }
  } else {
    console.log('❌ AI обработка недоступна (API ключ не установлен)');
  }
} catch (error) {
  console.log(`❌ Ошибка: ${error.message}`);
}

console.log('\n💡 Для теста в веб-интерфейсе:');
console.log(`   - Chat ID: ${testChatId}`);
console.log(`   - Вопрос: ${question}`);
