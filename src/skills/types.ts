/**
 * types.ts — контракт для модульных навыков (skills).
 *
 * ToolDefinition — провайдер-агностичная схема (JSON Schema).
 * Реестр форматирует её в формат OpenAI/Anthropic.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  /** Вернуть список инструментов этого навыка */
  getTools(): ToolDefinition[];

  /** Выполнить конкретный инструмент. Возвращает строку-результат для AI. */
  execute(toolName: string, args: Record<string, unknown>): Promise<string>;
}
