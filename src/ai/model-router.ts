/**
 * model-router.ts — LLM-роутер выбора модели по типу запроса.
 * Быстрый вызов на FREE (Gemini 2.0 Flash) классифицирует сообщение
 * и возвращает оптимальный tier для основного ответа.
 */

import { config, OPENROUTER_MODEL_TIERS, type OpenRouterTier } from '../config/config.js';
import { fetchWithRetry } from './retry.js';

const VALID_TIERS: OpenRouterTier[] = ['FREE', 'BUDGET', 'PRO_CODE', 'FRONTIER', 'FREE_TOP'];

const ROUTER_SYSTEM_PROMPT = `Select the best AI model tier for the user's message. Reply with exactly one word: FREE, BUDGET, PRO_CODE, FRONTIER, or FREE_TOP.

FREE — simple chat, greetings, trivial questions
BUDGET — general conversation, everyday tasks
PRO_CODE — code, refactoring, technical tasks
FRONTIER — complex analysis, multi-step reasoning
FREE_TOP — alternative to FREE (Kimi)`;

const MESSAGE_MAX_LENGTH = 500;

/**
 * Выбрать модель по типу задачи через быстрый вызов FREE tier.
 * При ошибке или невалидном ответе — бросает исключение (вызывающий код использует getSelectedModel).
 */
export async function selectModelForTask(message: string, hasImages?: boolean): Promise<OpenRouterTier> {
  if (!config.ai.openrouterKey) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  let text = message.trim();
  if (hasImages) {
    text = '[прикреплено изображений] ' + text;
  }
  if (text.length > MESSAGE_MAX_LENGTH) {
    text = text.slice(0, MESSAGE_MAX_LENGTH) + '...';
  }
  if (!text) {
    text = '[пустое сообщение]';
  }

  const baseUrl = (config.ai.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai.openrouterKey}`,
      'HTTP-Referer': config.ai.siteUrl,
      'X-Title': config.ai.siteName,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_TIERS.FREE,
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 20,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Model router API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() || '';

  // Extract first word that matches a valid tier (case insensitive)
  const match = content.match(/\b(FREE|BUDGET|PRO_CODE|FRONTIER|FREE_TOP)\b/i);
  const tier = match ? (match[1].toUpperCase() as OpenRouterTier) : null;

  if (tier && VALID_TIERS.includes(tier)) {
    console.log(`🔀 Model router: selected tier ${tier} for task`);
    return tier;
  }

  const fallback: OpenRouterTier = config.defaultModel === 'none' ? 'BUDGET' : (config.defaultModel as OpenRouterTier);
  console.warn(`⚠️ Model router: invalid response "${content}", using ${fallback}`);
  return fallback;
}
