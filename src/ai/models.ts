import { getModelConfig, getOpenRouterFallbackConfig, config, type ModelConfig } from '../config/config.js';
import { getSystemPrompt } from '../config/personas.js';
import type { ContextMessage } from '../db/context.js';
import { skillRegistry } from '../skills/registry.js';
import { fetchWithRetry } from './retry.js';

export interface AIResponse {
  text: string;
  model: string;
  provider: string;
  tokensUsed?: number;
}

/** Вложение изображения для Vision: base64-данные и MIME-тип */
export interface ImageAttachment {
  data: string;   // base64
  mediaType: string; // e.g. image/jpeg, image/png
}

/**
 * Helper function to build user content with optional image attachments.
 * Normalizes the construction of user messages with text and optional image attachments across different AI providers.
 */
export function buildMultimodalUserContent<T>(
  message: string,
  imageAttachments: ImageAttachment[] | undefined,
  imageMapper: (img: ImageAttachment) => T
): string | Array<{ type: 'text'; text: string } | T> {
  if (!imageAttachments || imageAttachments.length === 0) {
    return message;
  }
  const parts: Array<{ type: 'text'; text: string } | T> = [];
  if (message.trim()) {
    parts.push({ type: 'text', text: message });
  }
  for (const img of imageAttachments) {
    parts.push(imageMapper(img));
  }
  return parts;
}

// ============================================
// Главная точка входа с failover
// ============================================

/**
 * Обработать сообщение с AI.
 * При ошибке основного провайдера — автоматический failover на альтернативный.
 */
export async function processWithAI(
  message: string,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>,
): Promise<AIResponse | null> {
  const modelConfig = getModelConfig();

  if (modelConfig.provider === 'none') {
    return null;
  }

  try {
    return await callProvider(modelConfig, message, contextMessages, imageAttachments, onStatus);
  } catch (error) {
    // Попытка failover на альтернативный провайдер
    const fallback = getFallbackConfig(modelConfig);
    if (fallback) {
      console.warn(`⚠️ ${modelConfig.provider} failed, trying ${fallback.provider}...`);
      await onStatus?.(`Переключаюсь на ${fallback.provider}...`);
      try {
        return await callProvider(fallback, message, contextMessages, imageAttachments, onStatus);
      } catch (fallbackError) {
        console.error('❌ Failover тоже не удался:', fallbackError);
        throw error; // Бросаем оригинальную ошибку
      }
    }
    throw error;
  }
}

/** Вызвать конкретного провайдера */
async function callProvider(
  modelConfig: ModelConfig,
  message: string,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>,
): Promise<AIResponse> {
  switch (modelConfig.provider) {
    case 'openai':
      return await processWithOpenAI(message, modelConfig, contextMessages, imageAttachments, onStatus);
    case 'anthropic':
      return await processWithAnthropic(message, modelConfig, contextMessages, imageAttachments, onStatus);
    default:
      throw new Error(`Неизвестный провайдер: ${modelConfig.provider}`);
  }
}

/** Получить fallback-конфиг: при сбое любого OpenRouter-тира — BUDGET (DeepSeek). */
function getFallbackConfig(current: ModelConfig): ModelConfig | null {
  if (current.baseUrl) return getOpenRouterFallbackConfig();
  return null;
}

// ============================================
// OpenAI
// ============================================

type OpenAIMessage =
  | { role: string; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

async function processWithOpenAI(
  message: string,
  modelConfig: ModelConfig,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>,
): Promise<AIResponse> {
  if (!modelConfig.apiKey) {
    throw new Error('OpenAI API ключ не установлен');
  }

  const hasImages = imageAttachments && imageAttachments.length > 0;
  const model = hasImages && modelConfig.model === 'gpt-3.5-turbo' ? 'gpt-4o' : modelConfig.model;

  let messages: OpenAIMessage[] = [];

  const openaiImageMapper = (img: ImageAttachment) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  });

  if (contextMessages && contextMessages.length > 0) {
    const contextOnly = contextMessages.slice(0, -1);
    messages = contextOnly.map(msg => ({
      role: msg.role,
      content: msg.content,
    })) as OpenAIMessage[];

    const userContent = buildMultimodalUserContent(message, imageAttachments, openaiImageMapper);
    messages.push({ role: 'user', content: userContent });

    console.log(`📚 Используется контекст: ${contextMessages.length} сообщений${hasImages ? ` + ${imageAttachments!.length} изображение(й)` : ''}`);
  } else {
    messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: buildMultimodalUserContent(message, imageAttachments, openaiImageMapper) },
    ];
  }

  const tools = skillRegistry.isEnabled() ? skillRegistry.getAllToolsForOpenAI() : undefined;
  let totalTokens = 0;
  let iterations = 0;

  while (true) {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: config.ai.maxTokens,
      temperature: 0.7,
    };
    if (tools) body.tools = tools;

    const baseUrl = (modelConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${modelConfig.apiKey}`,
    };
    if (modelConfig.baseUrl) {
      headers['HTTP-Referer'] = config.ai.siteUrl;
      headers['X-Title'] = config.ai.siteName;
    }
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as any;
      const errorMessage = error?.error?.message || JSON.stringify(error);
      if (error?.error?.code === 'invalid_api_key') {
        throw new Error('❌ Неверный API ключ OpenAI. Проверьте ключ в файле .env.');
      }
      throw new Error(`OpenAI API error: ${errorMessage}`);
    }

    const data = await response.json() as any;
    const msg = data.choices?.[0]?.message;
    totalTokens += data.usage?.total_tokens ?? 0;

    const toolCalls = msg?.tool_calls;
    if (tools && Array.isArray(toolCalls) && toolCalls.length > 0 && iterations < config.ai.maxIterations) {
      messages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: toolCalls.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
        })),
      });
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? '';
        const argsJson = tc.function?.arguments ?? '{}';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsJson);
        } catch {
          args = {};
        }
        await onStatus?.(`Использую ${name}...`);
        const result = await skillRegistry.executeTool(name, args);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      iterations++;
      await onStatus?.(`Анализирую результаты (итерация ${iterations})...`);
      continue;
    }

    return {
      text: msg?.content ?? 'Нет ответа',
      model: data.model ?? modelConfig.model,
      provider: 'openai',
      tokensUsed: totalTokens || data.usage?.total_tokens,
    };
  }
}

// ============================================
// Anthropic
// ============================================

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] };

async function processWithAnthropic(
  message: string,
  modelConfig: ModelConfig,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[],
  onStatus?: (status: string) => Promise<void>,
): Promise<AIResponse> {
  if (!modelConfig.apiKey) {
    throw new Error('Anthropic API ключ не установлен');
  }

  const hasImages = imageAttachments && imageAttachments.length > 0;
  let messages: AnthropicMessage[] = [];
  let systemPrompt: string | undefined = undefined;

  const anthropicImageMapper = (img: ImageAttachment) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
  });

  if (contextMessages && contextMessages.length > 0) {
    const systemMsg = contextMessages.find(msg => msg.role === 'system');
    if (systemMsg) systemPrompt = systemMsg.content;

    const contextOnly = contextMessages.filter(m => m.role !== 'system').slice(0, -1);
    messages = contextOnly.map(msg => ({
      role: (msg.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: msg.content,
    }));

    const userContent = buildMultimodalUserContent(message, imageAttachments, anthropicImageMapper);
    messages.push({ role: 'user', content: userContent });

    console.log(`📚 Используется контекст: ${contextMessages.length} сообщений${hasImages ? ` + ${imageAttachments!.length} изображение(й)` : ''}`);
  } else {
    systemPrompt = getSystemPrompt();
    messages = [
      { role: 'user', content: buildMultimodalUserContent(message, imageAttachments, anthropicImageMapper) },
    ];
  }

  const tools = skillRegistry.isEnabled() ? skillRegistry.getAllToolsForAnthropic() : undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;

  while (true) {
    const requestBody: Record<string, unknown> = {
      model: modelConfig.model,
      max_tokens: config.ai.maxTokens,
      messages,
    };
    if (systemPrompt) requestBody.system = systemPrompt;
    if (tools) requestBody.tools = tools;

    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': modelConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as any;
      throw new Error(`Anthropic API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json() as any;
    const content = data.content ?? [];
    totalInputTokens += data.usage?.input_tokens ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;

    const toolUses = content.filter((b: AnthropicContentBlock) => b.type === 'tool_use');
    if (tools && toolUses.length > 0 && iterations < config.ai.maxIterations) {
      messages.push({ role: 'assistant', content });
      const toolResults: AnthropicContentBlock[] = [];
      for (const tu of toolUses as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>) {
        await onStatus?.(`Использую ${tu.name}...`);
        const result = await skillRegistry.executeTool(tu.name, tu.input ?? {});
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      iterations++;
      await onStatus?.(`Анализирую результаты (итерация ${iterations})...`);
      continue;
    }

    const textBlock = content.find((b: AnthropicContentBlock) => b.type === 'text');
    return {
      text: textBlock?.type === 'text' ? textBlock.text : 'Нет ответа',
      model: modelConfig.model,
      provider: 'anthropic',
      tokensUsed: totalInputTokens + totalOutputTokens || undefined,
    };
  }
}
