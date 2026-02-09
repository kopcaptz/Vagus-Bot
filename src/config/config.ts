import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { join } from 'path';

dotenv.config();

export const OPENROUTER_MODEL_TIERS = {
  FREE: 'google/gemini-2.0-flash-exp:free',
  BUDGET: 'deepseek/deepseek-chat',
  PRO_CODE: 'anthropic/claude-3.5-sonnet',
  FRONTIER: 'anthropic/claude-3-7-sonnet',
  FREE_TOP: 'moonshotai/kimi-k2.5:free',
} as const;
export type OpenRouterTier = keyof typeof OPENROUTER_MODEL_TIERS;

export type AIModel = OpenRouterTier | 'none';

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'none';
  model: string;
  apiKey: string;
  /** When set, use this base URL (e.g. OpenRouter) and add attribution headers. */
  baseUrl?: string;
}

// Функция для получения актуальных значений из env
function getEnvValue(key: string, defaultValue: string = ''): string {
  dotenv.config(); // Перезагружаем env при каждом запросе
  return process.env[key] || defaultValue;
}

export const config = {
  telegram: {
    token: getEnvValue('TELEGRAM_BOT_TOKEN'),
    enabled:
      !!getEnvValue('TELEGRAM_BOT_TOKEN') &&
      getEnvValue('TELEGRAM_ENABLED', 'true').toLowerCase() !== 'false',
  },
  server: {
    port: parseInt(getEnvValue('PORT', '3000'), 10),
    host: getEnvValue('HOST', '0.0.0.0'), // 0.0.0.0 для доступа из сети
  },
  ai: {
    baseUrl: getEnvValue('BASE_URL'),
    openrouterKey: getEnvValue('OPENROUTER_API_KEY'),
    siteName: 'Vagus Bot',
    siteUrl: 'http://localhost:3013',
    maxTokens: parseInt(getEnvValue('AI_MAX_TOKENS', '4096'), 10),
    maxIterations: parseInt(getEnvValue('AI_MAX_ITERATIONS', '10'), 10),
    maxRetries: parseInt(getEnvValue('AI_MAX_RETRIES', '2'), 10),
  },
  tools: {
    enabled: getEnvValue('TOOLS_ENABLED', 'false').toLowerCase() === 'true',
    workspaceRoot: getEnvValue('WORKSPACE_ROOT') || '',
    commandTimeoutMs: Math.max(5000, parseInt(getEnvValue('TOOL_COMMAND_TIMEOUT_MS', '15000'), 10) || 15000),
  },
  security: {
    adminToken: getEnvValue('ADMIN_TOKEN') || '',
    telegramAllowlist: (getEnvValue('TELEGRAM_ALLOWLIST') || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    telegramAccessMode: (getEnvValue('TELEGRAM_ACCESS_MODE', 'open') as 'open' | 'allowlist'),
  },
  drive: {
    // Windows: normalize so path works with fs (handles "Мой диск" space); exact path as in Explorer
    root: getEnvValue('DRIVE_ROOT') || (process.platform === 'win32' ? path.normalize('G:/Мой диск/Vagus-Bot') : '/app/drive'),
  },
  embeddings: {
    baseUrl: getEnvValue('EMBEDDINGS_BASE_URL') || getEnvValue('BASE_URL') || 'https://openrouter.ai/api/v1',
    apiKey: getEnvValue('EMBEDDINGS_API_KEY') || getEnvValue('OPENROUTER_API_KEY'),
    model: getEnvValue('EMBEDDINGS_MODEL', 'text-embedding-3-small'),
    timeoutMs: Math.max(5000, parseInt(getEnvValue('EMBEDDINGS_TIMEOUT_MS', '10000'), 10) || 10000),
  },
  /** Модель по умолчанию при первом запуске (пока пользователь не выбрал в веб-интерфейсе). */
  defaultModel: ((): AIModel => {
    const v = getEnvValue('DEFAULT_MODEL', 'BUDGET').toUpperCase();
    const valid: OpenRouterTier[] = ['FREE', 'BUDGET', 'PRO_CODE', 'FRONTIER', 'FREE_TOP'];
    return valid.includes(v as OpenRouterTier) ? (v as AIModel) : 'BUDGET';
  })(),
};

// Путь к файлу с выбранной моделью
const MODEL_CONFIG_PATH = join(process.cwd(), '.model-config.json');

const VALID_AI_MODELS: AIModel[] = ['FREE', 'BUDGET', 'PRO_CODE', 'FRONTIER', 'FREE_TOP', 'none'];

// Загрузка выбранной модели (если ещё не выбрана — используем DEFAULT_MODEL из env)
export function getSelectedModel(): AIModel {
  if (existsSync(MODEL_CONFIG_PATH)) {
    try {
      const data = readFileSync(MODEL_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      const stored = (parsed.model || 'none') as string;
      if (stored !== 'none' && VALID_AI_MODELS.includes(stored as AIModel)) return stored as AIModel;
    } catch {
      // fall through to default
    }
  }
  return config.defaultModel;
}

// Сохранение выбранной модели
export function setSelectedModel(model: AIModel) {
  writeFileSync(MODEL_CONFIG_PATH, JSON.stringify({ model }, null, 2));
}

/** При первом запуске записать модель по умолчанию, чтобы бот работал без выбора в веб-интерфейсе. */
export function ensureDefaultModel(): void {
  if (!existsSync(MODEL_CONFIG_PATH)) {
    setSelectedModel(config.defaultModel);
    console.log(`📌 Модель по умолчанию установлена: ${config.defaultModel}`);
  }
}

// Получение конфигурации модели
export function getModelConfig(): ModelConfig {
  const selectedModel = getSelectedModel();
  if (selectedModel === 'none') {
    return { provider: 'none', model: 'none', apiKey: '' };
  }
  return {
    provider: 'openai',
    model: OPENROUTER_MODEL_TIERS[selectedModel],
    apiKey: config.ai.openrouterKey,
    baseUrl: config.ai.baseUrl,
  };
}

/** Fallback config for OpenRouter: always BUDGET (DeepSeek). Used when any tier fails. */
export function getOpenRouterFallbackConfig(): ModelConfig {
  return {
    provider: 'openai',
    model: OPENROUTER_MODEL_TIERS.BUDGET,
    apiKey: config.ai.openrouterKey,
    baseUrl: config.ai.baseUrl,
  };
}
