/**
 * registry.ts — реестр навыков (skills).
 *
 * Единый источник инструментов для AI.
 * models.ts не знает, какие навыки зарегистрированы —
 * он запрашивает схемы и делегирует выполнение через реестр.
 */

import type { Skill, ToolDefinition } from './types.js';
import { config } from '../config/config.js';

class SkillRegistry {
  private skills = new Map<string, Skill>();
  /** tool name → skill id (для быстрого поиска при executeTool) */
  private toolOwner = new Map<string, string>();

  /** Зарегистрировать навык */
  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      console.warn(`⚠️ Навык "${skill.id}" уже зарегистрирован, перезаписываю`);
    }
    this.skills.set(skill.id, skill);

    // Строим индекс tool → skill
    for (const tool of skill.getTools()) {
      if (this.toolOwner.has(tool.name)) {
        console.warn(`⚠️ Инструмент "${tool.name}" уже зарегистрирован навыком "${this.toolOwner.get(tool.name)}", перезаписываю на "${skill.id}"`);
      }
      this.toolOwner.set(tool.name, skill.id);
    }

    console.log(`🔧 Навык зарегистрирован: ${skill.name} (${skill.id}) — ${skill.getTools().length} инструментов`);
  }

  /** Включены ли инструменты глобально */
  isEnabled(): boolean {
    return config.tools.enabled && this.skills.size > 0;
  }

  /** Список зарегистрированных навыков */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  // ============================================
  // Форматирование схем для провайдеров
  // ============================================

  /** Все инструменты в формате OpenAI function calling */
  getAllToolsForOpenAI(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    };
  }> {
    const result: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
      };
    }> = [];

    for (const skill of this.skills.values()) {
      for (const tool of skill.getTools()) {
        result.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        });
      }
    }

    return result;
  }

  /** Все инструменты в формате Anthropic tool use */
  getAllToolsForAnthropic(): Array<{
    name: string;
    description: string;
    input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  }> {
    const result: Array<{
      name: string;
      description: string;
      input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    }> = [];

    for (const skill of this.skills.values()) {
      for (const tool of skill.getTools()) {
        result.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        });
      }
    }

    return result;
  }

  // ============================================
  // Выполнение
  // ============================================

  /** Найти навык-владелец инструмента и выполнить */
  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const skillId = this.toolOwner.get(name);
    if (!skillId) {
      return `Неизвестный инструмент: ${name}`;
    }

    const skill = this.skills.get(skillId);
    if (!skill) {
      return `Навык "${skillId}" не найден для инструмента "${name}"`;
    }

    console.log(`🔧 [${skill.id}] ${name}`, args);

    try {
      return await skill.execute(name, args);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Ошибка выполнения ${name}: ${msg}`;
    }
  }
}

/** Единственный экземпляр реестра навыков */
export const skillRegistry = new SkillRegistry();
