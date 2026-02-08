// Простой тест для проверки OpenAI API
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;

console.log('🧪 Тест OpenAI API\n');
console.log('📋 Проверка конфигурации:');
console.log(`   API Key установлен: ${API_KEY ? '✅ Да' : '❌ Нет'}`);
console.log(`   Длина ключа: ${API_KEY ? API_KEY.length : 0} символов`);
console.log(`   Начинается с: ${API_KEY ? API_KEY.substring(0, 10) + '...' : 'N/A'}\n`);

if (!API_KEY) {
  console.error('❌ OPENAI_API_KEY не найден в .env файле!');
  process.exit(1);
}

console.log('🚀 Отправка тестового запроса к OpenAI API...\n');

try {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Ты полезный AI ассистент. Отвечай кратко.',
        },
        {
          role: 'user',
          content: 'Привет! Ответь одним предложением: как дела?',
        },
      ],
      max_tokens: 50,
      temperature: 0.7,
    }),
  });

  console.log(`📡 Статус ответа: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const error = await response.json();
    console.error('\n❌ Ошибка API:');
    console.error(JSON.stringify(error, null, 2));
    
    if (error?.error?.code === 'invalid_api_key') {
      console.error('\n💡 Проблема: Неверный API ключ');
      console.error('   Проверьте ключ в файле .env');
      console.error('   Получите новый ключ: https://platform.openai.com/account/api-keys');
    } else if (error?.error?.code === 'insufficient_quota') {
      console.error('\n💡 Проблема: Недостаточно средств на счету');
      console.error('   Пополните баланс: https://platform.openai.com/account/billing');
    }
    process.exit(1);
  }

  const data = await response.json();
  console.log('\n✅ Успешный ответ от OpenAI!\n');
  console.log('📝 Ответ AI:');
  console.log(`   ${data.choices[0]?.message?.content || 'Нет ответа'}\n`);
  console.log('📊 Информация:');
  console.log(`   Модель: ${data.model}`);
  console.log(`   Использовано токенов: ${data.usage?.total_tokens || 'N/A'}`);
  console.log(`   Промпт: ${data.usage?.prompt_tokens || 'N/A'}`);
  console.log(`   Ответ: ${data.usage?.completion_tokens || 'N/A'}\n`);
  
  console.log('✅ Тест пройден! API работает корректно.\n');
  
} catch (error) {
  console.error('\n❌ Ошибка при запросе:');
  console.error(error.message);
  console.error('\n💡 Возможные причины:');
  console.error('   - Нет подключения к интернету');
  console.error('   - Проблемы с DNS');
  console.error('   - Блокировка файрволом');
  process.exit(1);
}
