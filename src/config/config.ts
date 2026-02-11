import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { join } from 'path';
import type { AuthProviderId } from './providers.js';

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
  provider: 'openai' | 'anthropic' | 'google_gemini' | 'none';
  model: string;
  apiKey: string;
  /** When set, use this base URL (e.g. OpenRouter) and add attribution headers. */
  baseUrl?: string;
  /** Auth provider that supplied the credentials */
  authProvider?: AuthProviderId;
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
  skillGateway: {
    enabled: getEnvValue('SKILL_GATEWAY_ENABLED', 'false').toLowerCase() === 'true',
    killSwitch: getEnvValue('SKILL_GATEWAY_KILL', '').toLowerCase() === '1' || getEnvValue('SKILL_GATEWAY_KILL', '').toLowerCase() === 'true',
    requestTimeoutMs: Math.max(1000, parseInt(getEnvValue('SKILL_GATEWAY_REQUEST_TIMEOUT_MS', '10000'), 10) || 10000),
    allowedProtocols: (getEnvValue('SKILL_GATEWAY_ALLOWED_PROTOCOLS', 'https') || 'https')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    registryPath: getEnvValue('SKILL_GATEWAY_REGISTRY_PATH', './config/skill-gateway.registry.json'),
    protocolVersion: getEnvValue('SKILL_GATEWAY_PROTOCOL_VERSION', '1.0'),
    timestampSkewSeconds: Math.max(0, parseInt(getEnvValue('SKILL_GATEWAY_TIMESTAMP_SKEW_SECONDS', '120'), 10) || 120),
    nonceTtlSeconds: Math.max(1, parseInt(getEnvValue('SKILL_GATEWAY_NONCE_TTL_SECONDS', '300'), 10) || 300),
  },
  security: {
    adminToken: getEnvValue('ADMIN_TOKEN') || '',
    telegramAllowlist: (getEnvValue('TELEGRAM_ALLOWLIST') || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    telegramAccessMode: (getEnvValue('TELEGRAM_ACCESS_MODE', 'open') as 'open' | 'allowlist'),
    /** Хозяин бота: user_id или @username. Если задан — только он получает полный ответ; остальные — гости. */
    telegramOwner: getEnvValue('TELEGRAM_OWNER').trim() || null,
    /** Режим для гостей: block (отказ), greeting (кастомное приветствие) */
    telegramGuestMode: (getEnvValue('TELEGRAM_GUEST_MODE', 'block') as 'block' | 'greeting'),
    /** Сообщение для гостей при режиме greeting */
    telegramGuestMessage: getEnvValue('TELEGRAM_GUEST_MESSAGE') ||
      '👋 Привет! Я личный бот. Мой хозяин сейчас занят. Оставьте сообщение — он прочитает позже.',
  },
  drive: {
    // Windows: normalize so path works with fs (handles "Мой диск" space); exact path as in Explorer
    root: getEnvValue('DRIVE_ROOT') || getEnvValue('VAGUS_DRIVE_HOST') || (process.platform === 'win32' ? path.normalize('G:/Мой диск/Vagus-Bot') : '/app/drive'),
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
<<<<<<< HEAD
  /** Google OAuth config */
  googleOAuth: {
    clientId: getEnvValue('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: getEnvValue('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: getEnvValue('GOOGLE_OAUTH_REDIRECT_URI'),
    /** Default Gemini model when using Google OAuth */
    defaultModel: getEnvValue('GOOGLE_GEMINI_MODEL', 'gemini-2.0-flash'),
=======
  modelRouter: {
    enabled: getEnvValue('MODEL_ROUTER_ENABLED', 'false').toLowerCase() === 'true',
>>>>>>> 4487979 (feat: implement dashboard i18n, model router, and secure skill gateway)
  },
};

// Путь к файлу с выбранной моделью
const MODEL_CONFIG_PATH = join(process.cwd(), '.model-config.json');

const VALID_AI_MODELS: AIModel[] = ['FREE', 'BUDGET', 'PRO_CODE', 'FRONTIER', 'FREE_TOP', 'none'];
const VALID_AUTH_PROVIDERS: AuthProviderId[] = ['openrouter_key', 'google_oauth'];

// ─── Auth provider selection ─────────────────────────────────────

interface ModelConfigFile {
  model?: string;
  authProvider?: AuthProviderId;
  /** Выбранная Gemini-модель при Google OAuth */
  googleModel?: string;
}

function readModelConfigFile(): ModelConfigFile {
  if (!existsSync(MODEL_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MODEL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeModelConfigFile(updates: Partial<ModelConfigFile>): void {
  const current = readModelConfigFile();
  writeFileSync(MODEL_CONFIG_PATH, JSON.stringify({ ...current, ...updates }, null, 2));
}

// ─── Auth Provider ───────────────────────────────────────────────

export function getSelectedAuthProvider(): AuthProviderId {
  const data = readModelConfigFile();
  if (data.authProvider && VALID_AUTH_PROVIDERS.includes(data.authProvider)) {
    return data.authProvider;
  }
  return 'openrouter_key';
}

export function setSelectedAuthProvider(provider: AuthProviderId): void {
  writeModelConfigFile({ authProvider: provider });
}

// ─── Google model selection (within Google OAuth) ────────────────

export function getSelectedGoogleModel(): string {
  const data = readModelConfigFile();
  return data.googleModel || config.googleOAuth.defaultModel;
}

export function setSelectedGoogleModel(model: string): void {
  writeModelConfigFile({ googleModel: model });
}

// ─── OpenRouter model (existing logic) ───────────────────────────

// Загрузка выбранной модели (если ещё не выбрана — используем DEFAULT_MODEL из env)
export function getSelectedModel(): AIModel {
  const data = readModelConfigFile();
  const stored = (data.model || 'none') as string;
  if (stored !== 'none' && VALID_AI_MODELS.includes(stored as AIModel)) return stored as AIModel;
  return config.defaultModel;
}

// Сохранение выбранной модели
export function setSelectedModel(model: AIModel) {
  writeModelConfigFile({ model });
}

/** При первом запуске записать модель по умолчанию, чтобы бот работал без выбора в веб-интерфейсе. */
export function ensureDefaultModel(): void {
  if (!existsSync(MODEL_CONFIG_PATH)) {
    setSelectedModel(config.defaultModel);
    console.log(`📌 Модель по умолчанию установлена: ${config.defaultModel}`);
  }
}

// ─── Model config resolver ───────────────────────────────────────

/**
 * Получение конфигурации модели.
 * Учитывает выбранный authProvider:
 *  - openrouter_key → OpenRouter (как раньше)
 *  - google_oauth   → Google Gemini через OAuth access_token
 *
 * Для google_oauth apiKey будет заполнен при вызове (через getValidAccessToken).
 * Здесь ставим placeholder — callProvider проверит и подставит реальный токен.
 */
export function getModelConfig(): ModelConfig {
  const authProvider = getSelectedAuthProvider();

  if (authProvider === 'google_oauth') {
    const googleModel = getSelectedGoogleModel();
    return {
      provider: 'google_gemini',
      model: googleModel,
      apiKey: '', // будет подставлен динамически из OAuth tokens
      authProvider: 'google_oauth',
    };
  }

  // Default: OpenRouter
  const selectedModel = getSelectedModel();
  if (selectedModel === 'none') {
    return { provider: 'none', model: 'none', apiKey: '', authProvider: 'openrouter_key' };
  }
  return getModelConfigForTier(selectedModel as OpenRouterTier);
}

/** Конфигурация для конкретного tier (для model router override). */
export function getModelConfigForTier(tier: OpenRouterTier): ModelConfig {
  return {
    provider: 'openai',
    model: OPENROUTER_MODEL_TIERS[tier],
    apiKey: config.ai.openrouterKey,
    baseUrl: config.ai.baseUrl,
    authProvider: 'openrouter_key',
  };
}

/** Fallback config for OpenRouter: always BUDGET (DeepSeek). Used when any tier fails. */
export function getOpenRouterFallbackConfig(): ModelConfig {
  return {
    provider: 'openai',
    model: OPENROUTER_MODEL_TIERS.BUDGET,
    apiKey: config.ai.openrouterKey,
    baseUrl: config.ai.baseUrl,
    authProvider: 'openrouter_key',
  };
}
