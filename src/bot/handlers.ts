import { Context } from 'grammy';
import { processWithAI, type ImageAttachment } from '../ai/models.js';
import { getSelectedModel, getModelConfig, config } from '../config/config.js';
import { saveMessage, createOrUpdateUser, createOrUpdateSession, getRecentMessages, clearChatHistory } from '../db/queries.js';
import { getContextForAI } from '../db/context.js';
import { getContextConfig } from '../config/context.js';
import { getSelectedPersona, getPersonas } from '../config/personas.js';

// Простая обработка текстовых сообщений
export async function handleMessage(ctx: Context) {
  const message = ctx.message?.text || '';
  const chatId = ctx.chat?.id;
  const userName = ctx.from?.first_name || 'Пользователь';
  const userId = ctx.from?.id?.toString();
  const username = ctx.from?.username;

  if (!message || !chatId || !userId) return;

  console.log(`📨 Сообщение от ${userName}: ${message}`);

  // Сохраняем информацию о пользователе
  createOrUpdateUser({
    user_id: userId,
    username: username,
    first_name: userName,
    last_name: ctx.from?.last_name,
  });

  // Обновляем сессию
  createOrUpdateSession({
    chat_id: chatId.toString(),
    user_id: userId,
  });

  // Сохраняем сообщение пользователя
  saveMessage({
    message_id: ctx.message?.message_id?.toString(),
    chat_id: chatId.toString(),
    user_id: userId,
    username: username,
    message_text: message,
    is_bot: false,
  });

  // Простые команды
  if (message.startsWith('/start')) {
    const personaId = getSelectedPersona();
    const personas = getPersonas();
    const persona = personas.find(p => p.id === personaId);
    const personaName = persona?.name || 'ассистент';
    const selectedModel = getSelectedModel();
    const modelInfo = selectedModel !== 'none' ? `\n🤖 AI модель: ${selectedModel}` : '\n⚠️ AI модель не выбрана';
    const responseText = `👋 Привет, ${userName}! Я Vagus Bot в режиме «${personaName}».${modelInfo}\n\nОтправь сообщение — отвечу с учётом контекста и выбранной личности.`;
    await ctx.reply(responseText);
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
    return;
  }

  if (message === '/reset' || message === '/clear') {
    const deleted = clearChatHistory(chatId.toString());
    const responseText = `🗑 Контекст этого чата очищен. Удалено сообщений: ${deleted}. Можешь начать диалог заново.`;
    await ctx.reply(responseText);
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
    return;
  }

  if (message.startsWith('/help')) {
    const responseText = `📋 Доступные команды:
/start - Начать работу
/help - Показать помощь
/model - Показать текущую модель
/history - Показать последние 5 сообщений
/reset или /clear - Очистить контекст чата
/echo <текст> - Повторить текст`;
    await ctx.reply(responseText);
    
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
    return;
  }

  if (message.startsWith('/model')) {
    const selectedModel = getSelectedModel();
    const modelConfig = getModelConfig();
    
    let responseText: string;
    if (selectedModel === 'none') {
      responseText = '⚠️ AI модель не выбрана. Используйте веб-интерфейс для выбора модели.';
    } else {
      responseText = `🤖 Текущая модель: ${selectedModel}\nПровайдер: ${modelConfig.provider}\nМодель: ${modelConfig.model}`;
    }
    
    await ctx.reply(responseText);
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
    return;
  }

  if (message.startsWith('/history')) {
    const history = getRecentMessages(chatId.toString(), 5);
    
    if (history.length === 0) {
      const responseText = 'История сообщений пуста.';
      await ctx.reply(responseText);
      saveMessage({
        chat_id: chatId.toString(),
        user_id: 'bot',
        username: 'bot',
        message_text: responseText,
        is_bot: true,
      });
    } else {
      let responseText = '📜 Последние 5 сообщений:\n\n';
      history.forEach((msg, idx) => {
        const sender = msg.is_bot ? '🤖 Бот' : `👤 ${msg.username || 'Пользователь'}`;
        const text = msg.message_text.substring(0, 50) + (msg.message_text.length > 50 ? '...' : '');
        responseText += `${idx + 1}. ${sender}: ${text}\n`;
      });
      
      await ctx.reply(responseText);
      saveMessage({
        chat_id: chatId.toString(),
        user_id: 'bot',
        username: 'bot',
        message_text: responseText,
        is_bot: true,
      });
    }
    return;
  }

  if (message.startsWith('/echo ')) {
    const echoText = message.replace('/echo ', '');
    const responseText = `🔄 Эхо: ${echoText}`;
    await ctx.reply(responseText);
    
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
    return;
  }

  // Обработка с AI (если модель выбрана)
  const selectedModel = getSelectedModel();
  if (selectedModel !== 'none') {
    try {
      // Получаем контекст из истории сообщений
      const contextConfig = getContextConfig();
      let contextMessages;
      
      if (contextConfig.enabled) {
        contextMessages = getContextForAI(chatId.toString(), message);
        console.log(`📚 Контекст загружен: ${contextMessages.length} сообщений для чата ${chatId}`);
      } else {
        // Контекст отключен - используем только текущее сообщение
        contextMessages = undefined;
        console.log('⚠️ Контекстная память отключена');
      }

      const thinkingMsg = await ctx.reply('🤔 Думаю...');
      const aiResponse = await processWithAI(message, contextMessages);
      
      if (aiResponse) {
        // Формируем ответ с информацией о контексте (если использовался)
        let responseText = `🤖 ${aiResponse.text}`;
        
        if (contextConfig.enabled && contextMessages && contextMessages.length > 1) {
          responseText += `\n\n📚 Использован контекст из ${contextMessages.length - 1} предыдущих сообщений`;
        }
        
        if (aiResponse.tokensUsed) {
          responseText += `\n💡 Токенов использовано: ${aiResponse.tokensUsed}`;
        }
        
        responseText += `\n(Модель: ${aiResponse.model})`;
        
        await ctx.reply(responseText);
        
        // Сохраняем ответ AI
        saveMessage({
          chat_id: chatId.toString(),
          user_id: 'bot',
          username: 'bot',
          message_text: aiResponse.text,
          is_bot: true,
          ai_model: aiResponse.model,
          ai_provider: aiResponse.provider,
        });
      } else {
        const responseText = `✅ Получено: "${message}"\n\n⚠️ AI обработка недоступна.`;
        await ctx.reply(responseText);
        
        saveMessage({
          chat_id: chatId.toString(),
          user_id: 'bot',
          username: 'bot',
          message_text: responseText,
          is_bot: true,
        });
      }
    } catch (error) {
      console.error('Ошибка AI обработки:', error);
      const responseText = `❌ Ошибка обработки сообщения. Проверьте настройки API ключей.\n\n✅ Получено: "${message}"`;
      await ctx.reply(responseText);
      
      saveMessage({
        chat_id: chatId.toString(),
        user_id: 'bot',
        username: 'bot',
        message_text: responseText,
        is_bot: true,
      });
    }
  } else {
    // Простой ответ без AI
    const responseText = `✅ Получено: "${message}"\n\n⚠️ AI модель не выбрана. Используйте веб-интерфейс для выбора модели.`;
    await ctx.reply(responseText);
    
    saveMessage({
      chat_id: chatId.toString(),
      user_id: 'bot',
      username: 'bot',
      message_text: responseText,
      is_bot: true,
    });
  }
}

/** Скачать файл по file_path из Telegram и вернуть base64 */
async function downloadPhotoAsBase64(fileId: string): Promise<ImageAttachment> {
  const bot = (await import('./telegram.js')).getBot();
  if (!bot) throw new Error('Бот не инициализирован');
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Не удалось скачать фото: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  const mediaType = (file.file_path?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
  return { data: base64, mediaType };
}

/** Обработка сообщений с фото (Vision) */
export async function handlePhotoMessage(ctx: Context) {
  const chatId = ctx.chat?.id;
  const userName = ctx.from?.first_name || 'Пользователь';
  const userId = ctx.from?.id?.toString();
  const username = ctx.from?.username;
  const photo = ctx.message?.photo;
  const caption = ctx.message?.caption ?? '';

  if (!photo?.length || !chatId || !userId) return;

  console.log(`📷 Фото от ${userName}${caption ? `: ${caption}` : ''}`);

  createOrUpdateUser({
    user_id: userId,
    username: username,
    first_name: userName,
    last_name: ctx.from?.last_name,
  });
  createOrUpdateSession({ chat_id: chatId.toString(), user_id: userId });

  const messageTextForDb = caption ? `${caption} [изображение]` : '[изображение]';
  saveMessage({
    message_id: ctx.message?.message_id?.toString(),
    chat_id: chatId.toString(),
    user_id: userId,
    username: username,
    message_text: messageTextForDb,
    is_bot: false,
  });

  const selectedModel = getSelectedModel();
  if (selectedModel === 'none') {
    const responseText = `✅ Получено фото${caption ? ` с подписью: «${caption}»` : ''}.\n\n⚠️ AI модель не выбрана — выберите модель в веб-интерфейсе для анализа изображений.`;
    await ctx.reply(responseText);
    saveMessage({ chat_id: chatId.toString(), user_id: 'bot', username: 'bot', message_text: responseText, is_bot: true });
    return;
  }

  try {
    const largestPhoto = photo[photo.length - 1];
    const imageAttachment = await downloadPhotoAsBase64(largestPhoto.file_id);

    const contextConfig = getContextConfig();
    const contextMessages = contextConfig.enabled ? getContextForAI(chatId.toString(), messageTextForDb) : undefined;

    const thinkingMsg = await ctx.reply('🤔 Смотрю изображение...');
    const aiResponse = await processWithAI(caption, contextMessages, [imageAttachment]);

    if (aiResponse) {
      let responseText = `🤖 ${aiResponse.text}`;
      if (contextConfig.enabled && contextMessages && contextMessages.length > 1) {
        responseText += `\n\n📚 Контекст: ${contextMessages.length - 1} предыдущих сообщений`;
      }
      if (aiResponse.tokensUsed) responseText += `\n💡 Токенов: ${aiResponse.tokensUsed}`;
      responseText += `\n(Модель: ${aiResponse.model})`;

      await ctx.reply(responseText);
      saveMessage({
        chat_id: chatId.toString(),
        user_id: 'bot',
        username: 'bot',
        message_text: aiResponse.text,
        is_bot: true,
        ai_model: aiResponse.model,
        ai_provider: aiResponse.provider,
      });
    } else {
      const responseText = `✅ Фото получено. AI обработка недоступна.`;
      await ctx.reply(responseText);
      saveMessage({ chat_id: chatId.toString(), user_id: 'bot', username: 'bot', message_text: responseText, is_bot: true });
    }
  } catch (error) {
    console.error('Ошибка обработки фото:', error);
    const responseText = `❌ Не удалось проанализировать изображение. Проверьте API ключи и модель с поддержкой зрения.`;
    await ctx.reply(responseText);
    saveMessage({ chat_id: chatId.toString(), user_id: 'bot', username: 'bot', message_text: responseText, is_bot: true });
  }
}

// Обработка ошибок
export function handleError(error: unknown) {
  console.error('❌ Ошибка в боте:', error);
}
