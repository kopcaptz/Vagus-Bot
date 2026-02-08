import { getModelConfig, type ModelConfig } from '../config/config.js';
import { getSystemPrompt } from '../config/personas.js';
import type { ContextMessage } from '../db/context.js';
import { skillRegistry } from '../skills/registry.js';

const MAX_TOOL_ITERATIONS = 5;

export interface AIResponse {
  text: string;
  model: string;
  provider: string;
  tokensUsed?: number; // Количество использованных токенов (если доступно)
}

/** Вложение изображения для Vision: base64-данные и MIME-тип */
export interface ImageAttachment {
  data: string;   // base64
  mediaType: string; // e.g. image/jpeg, image/png
}

/**
 * Обработать сообщение с AI, используя контекст и опционально изображения
 *
 * @param message - Текущее сообщение пользователя
 * @param contextMessages - Массив сообщений для контекста (опционально)
 * @param imageAttachments - Изображения для анализа (Vision)
 */
export async function processWithAI(
  message: string,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[]
): Promise<AIResponse | null> {
  const modelConfig = getModelConfig();

  if (modelConfig.provider === 'none') {
    return null;
  }

  try {
    switch (modelConfig.provider) {
      case 'openai':
        return await processWithOpenAI(message, modelConfig, contextMessages, imageAttachments);
      case 'anthropic':
        return await processWithAnthropic(message, modelConfig, contextMessages, imageAttachments);
      default:
        return null;
    }
  } catch (error) {
    console.error('❌ Ошибка AI обработки:', error);
    throw error;
  }
}

type OpenAIMessage =
  | { role: string; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'user'; content: Array<{ type: 'tool_result'; tool_call_id: string; content: string }> };

function buildOpenAIUserContent(message: string, imageAttachments?: ImageAttachment[]): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!imageAttachments || imageAttachments.length === 0) {
    return message;
  }
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  if (message.trim()) {
    parts.push({ type: 'text', text: message });
  }
  for (const img of imageAttachments) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
    });
  }
  return parts;
}

async function processWithOpenAI(
  message: string,
  config: ModelConfig,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[]
): Promise<AIResponse> {
  if (!config.apiKey) {
    throw new Error('OpenAI API ключ не установлен');
  }

  const hasImages = imageAttachments && imageAttachments.length > 0;
  const model = hasImages && config.model === 'gpt-3.5-turbo' ? 'gpt-4o' : config.model;

  let messages: OpenAIMessage[] = [];

  if (contextMessages && contextMessages.length > 0) {
    const contextOnly = contextMessages.slice(0, -1);
    messages = contextOnly.map(msg => ({
      role: msg.role,
      content: msg.content,
    })) as OpenAIMessage[];

    const userContent = buildOpenAIUserContent(message, imageAttachments);
    messages.push({ role: 'user', content: userContent });

    console.log(`📚 Используется контекст: ${contextMessages.length} сообщений${hasImages ? ` + ${imageAttachments!.length} изображение(й)` : ''}`);
  } else {
    messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: buildOpenAIUserContent(message, imageAttachments) },
    ];
  }

  const tools = skillRegistry.isEnabled() ? skillRegistry.getAllToolsForOpenAI() : undefined;
  let totalTokens = 0;
  let iterations = 0;

  while (true) {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    };
    if (tools && iterations === 0) body.tools = tools;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      const errorMessage = error?.error?.message || JSON.stringify(error);
      if (error?.error?.code === 'invalid_api_key') {
        throw new Error('❌ Неверный API ключ OpenAI. Проверьте ключ в файле .env. Получите новый ключ на https://platform.openai.com/account/api-keys');
      }
      throw new Error(`OpenAI API error: ${errorMessage}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    totalTokens += data.usage?.total_tokens ?? 0;

    const toolCalls = msg?.tool_calls;
    if (tools && Array.isArray(toolCalls) && toolCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      messages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: toolCalls.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
        })),
      });
      const toolResults: Array<{ type: 'tool_result'; tool_call_id: string; content: string }> = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? '';
        const argsJson = tc.function?.arguments ?? '{}';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsJson);
        } catch {
          args = {};
        }
        const result = await skillRegistry.executeTool(name, args);
        toolResults.push({ type: 'tool_result', tool_call_id: tc.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      iterations++;
      continue;
    }

    return {
      text: msg?.content ?? 'Нет ответа',
      model: data.model ?? config.model,
      provider: 'openai',
      tokensUsed: totalTokens || data.usage?.total_tokens,
    };
  }
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] };

function buildAnthropicUserContent(message: string, imageAttachments?: ImageAttachment[]): string | AnthropicContentBlock[] {
  if (!imageAttachments || imageAttachments.length === 0) {
    return message;
  }
  const blocks: AnthropicContentBlock[] = [];
  if (message.trim()) {
    blocks.push({ type: 'text', text: message });
  }
  for (const img of imageAttachments) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    });
  }
  return blocks;
}

async function processWithAnthropic(
  message: string,
  config: ModelConfig,
  contextMessages?: ContextMessage[],
  imageAttachments?: ImageAttachment[]
): Promise<AIResponse> {
  if (!config.apiKey) {
    throw new Error('Anthropic API ключ не установлен');
  }

  const hasImages = imageAttachments && imageAttachments.length > 0;
  let messages: AnthropicMessage[] = [];
  let systemPrompt: string | undefined = undefined;

  if (contextMessages && contextMessages.length > 0) {
    const systemMsg = contextMessages.find(msg => msg.role === 'system');
    if (systemMsg) systemPrompt = systemMsg.content;

    const contextOnly = contextMessages.filter(m => m.role !== 'system').slice(0, -1);
    messages = contextOnly.map(msg => ({
      role: (msg.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: msg.content,
    }));

    const userContent = buildAnthropicUserContent(message, imageAttachments);
    messages.push({ role: 'user', content: userContent });

    console.log(`📚 Используется контекст: ${contextMessages.length} сообщений${hasImages ? ` + ${imageAttachments!.length} изображение(й)` : ''}`);
  } else {
    systemPrompt = getSystemPrompt();
    messages = [
      { role: 'user', content: buildAnthropicUserContent(message, imageAttachments) },
    ];
  }

  const tools = skillRegistry.isEnabled() ? skillRegistry.getAllToolsForAnthropic() : undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;

  while (true) {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      max_tokens: 500,
      messages,
    };
    if (systemPrompt) requestBody.system = systemPrompt;
    if (tools && iterations === 0) requestBody.tools = tools;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Anthropic API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    const content = data.content ?? [];
    totalInputTokens += data.usage?.input_tokens ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;

    const toolUses = content.filter((b: AnthropicContentBlock) => b.type === 'tool_use');
    if (tools && toolUses.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      messages.push({ role: 'assistant', content });
      const toolResults: AnthropicContentBlock[] = [];
      for (const tu of toolUses as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>) {
        const result = await skillRegistry.executeTool(tu.name, tu.input ?? {});
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      iterations++;
      continue;
    }

    const textBlock = content.find((b: AnthropicContentBlock) => b.type === 'text');
    return {
      text: textBlock?.type === 'text' ? textBlock.text : 'Нет ответа',
      model: config.model,
      provider: 'anthropic',
      tokensUsed: totalInputTokens + totalOutputTokens || undefined,
    };
  }
}
