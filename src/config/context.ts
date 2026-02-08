import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Настройки контекстной памяти
 */
export interface ContextConfig {
  enabled: boolean;           // Включена ли контекстная память
  maxMessages: number;         // Максимальное количество сообщений для контекста
  maxTokens: number;          // Максимальное количество токенов (приблизительно)
  includeSystemPrompt: boolean; // Включать ли системный промпт в контекст
}

// Путь к файлу с настройками контекста
const CONTEXT_CONFIG_PATH = join(process.cwd(), '.context-config.json');

// Значения по умолчанию
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  enabled: true,
  maxMessages: 10,            // Последние 10 сообщений
  maxTokens: 2000,           // ~2000 токенов (примерно 1500 слов)
  includeSystemPrompt: true,
};

/**
 * Загрузить настройки контекста
 */
export function getContextConfig(): ContextConfig {
  if (existsSync(CONTEXT_CONFIG_PATH)) {
    try {
      const data = readFileSync(CONTEXT_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      // Объединяем с дефолтными значениями на случай, если какие-то поля отсутствуют
      return { ...DEFAULT_CONTEXT_CONFIG, ...parsed };
    } catch (error) {
      console.warn('⚠️ Ошибка загрузки настроек контекста, используются значения по умолчанию:', error);
      return DEFAULT_CONTEXT_CONFIG;
    }
  }
  return DEFAULT_CONTEXT_CONFIG;
}

/**
 * Сохранить настройки контекста
 */
export function setContextConfig(config: Partial<ContextConfig>) {
  const currentConfig = getContextConfig();
  const newConfig = { ...currentConfig, ...config };
  writeFileSync(CONTEXT_CONFIG_PATH, JSON.stringify(newConfig, null, 2));
  console.log('✅ Настройки контекста обновлены:', newConfig);
}

/**
 * Сбросить настройки контекста к значениям по умолчанию
 */
export function resetContextConfig() {
  if (existsSync(CONTEXT_CONFIG_PATH)) {
    writeFileSync(CONTEXT_CONFIG_PATH, JSON.stringify(DEFAULT_CONTEXT_CONFIG, null, 2));
  }
  return DEFAULT_CONTEXT_CONFIG;
}
