import { Router } from 'express';
import multer from 'multer';
import { getSelectedModel, setSelectedModel, getModelConfig, type AIModel } from '../config/config.js';
import type { ImageAttachment } from '../ai/models.js';
import type { IncomingMessage } from '../channels/types.js';
import { channelRegistry } from '../channels/registry.js';
import { authMiddleware } from './auth.js';

function normalizeImageAttachments(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: unknown) => {
      if (item && typeof item === 'object' && 'data' in item) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.data === 'string') {
          const data = obj.data;
          const mediaType = typeof obj.mediaType === 'string' ? obj.mediaType : 'image/jpeg';
          return { data, mediaType };
        }
      }
      return null;
    })
    .filter((x): x is ImageAttachment => x !== null);
}

import { getDatabaseStats, getAllUsers, getActiveSessions, saveMessage, getChatHistoryAdvanced, clearChatHistory, cleanupOldMessages } from '../db/queries.js';
import { getContextForAI, getContextStats } from '../db/context.js';
import { getContextConfig, setContextConfig, type ContextConfig } from '../config/context.js';
import { getPersonas, getSelectedPersona, setSelectedPersona, savePersona, deletePersona, type PersonaId } from '../config/personas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export function createApiRouter() {
  const router = Router();

  // ============================================
  // АВТОРИЗАЦИЯ — все /api/* роуты защищены
  // ============================================
  router.use(authMiddleware);

  // ============================================
  // СТАТИСТИКА
  // ============================================
  router.get('/api/stats', async (req, res) => {
    try {
      const selectedModel = getSelectedModel();
      const modelConfig = getModelConfig();
      const dbStats = getDatabaseStats();

      const channels = channelRegistry.list().map(ch => ({ id: ch.id, name: ch.name }));
      const telegramPlugin = channelRegistry.get('telegram');

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
        channels,
        persona: {
          selected: getSelectedPersona(),
        },
      };

      if (telegramPlugin) {
        stats.telegram = { enabled: true };
      } else {
        stats.telegram = { enabled: false, message: 'Telegram канал не зарегистрирован.' };
      }

      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения статистики' });
    }
  });

  // ============================================
  // AI МОДЕЛИ
  // ============================================
  router.get('/api/models', (req, res) => {
    const modelConfig = getModelConfig();
    res.json({
      available: [
        { id: 'none', name: 'Без AI', provider: 'none' },
        { id: 'FREE', name: 'Gemini 2.0 Flash (Free)', provider: 'openai' },
        { id: 'BUDGET', name: 'DeepSeek Chat', provider: 'openai' },
        { id: 'PRO_CODE', name: 'Claude 3.5 Sonnet', provider: 'openai' },
        { id: 'FRONTIER', name: 'Claude 3.7 Sonnet', provider: 'openai' },
        { id: 'FREE_TOP', name: 'Kimi K2.5 (Free)', provider: 'openai' },
      ],
      selected: getSelectedModel(),
      config: modelConfig.provider !== 'none' ? {
        provider: modelConfig.provider,
        model: modelConfig.model,
        hasApiKey: !!modelConfig.apiKey,
      } : null,
    });
  });

  router.post('/api/models/select', (req, res) => {
    try {
      const { model } = req.body;
      const validModels: AIModel[] = ['none', 'FREE', 'BUDGET', 'PRO_CODE', 'FRONTIER', 'FREE_TOP'];
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

  // ============================================
  // ПЕРСОНЫ
  // ============================================
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

  router.post('/api/personas/select', (req, res) => {
    try {
      const { persona } = req.body;
      const personas = getPersonas();
      const valid = personas.find(p => p.id === persona);
      if (!valid) return res.status(400).json({ error: 'Неверная персона' });
      setSelectedPersona(persona as PersonaId);
      res.json({ success: true, selected: persona });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка выбора персоны' });
    }
  });

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

  router.delete('/api/personas/:id', (req, res) => {
    try {
      const { id } = req.params;
      deletePersona(id);
      res.json({ success: true, deleted: id });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Ошибка удаления персоны' });
    }
  });

  // ============================================
  // AI ТЕСТ — через routeMessage() (Web канал)
  // ============================================

  router.post('/api/ai/test', async (req, res) => {
    try {
      const { message, chatId, images: rawImages } = req.body;
      const text = (message !== undefined && message !== null ? String(message) : '').trim();
      const imageAttachments = normalizeImageAttachments(rawImages);

      if (!text && imageAttachments.length === 0) {
        return res.status(400).json({ error: 'Требуется message или изображения (images)' });
      }

      const incoming: IncomingMessage = {
        channelId: 'web',
        chatId: chatId ? String(chatId) : `web_${Date.now()}`,
        userId: 'web_user',
        username: 'web_user',
        text,
        images: imageAttachments.length > 0 ? imageAttachments : undefined,
      };

      const result = await channelRegistry.handleMessage(incoming);

      if (!result) {
        return res.status(500).json({ error: 'Ошибка обработки' });
      }

      res.json({
        success: true,
        response: result.text,
        model: result.model,
        provider: result.provider,
        tokensUsed: result.tokensUsed,
        contextUsed: result.contextUsed ?? 0,
        contextEnabled: result.contextEnabled ?? false,
        contextTotal: result.contextTotal ?? 0,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка AI обработки';
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/ai/upload', upload.array('images', 5), async (req, res) => {
    try {
      const text = (req.body?.message ?? '').trim();
      const chatId = req.body?.chatId?.trim() || undefined;
      const files = (req.files as Express.Multer.File[]) ?? [];

      if (!text && files.length === 0) {
        return res.status(400).json({ error: 'Требуется message или изображения (images)' });
      }

      const imageAttachments: ImageAttachment[] = files
        .filter(f => f.mimetype?.startsWith('image/'))
        .map(f => ({ data: f.buffer.toString('base64'), mediaType: f.mimetype || 'image/jpeg' }));

      const incoming: IncomingMessage = {
        channelId: 'web',
        chatId: chatId ? String(chatId) : `web_${Date.now()}`,
        userId: 'web_user',
        username: 'web_user',
        text,
        images: imageAttachments.length > 0 ? imageAttachments : undefined,
      };

      const result = await channelRegistry.handleMessage(incoming);

      if (!result) {
        return res.status(500).json({ error: 'Ошибка обработки' });
      }

      res.json({
        success: true,
        response: result.text,
        model: result.model,
        provider: result.provider,
        tokensUsed: result.tokensUsed,
        contextUsed: result.contextUsed ?? 0,
        contextEnabled: result.contextEnabled ?? false,
        contextTotal: result.contextTotal ?? 0,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка AI обработки';
      res.status(500).json({ error: msg });
    }
  });

  // ============================================
  // ОТПРАВКА СООБЩЕНИЙ (через реестр каналов)
  // ============================================
  router.post('/api/send', async (req, res) => {
    try {
      const { chatId, message } = req.body;
      if (!chatId || !message) {
        return res.status(400).json({ error: 'Требуются chatId и message' });
      }

      const telegram = channelRegistry.get('telegram');
      if (!telegram) {
        return res.status(400).json({ error: 'Telegram канал не зарегистрирован.' });
      }

      await telegram.sendMessage({ chatId, text: message });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
  });

  // ============================================
  // ИСТОРИЯ
  // ============================================
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
      res.json({ success: true, chatId, total: data.total, limit: data.limit, offset: data.offset, count: data.messages.length, messages: data.messages });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения истории' });
    }
  });

  router.delete('/api/history/cleanup', (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const deleted = cleanupOldMessages(days);
      res.json({ success: true, deleted, days });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка удаления старых сообщений' });
    }
  });

  router.delete('/api/history/:chatId', (req, res) => {
    try {
      const { chatId } = req.params;
      const deleted = clearChatHistory(chatId);
      res.json({ success: true, deleted });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка очистки истории' });
    }
  });

  router.post('/api/history/add', (req, res) => {
    try {
      const { chatId, message, role } = req.body;
      if (!chatId || !message) return res.status(400).json({ error: 'Требуются chatId и message' });
      const isBot = role === 'assistant';
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

  // ============================================
  // БАЗА ДАННЫХ / ПОЛЬЗОВАТЕЛИ / СЕССИИ
  // ============================================
  router.get('/api/database/stats', (req, res) => {
    try { res.json({ success: true, stats: getDatabaseStats() }); }
    catch (error) { res.status(500).json({ error: 'Ошибка получения статистики БД' }); }
  });

  router.get('/api/users', (req, res) => {
    try { const users = getAllUsers(); res.json({ success: true, count: users.length, users }); }
    catch (error) { res.status(500).json({ error: 'Ошибка получения пользователей' }); }
  });

  router.get('/api/sessions', (req, res) => {
    try { const sessions = getActiveSessions(); res.json({ success: true, count: sessions.length, sessions }); }
    catch (error) { res.status(500).json({ error: 'Ошибка получения сессий' }); }
  });

  // ============================================
  // КОНТЕКСТНАЯ ПАМЯТЬ
  // ============================================
  router.get('/api/context/config', (req, res) => {
    try { res.json({ success: true, config: getContextConfig() }); }
    catch (error) { res.status(500).json({ error: 'Ошибка получения настроек контекста' }); }
  });

  router.post('/api/context/config', (req, res) => {
    try {
      const { enabled, maxMessages, maxTokens, includeSystemPrompt } = req.body;
      const updates: Partial<ContextConfig> = {};
      if (typeof enabled === 'boolean') updates.enabled = enabled;
      if (typeof maxMessages === 'number' && maxMessages > 0) updates.maxMessages = maxMessages;
      if (typeof maxTokens === 'number' && maxTokens > 0) updates.maxTokens = maxTokens;
      if (typeof includeSystemPrompt === 'boolean') updates.includeSystemPrompt = includeSystemPrompt;
      setContextConfig(updates);
      res.json({ success: true, config: getContextConfig() });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка обновления настроек контекста' });
    }
  });

  router.get('/api/context/:chatId', async (req, res) => {
    try {
      const { chatId } = req.params;
      const { message } = req.query;
      const contextMessages = await getContextForAI(chatId, message as string);
      const stats = getContextStats(chatId);
      res.json({ success: true, chatId, messages: contextMessages, stats });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения контекста' });
    }
  });

  return router;
}
