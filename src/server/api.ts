import { Router } from 'express';
import multer from 'multer';
import { getBot, isTelegramEnabled } from '../bot/telegram.js';
import { getSelectedModel, setSelectedModel, getModelConfig, type AIModel } from '../config/config.js';
import { processWithAI, type ImageAttachment } from '../ai/models.js';

function normalizeImageAttachments(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: unknown) => {
      if (item && typeof item === 'object' && 'data' in item && typeof (item as Record<string, unknown>).data === 'string') {
        const data = (item as Record<string, unknown>).data as string;
        const mt = (item as Record<string, unknown>).mediaType;
        const mediaType = typeof mt === 'string' ? mt : 'image/jpeg';
        return { data, mediaType };
      }
      return null;
    })
    .filter((x): x is ImageAttachment => x !== null);
}
import { getDatabaseStats, getAllUsers, getActiveSessions, saveMessage, getChatHistoryAdvanced, clearChatHistory, cleanupOldMessages } from '../db/queries.js';
import { getContextForAI, getContextStats } from '../db/context.js';
import { getContextConfig, setContextConfig, type ContextConfig } from '../config/context.js';
import { getPersonas, getSelectedPersona, setSelectedPersona, savePersona, deletePersona, type PersonaId } from '../config/personas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB per file

export function createApiRouter() {
  const router = Router();

  // Статистика бота
  router.get('/api/stats', async (req, res) => {
    try {
      const telegramEnabled = isTelegramEnabled();
      const selectedModel = getSelectedModel();
      const modelConfig = getModelConfig();
      const dbStats = getDatabaseStats();
      
      const stats: any = {
        status: 'running',
        timestamp: new Date().toISOString(),
        ai: {
          selectedModel,
          config: modelConfig.provider !== 'none' ? {
            provider: modelConfig.provider,
            model: modelConfig.model,
            hasApiKey: !!modelConfig.apiKey,
          } : null,
        },
        database: dbStats,
        persona: {
          selected: getSelectedPersona(),
        },
      };
      
      if (!telegramEnabled) {
        stats.telegram = {
          enabled: false,
          message: 'Telegram бот не настроен. Добавьте TELEGRAM_BOT_TOKEN в .env файл.',
        };
      } else {
        const bot = getBot();
        if (!bot) {
          stats.telegram = {
            enabled: false,
            message: 'Telegram бот не инициализирован',
          };
        } else {
          const me = await bot.api.getMe();
          stats.telegram = {
            enabled: true,
            bot: {
              id: me.id,
              username: me.username,
              firstName: me.first_name,
            },
          };
        }
      }
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения статистики' });
    }
  });

  // Получить список доступных моделей
  router.get('/api/models', (req, res) => {
    const modelConfig = getModelConfig();
    res.json({
      available: [
        { id: 'none', name: 'Без AI', provider: 'none' },
        { id: 'openai-gpt-4', name: 'OpenAI GPT-4', provider: 'openai' },
        { id: 'openai-gpt-3.5', name: 'OpenAI GPT-3.5 Turbo', provider: 'openai' },
        { id: 'anthropic-claude', name: 'Anthropic Claude', provider: 'anthropic' },
      ],
      selected: getSelectedModel(),
      config: modelConfig.provider !== 'none' ? {
        provider: modelConfig.provider,
        model: modelConfig.model,
        hasApiKey: !!modelConfig.apiKey,
      } : null,
    });
  });

  // Получить список доступных персон
  router.get('/api/personas', (req, res) => {
    try {
      const personas = getPersonas();
      res.json({
        available: personas.map(p => ({ id: p.id, name: p.name, prompt: p.prompt })),
        selected: getSelectedPersona(),
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения списка персон' });
    }
  });

  // Выбрать персону
  router.post('/api/personas/select', (req, res) => {
    try {
      const { persona } = req.body;
      const personas = getPersonas();
      const valid = personas.find(p => p.id === persona);
      if (!valid) {
        return res.status(400).json({ error: 'Неверная персона' });
      }
      setSelectedPersona(persona as PersonaId);
      res.json({ success: true, selected: persona });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка выбора персоны' });
    }
  });

  // Сохранить/обновить персону
  router.post('/api/personas/save', (req, res) => {
    try {
      const { id, name, prompt, saveAsNew } = req.body;
      const persona = savePersona({
        id: typeof id === 'string' ? id : undefined,
        name: String(name || '').trim(),
        prompt: String(prompt || '').trim(),
        saveAsNew: Boolean(saveAsNew),
      });
      res.json({ success: true, persona });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Ошибка сохранения персоны' });
    }
  });

  // Удалить персону
  router.delete('/api/personas/:id', (req, res) => {
    try {
      const { id } = req.params;
      deletePersona(id);
      res.json({ success: true, deleted: id });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Ошибка удаления персоны' });
    }
  });

  // Выбрать модель
  router.post('/api/models/select', (req, res) => {
    try {
      const { model } = req.body;
      
      const validModels: AIModel[] = ['none', 'openai-gpt-4', 'openai-gpt-3.5', 'anthropic-claude'];
      if (!validModels.includes(model)) {
        return res.status(400).json({ error: 'Неверная модель' });
      }

      setSelectedModel(model);
      const modelConfig = getModelConfig();
      
      res.json({
        success: true,
        selected: model,
        config: modelConfig.provider !== 'none' ? {
          provider: modelConfig.provider,
          model: modelConfig.model,
          hasApiKey: !!modelConfig.apiKey,
        } : null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка выбора модели' });
    }
  });

  // Тест AI обработки (поддержка текста и опционально изображений — base64 в теле)
  router.post('/api/ai/test', async (req, res) => {
    try {
      const { message, chatId, images: rawImages } = req.body;

      const text = (message !== undefined && message !== null ? String(message) : '').trim();
      const imageAttachmentsFromBody = normalizeImageAttachments(rawImages);
      if (!text && imageAttachmentsFromBody.length === 0) {
        return res.status(400).json({ error: 'Требуется message или изображения (images)' });
      }

      const selectedModel = getSelectedModel();
      if (selectedModel === 'none') {
        return res.status(400).json({ error: 'AI модель не выбрана' });
      }

      const contextConfig = getContextConfig();
      let contextMessages;
      const messageForContext = text || '[изображение]';
      if (chatId && contextConfig.enabled) {
        contextMessages = getContextForAI(String(chatId), messageForContext);
        console.log(`📚 Контекст загружен: ${contextMessages.length} сообщений для чата ${chatId}`);
      } else {
        if (chatId && !contextConfig.enabled) console.log(`⚠️ Контекст отключен, chatId: ${chatId}`);
        else if (!chatId) console.log(`ℹ️ Chat ID не указан`);
      }

      const response = await processWithAI(text, contextMessages, imageAttachmentsFromBody.length ? imageAttachmentsFromBody : undefined);

      if (!response) {
        return res.status(500).json({ error: 'Ошибка обработки' });
      }

      const contextCount = contextMessages ? contextMessages.filter(m => m.role !== 'system').length : 0;

      res.json({
        success: true,
        response: response.text,
        model: response.model,
        provider: response.provider,
        tokensUsed: response.tokensUsed,
        contextUsed: contextCount,
        contextEnabled: contextConfig.enabled,
        contextTotal: contextMessages ? contextMessages.length : 0,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка AI обработки';
      res.status(500).json({ error: msg });
    }
  });

  // Тест AI с загрузкой изображений (multipart/form-data)
  router.post('/api/ai/upload', upload.array('images', 5), async (req, res) => {
    try {
      const message = (req.body?.message ?? '').trim();
      const chatId = req.body?.chatId?.trim() || undefined;
      const files = (req.files as Express.Multer.File[]) ?? [];

      if (!message && files.length === 0) {
        return res.status(400).json({ error: 'Требуется message или изображения (images)' });
      }

      const selectedModel = getSelectedModel();
      if (selectedModel === 'none') {
        return res.status(400).json({ error: 'AI модель не выбрана' });
      }

      const imageAttachments: ImageAttachment[] = files
        .filter(f => f.mimetype?.startsWith('image/'))
        .map(f => ({
          data: f.buffer.toString('base64'),
          mediaType: f.mimetype || 'image/jpeg',
        }));

      const contextConfig = getContextConfig();
      let contextMessages;
      const messageForContext = message || '[изображение]';
      if (chatId && contextConfig.enabled) {
        contextMessages = getContextForAI(String(chatId), messageForContext);
        console.log(`📚 Контекст загружен: ${contextMessages.length} сообщений для чата ${chatId}`);
      }

      const response = await processWithAI(
        message,
        contextMessages,
        imageAttachments.length ? imageAttachments : undefined
      );

      if (!response) {
        return res.status(500).json({ error: 'Ошибка обработки' });
      }

      const contextCount = contextMessages ? contextMessages.filter(m => m.role !== 'system').length : 0;

      res.json({
        success: true,
        response: response.text,
        model: response.model,
        provider: response.provider,
        tokensUsed: response.tokensUsed,
        contextUsed: contextCount,
        contextEnabled: contextConfig.enabled,
        contextTotal: contextMessages ? contextMessages.length : 0,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка AI обработки';
      res.status(500).json({ error: msg });
    }
  });

  // Отправка сообщения через API
  router.post('/api/send', async (req, res) => {
    try {
      if (!isTelegramEnabled()) {
        return res.status(400).json({ 
          error: 'Telegram бот не настроен. Добавьте TELEGRAM_BOT_TOKEN в .env файл.' 
        });
      }

      const { chatId, message } = req.body;
      
      if (!chatId || !message) {
        return res.status(400).json({ error: 'Требуются chatId и message' });
      }

      const bot = getBot();
      if (!bot) {
        return res.status(500).json({ error: 'Telegram бот не инициализирован' });
      }

      await bot.api.sendMessage(chatId, message);
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
  });

  // Получить историю сообщений для чата (расширенно)
  router.get('/api/history/:chatId', (req, res) => {
    try {
      const { chatId } = req.params;
      const { limit, offset, role, from, to, q } = req.query;

      const data = getChatHistoryAdvanced(chatId, {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        role: role === 'user' || role === 'bot' ? role : undefined,
        startDate: from as string,
        endDate: to as string,
        search: q as string,
      });

      res.json({
        success: true,
        chatId,
        total: data.total,
        limit: data.limit,
        offset: data.offset,
        count: data.messages.length,
        messages: data.messages,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения истории' });
    }
  });

  // Очистить историю чата
  router.delete('/api/history/:chatId', (req, res) => {
    try {
      const { chatId } = req.params;
      const deleted = clearChatHistory(chatId);
      res.json({ success: true, deleted });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка очистки истории' });
    }
  });

  // Удалить старые сообщения
  router.delete('/api/history/cleanup', (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const deleted = cleanupOldMessages(days);
      res.json({ success: true, deleted, days });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка удаления старых сообщений' });
    }
  });

  // Добавить сообщение в историю (для веб-теста)
  router.post('/api/history/add', (req, res) => {
    try {
      const { chatId, message, role } = req.body;
      
      if (!chatId || !message) {
        return res.status(400).json({ error: 'Требуются chatId и message' });
      }
      
      const senderRole = role === 'assistant' ? 'assistant' : 'user';
      const isBot = senderRole === 'assistant';
      
      saveMessage({
        chat_id: String(chatId),
        user_id: isBot ? 'bot' : 'web_user',
        username: isBot ? 'bot' : 'web_user',
        message_text: String(message),
        is_bot: isBot,
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка сохранения сообщения в историю' });
    }
  });

  // Получить статистику базы данных
  router.get('/api/database/stats', (req, res) => {
    try {
      const stats = getDatabaseStats();
      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения статистики БД' });
    }
  });

  // Получить всех пользователей
  router.get('/api/users', (req, res) => {
    try {
      const users = getAllUsers();
      res.json({
        success: true,
        count: users.length,
        users,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения пользователей' });
    }
  });

  // Получить активные сессии
  router.get('/api/sessions', (req, res) => {
    try {
      const sessions = getActiveSessions();
      res.json({
        success: true,
        count: sessions.length,
        sessions,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения сессий' });
    }
  });

  // ============================================
  // КОНТЕКСТНАЯ ПАМЯТЬ
  // ============================================

  // Получить настройки контекста
  router.get('/api/context/config', (req, res) => {
    try {
      const config = getContextConfig();
      res.json({
        success: true,
        config,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения настроек контекста' });
    }
  });

  // Обновить настройки контекста
  router.post('/api/context/config', (req, res) => {
    try {
      const { enabled, maxMessages, maxTokens, includeSystemPrompt } = req.body;
      
      const updates: Partial<ContextConfig> = {};
      if (typeof enabled === 'boolean') updates.enabled = enabled;
      if (typeof maxMessages === 'number' && maxMessages > 0) updates.maxMessages = maxMessages;
      if (typeof maxTokens === 'number' && maxTokens > 0) updates.maxTokens = maxTokens;
      if (typeof includeSystemPrompt === 'boolean') updates.includeSystemPrompt = includeSystemPrompt;

      setContextConfig(updates);
      const newConfig = getContextConfig();
      
      res.json({
        success: true,
        config: newConfig,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка обновления настроек контекста' });
    }
  });

  // Получить контекст для чата
  router.get('/api/context/:chatId', (req, res) => {
    try {
      const { chatId } = req.params;
      const { message } = req.query;
      
      const contextMessages = getContextForAI(chatId, message as string);
      const stats = getContextStats(chatId);
      
      res.json({
        success: true,
        chatId,
        messages: contextMessages,
        stats,
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения контекста' });
    }
  });

  return router;
}
