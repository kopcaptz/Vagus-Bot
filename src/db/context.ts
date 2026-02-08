import { getRecentMessages } from './queries.js';
import type { Message } from './types.js';
import { getContextConfig } from '../config/context.js';
import { getSystemPrompt } from '../config/personas.js';

/**
 * Форматированное сообщение для AI контекста
 */
export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/**
 * Получить контекст для AI из истории сообщений
 * 
 * @param chatId - ID чата
 * @param currentMessage - Текущее сообщение пользователя (не включается в контекст)
 * @returns Массив сообщений в формате для AI провайдеров
 */
export function getContextForAI(chatId: string, currentMessage?: string): ContextMessage[] {
  const contextConfig = getContextConfig();
  
  // Если контекст отключен, возвращаем только текущее сообщение
  if (!contextConfig.enabled) {
    console.log(`⚠️ Контекстная память отключена для чата ${chatId}`);
    if (currentMessage) {
      return [{ role: 'user', content: currentMessage }];
    }
    return [];
  }

  // Получаем последние сообщения из БД
  const recentMessages = getRecentMessages(chatId, contextConfig.maxMessages + 1); // +1 чтобы потом исключить текущее
  console.log(`📚 Найдено ${recentMessages.length} сообщений в истории для чата ${chatId}`);
  
  // Фильтруем сообщения (исключаем текущее, если оно есть)
  let messagesToUse = recentMessages;
  if (currentMessage && recentMessages.length > 0) {
    // Исключаем последнее сообщение, если оно совпадает с текущим
    const lastMessage = recentMessages[recentMessages.length - 1];
    if (lastMessage.message_text === currentMessage && !lastMessage.is_bot) {
      messagesToUse = recentMessages.slice(0, -1);
      console.log(`🔍 Исключено текущее сообщение из контекста`);
    }
  }

  // Конвертируем сообщения в формат для AI
  const contextMessages: ContextMessage[] = [];

  // Добавляем системный промпт, если включен
  if (contextConfig.includeSystemPrompt) {
    contextMessages.push({
      role: 'system',
      content: `${getSystemPrompt()} Учитывай контекст предыдущих сообщений в разговоре.`,
    });
  }

  // Конвертируем сообщения из БД в формат для AI
  // ВАЖНО: messagesToUse уже в правильном порядке (от старых к новым)
  for (const msg of messagesToUse) {
    const role: 'user' | 'assistant' = msg.is_bot ? 'assistant' : 'user';
    
    // Форматируем сообщение с информацией об отправителе (опционально)
    let content = msg.message_text;
    
    // Если есть username, можно добавить его для контекста (но это увеличит токены)
    // Пока оставляем просто текст сообщения
    
    contextMessages.push({
      role,
      content,
      timestamp: msg.created_at,
    });
  }

  // ВАЖНО: Текущее сообщение добавляем В САМЫЙ КОНЕЦ, после всей истории
  // Это гарантирует правильный порядок: история -> текущий вопрос
  if (currentMessage) {
    contextMessages.push({
      role: 'user',
      content: currentMessage,
    });
    console.log(`✅ Текущее сообщение добавлено в конец контекста`);
  }
  
  // Логируем порядок для отладки
  console.log(`📋 Порядок сообщений в контексте (до обрезки):`);
  contextMessages.forEach((msg, idx) => {
    const preview = msg.content.substring(0, 40) + (msg.content.length > 40 ? '...' : '');
    console.log(`   ${idx + 1}. ${msg.role}: ${preview}`);
  });

  // Ограничиваем длину контекста по токенам (приблизительно)
  // 1 токен ≈ 4 символа для русского языка, 1 слово ≈ 1.3 токена
  const trimmedMessages = trimContextByTokens(contextMessages, contextConfig.maxTokens);

  // Логируем итоговый контекст
  const contextCount = trimmedMessages.filter(m => m.role !== 'system').length;
  console.log(`✅ Контекст подготовлен: ${trimmedMessages.length} сообщений (${contextCount} без системного промпта)`);
  
  // Проверяем порядок: текущее сообщение должно быть последним
  if (currentMessage) {
    const lastMsg = trimmedMessages[trimmedMessages.length - 1];
    if (lastMsg.role === 'user' && lastMsg.content === currentMessage) {
      console.log(`✅ Порядок правильный: текущее сообщение в конце`);
    } else {
      console.warn(`⚠️ ВНИМАНИЕ: Текущее сообщение не в конце! Последнее: ${lastMsg.content.substring(0, 30)}...`);
    }
  }

  return trimmedMessages;
}

/**
 * Обрезать контекст по максимальному количеству токенов
 * Удаляет самые старые сообщения, оставляя системный промпт и последние сообщения
 */
function trimContextByTokens(messages: ContextMessage[], maxTokens: number): ContextMessage[] {
  if (messages.length === 0) return messages;

  // Приблизительный подсчет токенов: 1 токен ≈ 4 символа для русского
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Системный промпт всегда оставляем
  const systemMessage = messages.find(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  if (!systemMessage) {
    // Если нет системного промпта, просто обрезаем с конца
    let totalTokens = 0;
    const result: ContextMessage[] = [];
    
    // Идем с конца (новые сообщения важнее), но сохраняем порядок
    const tempMessages: ContextMessage[] = [];
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const msgTokens = estimateTokens(msg.content);
      
      if (totalTokens + msgTokens <= maxTokens) {
        tempMessages.unshift(msg); // Добавляем в начало, чтобы сохранить порядок
        totalTokens += msgTokens;
      } else {
        break;
      }
    }
    
    // Добавляем в правильном порядке (старые -> новые)
    result.push(...tempMessages);
    
    return result;
  }

  // С системным промптом
  const systemTokens = estimateTokens(systemMessage.content);
  const availableTokens = maxTokens - systemTokens;

  let totalTokens = 0;
  const result: ContextMessage[] = [systemMessage];

  // Идем с конца (новые сообщения важнее), но добавляем через unshift чтобы сохранить порядок
  // Сначала собираем в обратном порядке, потом развернем
  const tempMessages: ContextMessage[] = [];
  
  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msg = otherMessages[i];
    const msgTokens = estimateTokens(msg.content);
    
    if (totalTokens + msgTokens <= availableTokens) {
      tempMessages.unshift(msg); // Добавляем в начало временного массива
      totalTokens += msgTokens;
    } else {
      break;
    }
  }

  // Добавляем сообщения в правильном порядке (старые -> новые)
  result.push(...tempMessages);

  return result;
}

/**
 * Получить статистику контекста для чата
 */
export function getContextStats(chatId: string): {
  totalMessages: number;
  contextMessages: number;
  estimatedTokens: number;
} {
  const contextConfig = getContextConfig();
  const recentMessages = getRecentMessages(chatId, contextConfig.maxMessages);
  
  // Приблизительный подсчет токенов
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  let totalTokens = 0;
  if (contextConfig.includeSystemPrompt) {
    totalTokens += estimateTokens(`${getSystemPrompt()} Учитывай контекст предыдущих сообщений в разговоре.`);
  }

  for (const msg of recentMessages) {
    totalTokens += estimateTokens(msg.message_text);
  }

  return {
    totalMessages: recentMessages.length,
    contextMessages: Math.min(recentMessages.length, contextConfig.maxMessages),
    estimatedTokens: totalTokens,
  };
}
