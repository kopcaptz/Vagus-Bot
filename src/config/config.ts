import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

dotenv.config();

export type AIModel = 'openai-gpt-4' | 'openai-gpt-3.5' | 'anthropic-claude' | 'none';

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'none';
  model: string;
  apiKey: string;
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
    openaiKey: getEnvValue('OPENAI_API_KEY'),
    anthropicKey: getEnvValue('ANTHROPIC_API_KEY'),
  },
  tools: {
    enabled: getEnvValue('TOOLS_ENABLED', 'false').toLowerCase() === 'true',
    workspaceRoot: getEnvValue('WORKSPACE_ROOT') || '',
    commandTimeoutMs: Math.max(5000, parseInt(getEnvValue('TOOL_COMMAND_TIMEOUT_MS', '15000'), 10) || 15000),
  },
};

// Путь к файлу с выбранной моделью
const MODEL_CONFIG_PATH = join(process.cwd(), '.model-config.json');

// Загрузка выбранной модели
export function getSelectedModel(): AIModel {
  if (existsSync(MODEL_CONFIG_PATH)) {
    try {
      const data = readFileSync(MODEL_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.model || 'none';
    } catch {
      return 'none';
    }
  }
  return 'none';
}

// Сохранение выбранной модели
export function setSelectedModel(model: AIModel) {
  writeFileSync(MODEL_CONFIG_PATH, JSON.stringify({ model }, null, 2));
}

// Получение конфигурации модели
export function getModelConfig(): ModelConfig {
  const selectedModel = getSelectedModel();
  
  // Всегда читаем актуальные значения из env
  const openaiKey = getEnvValue('OPENAI_API_KEY');
  const anthropicKey = getEnvValue('ANTHROPIC_API_KEY');
  
  switch (selectedModel) {
    case 'openai-gpt-4':
      return {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: openaiKey,
      };
    case 'openai-gpt-3.5':
      return {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        apiKey: openaiKey,
      };
    case 'anthropic-claude':
      return {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: anthropicKey,
      };
    default:
      return {
        provider: 'none',
        model: 'none',
        apiKey: '',
      };
  }
}
