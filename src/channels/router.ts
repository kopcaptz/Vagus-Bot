/**
 * router.ts — чистая функция обработки сообщений.
 *
 * НУЛЕВЫЕ зависимости от каналов и реестра.
 * Принимает IncomingMessage → возвращает MessageResult.
 * Никогда не отправляет ответ сама.
 */

import type { IncomingMessage, MessageResult } from './types.js';
import type { ImageAttachment } from '../ai/models.js';
import { processWithAI } from '../ai/models.js';
import { getSelectedModel, getModelConfig } from '../config/config.js';
import { getContextConfig } from '../config/context.js';
import { getSelectedPersona, getPersonas } from '../config/personas.js';
import {
  saveMessage,
  createOrUpdateUser,
  createOrUpdateSession,
  getRecentMessages,
  clearChatHistory,
} from '../db/queries.js';
import { getContextForAI } from '../db/context.js';
import { userRateLimiter } from '../server/rate-limit.js';

// ============================================
// Основная точка входа
// ============================================

/**
 * Обработать входящее сообщение и вернуть результат.
 * Сохраняет пользователя, сессию, сообщения в БД.
 * НЕ отправляет ответ — это делает канал.
 */
export async function routeMessage(msg: IncomingMessage): Promise<MessageResult | null> {
  const { chatId, userId, username, firstName, lastName, text, images } = msg;

  console.log(`📨 [${msg.channelId}] Сообщение от ${firstName || username || userId}: ${text || '[изображение]'}`);

  // --- Сохраняем пользователя и сессию ---
  setImmediate(() => {
    try {
      createOrUpdateUser({
        user_id: userId,
        username,
        first_name: firstName,
        last_name: lastName,
      });
      createOrUpdateSession({ chat_id: chatId, user_id: userId });
    } catch (error) {
      console.error('❌ Ошибка сохранения пользователя/сессии:', error);
    }
  });

  // --- Сохраняем входящее сообщение ---
  const messageTextForDb = images && images.length > 0
    ? (text ? `${text} [изображение]` : '[изображение]')
    : text;

  saveMessage({
    chat_id: chatId,
    user_id: userId,
    username,
    message_text: messageTextForDb,
    is_bot: false,
  });

  // --- Команды (без rate limit) ---
  const commandResult = handleCommand(text, chatId);
  if (commandResult !== null) {
    saveMessage({
      chat_id: chatId,
      user_id: 'bot',
      username: 'bot',
      message_text: commandResult,
      is_bot: true,
    });
    return { text: commandResult };
  }

  // --- Rate limit (только для AI запросов, не для команд) ---
  if (!userRateLimiter.check(msg.userId)) {
    return { text: '⏳ Слишком много запросов. Подождите минуту.' };
  }

  // --- AI обработка ---
  return await processAIMessage(chatId, userId, text, images, msg.onStatus);
}

// ============================================
// Обработка команд
// ============================================

/**
 * Обработать команду. Возвращает текст ответа или null если это не команда.
 */
function handleCommand(text: string, chatId: string): string | null {
  if (!text.startsWith('/')) return null;

  if (text.startsWith('/start')) {
    const personaId = getSelectedPersona();
    const personas = getPersonas();
    const persona = personas.find(p => p.id === personaId);
    const personaName = persona?.name || 'ассистент';
    const selectedModel = getSelectedModel();
    const modelInfo = selectedModel !== 'none'
      ? `\n🤖 AI модель: ${selectedModel}`
      : '\n⚠️ AI модель не выбрана';
    return `👋 Привет! Я Vagus Bot в режиме «${personaName}».${modelInfo}\n\nОтправь сообщение — отвечу с учётом контекста и выбранной личности.`;
  }

  if (text === '/reset' || text === '/clear') {
    const deleted = clearChatHistory(chatId);
    return `🗑 Контекст очищен. Удалено сообщений: ${deleted}. Можешь начать заново.`;
  }

  if (text.startsWith('/help')) {
    return `📋 Доступные команды:
/start - Начать работу
/help - Показать помощь
/model - Показать текущую модель
/history - Показать последние 5 сообщений
/reset или /clear - Очистить контекст чата
/echo <текст> - Повторить текст`;
  }

  if (text.startsWith('/model')) {
    const selectedModel = getSelectedModel();
    const modelConfig = getModelConfig();
    if (selectedModel === 'none') {
      return '⚠️ AI модель не выбрана. Используйте веб-интерфейс для выбора модели.';
    }
    return `🤖 Текущая модель: ${selectedModel}\nПровайдер: ${modelConfig.provider}\nМодель: ${modelConfig.model}`;
  }

  if (text.startsWith('/history')) {
    const history = getRecentMessages(chatId, 5);
    if (history.length === 0) return 'История сообщений пуста.';

    let result = '📜 Последние 5 сообщений:\n\n';
    history.forEach((msg, idx) => {
      const sender = msg.is_bot ? '🤖 Бот' : `👤 ${msg.username || 'Пользователь'}`;
      const preview = msg.message_text.substring(0, 50) + (msg.message_text.length > 50 ? '...' : '');
      result += `${idx + 1}. ${sender}: ${preview}\n`;
    });
    return result;
  }

  if (text.startsWith('/echo ')) {
    return `🔄 Эхо: ${text.replace('/echo ', '')}`;
  }

  // Неизвестная команда — не обрабатываем, пусть идёт в AI
  return null;
}

// ============================================
// AI обработка
// ============================================

async function processAIMessage(
  chatId: string,
  userId: string,
  text: string,
  images?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>,
): Promise<MessageResult | null> {
  const selectedModel = getSelectedModel();
  if (selectedModel === 'none') {
    const noModelText = images
      ? '✅ Фото получено.\n\n⚠️ AI модель не выбрана — выберите модель в веб-интерфейсе.'
      : (text.length > 150
          ? `✅ Получено (сообщение из ${text.length} символов).\n\n⚠️ AI модель не выбрана. Используйте веб-интерфейс для выбора модели.`
          : `✅ Получено: "${text}"\n\n⚠️ AI модель не выбрана. Используйте веб-интерфейс для выбора модели.`);
    saveMessage({
      chat_id: chatId,
      user_id: 'bot',
      username: 'bot',
      message_text: noModelText,
      is_bot: true,
    });
    return { text: noModelText };
  }

  try {
    const contextConfig = getContextConfig();
    let contextMessages;
    const messageForContext = text || '[изображение]';

    if (contextConfig.enabled) {
      contextMessages = await getContextForAI(chatId, messageForContext, userId);
      console.log(`📚 Контекст: ${contextMessages.length} сообщений для чата ${chatId}`);
    }

    const aiResponse = await processWithAI(
      text,
      contextMessages,
      images && images.length > 0 ? images : undefined,
      onStatus,
    );

    if (!aiResponse) {
      const failText = '⚠️ AI обработка недоступна.';
      saveMessage({
        chat_id: chatId,
        user_id: 'bot',
        username: 'bot',
        message_text: failText,
        is_bot: true,
      });
      return { text: failText };
    }

    // Сохраняем ответ AI в БД
    saveMessage({
      chat_id: chatId,
      user_id: 'bot',
      username: 'bot',
      message_text: aiResponse.text,
      is_bot: true,
      ai_model: aiResponse.model,
      ai_provider: aiResponse.provider,
    });

    const contextCount = contextMessages
      ? contextMessages.filter(m => m.role !== 'system').length
      : 0;

    return {
      text: aiResponse.text,
      model: aiResponse.model,
      provider: aiResponse.provider,
      tokensUsed: aiResponse.tokensUsed,
      contextUsed: contextCount,
      contextEnabled: contextConfig.enabled,
      contextTotal: contextMessages ? contextMessages.length : 0,
    };
  } catch (error) {
    console.error('❌ Ошибка AI обработки:', error);
    const errText = '❌ Ошибка обработки сообщения. Проверьте настройки API ключей.';
    saveMessage({
      chat_id: chatId,
      user_id: 'bot',
      username: 'bot',
      message_text: errText,
      is_bot: true,
    });
    return { text: errText };
  }
}
