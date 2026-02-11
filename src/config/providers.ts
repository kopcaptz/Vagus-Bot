/**
 * providers.ts — Каталог моделей и провайдеров аутентификации.
 *
 * Разделяет понятия "модель" и "провайдер аутентификации":
 *  - AuthProvider  — откуда берутся credentials (OpenRouter key / Google OAuth)
 *  - ModelCatalogEntry — описание модели и её capabilities
 *  - runtime resolver — какая модель доступна под текущей авторизацией
 */

// ─── Auth Provider ───────────────────────────────────────────────

export type AuthProviderId = 'openrouter_key' | 'google_oauth';

export interface AuthProviderMeta {
  id: AuthProviderId;
  name: string;
  description: string;
  /** Бесплатно, но без SLA */
  isFree: boolean;
  /** Настроен и готов к использованию */
  configured: boolean;
}

// ─── Model Catalog ───────────────────────────────────────────────

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsOAuth: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  /** Провайдеры авторизации, через которые модель доступна */
  availableVia: AuthProviderId[];
  capabilities: ProviderCapabilities;
  /** Модельный идентификатор для API-вызова (зависит от провайдера) */
  apiModelIds: Partial<Record<AuthProviderId, string>>;
  /** Тир для сортировки: free / budget / pro / frontier */
  tier: 'free' | 'budget' | 'pro' | 'frontier';
}

/** Центральный каталог всех поддерживаемых моделей */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ─── Google OAuth (Gemini Preview) ────────────────────────
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash (Google OAuth)',
    availableVia: ['google_oauth'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: true },
    apiModelIds: { google_oauth: 'gemini-2.0-flash' },
    tier: 'free',
  },
  {
    id: 'gemini-2.5-flash-preview',
    name: 'Gemini 2.5 Flash Preview (Google OAuth)',
    availableVia: ['google_oauth'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: true },
    apiModelIds: { google_oauth: 'gemini-2.5-flash-preview-05-20' },
    tier: 'pro',
  },
  {
    id: 'gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro Preview (Google OAuth)',
    availableVia: ['google_oauth'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: true },
    apiModelIds: { google_oauth: 'gemini-2.5-pro-preview-05-06' },
    tier: 'frontier',
  },
  // ─── OpenRouter (API Key) ─────────────────────────────────
  {
    id: 'or-free',
    name: 'Gemini 2.0 Flash (Free via OpenRouter)',
    availableVia: ['openrouter_key'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: false },
    apiModelIds: { openrouter_key: 'google/gemini-2.0-flash-exp:free' },
    tier: 'free',
  },
  {
    id: 'or-budget',
    name: 'DeepSeek Chat (OpenRouter)',
    availableVia: ['openrouter_key'],
    capabilities: { supportsTools: true, supportsVision: false, supportsStreaming: true, supportsOAuth: false },
    apiModelIds: { openrouter_key: 'deepseek/deepseek-chat' },
    tier: 'budget',
  },
  {
    id: 'or-pro-code',
    name: 'Claude 3.5 Sonnet (OpenRouter)',
    availableVia: ['openrouter_key'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: false },
    apiModelIds: { openrouter_key: 'anthropic/claude-3.5-sonnet' },
    tier: 'pro',
  },
  {
    id: 'or-frontier',
    name: 'Claude 3.7 Sonnet (OpenRouter)',
    availableVia: ['openrouter_key'],
    capabilities: { supportsTools: true, supportsVision: true, supportsStreaming: true, supportsOAuth: false },
    apiModelIds: { openrouter_key: 'anthropic/claude-3-7-sonnet' },
    tier: 'frontier',
  },
  {
    id: 'or-free-top',
    name: 'Kimi K2.5 (Free via OpenRouter)',
    availableVia: ['openrouter_key'],
    capabilities: { supportsTools: true, supportsVision: false, supportsStreaming: true, supportsOAuth: false },
    apiModelIds: { openrouter_key: 'moonshotai/kimi-k2.5:free' },
    tier: 'free',
  },
];

// ─── Runtime Resolver ────────────────────────────────────────────

/** Получить модели, доступные через данного провайдера авторизации */
export function getModelsForProvider(providerId: AuthProviderId): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter(m => m.availableVia.includes(providerId));
}

/** Получить рекомендованную модель для данного провайдера */
export function getRecommendedModel(providerId: AuthProviderId): ModelCatalogEntry | undefined {
  const models = getModelsForProvider(providerId);
  // Предпочитаем: сначала budget, потом free, потом pro
  return models.find(m => m.tier === 'budget')
    || models.find(m => m.tier === 'free')
    || models[0];
}

/** Найти модель по id */
export function findModelById(modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find(m => m.id === modelId);
}
