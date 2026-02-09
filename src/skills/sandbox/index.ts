/**
 * SandboxSkill — Code Interpreter.
 *
 * Выполняет JavaScript в изолированной WASM-песочнице (QuickJS).
 * Без доступа к файлам, сети, Node.js API.
 * Только чистая логика: математика, строки, JSON, массивы.
 */

import { getQuickJS, type QuickJSWASMModule } from 'quickjs-emscripten';
import type { Skill, ToolDefinition } from '../types.js';

const MEMORY_LIMIT = 10 * 1024 * 1024; // 10 MB
const TIMEOUT_MS = 5000; // 5 секунд
const MAX_OUTPUT = 8000; // символов в ответе

// Lazy-init QuickJS (WASM загружается ~100ms при первом вызове)
let quickJSModule: QuickJSWASMModule | null = null;

async function ensureQuickJS(): Promise<QuickJSWASMModule> {
  if (!quickJSModule) {
    quickJSModule = await getQuickJS();
  }
  return quickJSModule;
}

export class SandboxSkill implements Skill {
  readonly id = 'sandbox';
  readonly name = 'Code Interpreter';
  readonly description = 'Выполнение JavaScript кода в безопасной песочнице';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'code_exec',
        description: 'Выполнить JavaScript код в безопасной песочнице. Нет доступа к файлам, сети, Node.js. Используй для вычислений, обработки данных, JSON, математики, работы со строками и массивами.',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript код для выполнения' },
          },
          required: ['code'],
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (toolName !== 'code_exec') {
      return `Неизвестный инструмент в SandboxSkill: ${toolName}`;
    }

    const code = typeof args.code === 'string' ? args.code : '';
    if (!code.trim()) return 'Ошибка: пустой код.';

    try {
      return await this.runInSandbox(code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Ошибка песочницы: ${msg}`;
    }
  }

  private async runInSandbox(code: string): Promise<string> {
    const qjs = await ensureQuickJS();
    const runtime = qjs.newRuntime();

    // Лимит памяти
    runtime.setMemoryLimit(MEMORY_LIMIT);

    // Таймаут выполнения
    const deadline = Date.now() + TIMEOUT_MS;
    runtime.setInterruptHandler(() => Date.now() > deadline);

    const vm = runtime.newContext();
    const logs: string[] = [];

    try {
      // Инъекция console.log
      const consoleObj = vm.newObject();
      const logFn = vm.newFunction('log', (...fnArgs) => {
        const parts: string[] = [];
        for (const arg of fnArgs) {
          const str = vm.dump(arg);
          parts.push(typeof str === 'string' ? str : JSON.stringify(str));
        }
        logs.push(parts.join(' '));
      });
      vm.setProp(consoleObj, 'log', logFn);
      vm.setProp(vm.global, 'console', consoleObj);
      logFn.dispose();
      consoleObj.dispose();

      // Выполнение кода
      // Оборачиваем: если код — выражение, возвращаем его значение
      const wrappedCode = `
        try {
          const __result = eval(${JSON.stringify(code)});
          __result !== undefined ? JSON.stringify(__result) : 'undefined';
        } catch (e) {
          'Error: ' + e.message;
        }
      `;

      const result = vm.evalCode(wrappedCode);

      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();
        return `Ошибка выполнения: ${typeof error === 'string' ? error : JSON.stringify(error)}`;
      }

      const value = vm.dump(result.value);
      result.value.dispose();

      // Формируем ответ
      const parts: string[] = [];

      const resultStr = typeof value === 'string' ? value : JSON.stringify(value);
      if (resultStr && resultStr !== 'undefined') {
        parts.push(`Результат: ${resultStr}`);
      }

      if (logs.length > 0) {
        parts.push(`\nConsole:\n${logs.join('\n')}`);
      }

      if (parts.length === 0) {
        parts.push('(код выполнен, вывод отсутствует)');
      }

      const output = parts.join('\n');
      return output.length > MAX_OUTPUT
        ? output.substring(0, MAX_OUTPUT) + '\n... (вывод обрезан)'
        : output;
    } finally {
      vm.dispose();
      runtime.dispose();
    }
  }
}
