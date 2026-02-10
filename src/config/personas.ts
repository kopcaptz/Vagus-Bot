import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { skillRegistry } from '../skills/registry.js';

export type PersonaId = string;

export interface Persona {
  id: PersonaId;
  name: string;
  prompt: string;
}

const PERSONA_CONFIG_PATH = join(process.cwd(), '.persona-config.json');
const PERSONAS_STORE_PATH = join(process.cwd(), '.personas.json');

const DEFAULT_PERSONAS: Record<string, Persona> = {
  default: {
    id: 'default',
    name: 'По умолчанию',
    prompt: 'Ты полезный AI ассистент. Отвечай кратко и по делу.',
  },
  coder: {
    id: 'coder',
    name: 'Кодер',
    prompt: 'Ты опытный Senior Developer. Пиши только код и краткие объяснения, без лишней воды.',
  },
  magic: {
    id: 'magic',
    name: 'Гримуар',
    prompt: 'Ты хранитель Кибер-Гримуара. Твой тон загадочный и собранный. Дай ясный ответ и веди заметки в стиле лора.',
  },
  engineer: {
    id: 'engineer',
    name: 'Инженер',
    prompt: 'Ты практичный инженер. Отвечай четко, с формулами и расчетами, если это уместно.',
  },
};

interface PersonasStore {
  personas: Record<string, Persona>;
}

function loadPersonasStore(): PersonasStore {
  if (!existsSync(PERSONAS_STORE_PATH)) {
    return { personas: {} };
  }
  try {
    const raw = readFileSync(PERSONAS_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.personas && typeof parsed.personas === 'object') {
      return parsed as PersonasStore;
    }
  } catch {
    // ignore corrupted file, fallback to defaults
  }
  return { personas: {} };
}

function savePersonasStore(store: PersonasStore) {
  writeFileSync(PERSONAS_STORE_PATH, JSON.stringify(store, null, 2));
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0400-\u04ff\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40) || 'persona';
}

function getMergedPersonas(): Record<string, Persona> {
  const store = loadPersonasStore();
  return {
    ...DEFAULT_PERSONAS,
    ...store.personas,
  };
}

export function getPersonas(): Persona[] {
  const personas = getMergedPersonas();
  const list = Object.values(personas);
  list.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.name.localeCompare(b.name)));
  return list;
}

export function getSelectedPersona(): PersonaId {
  const personas = getMergedPersonas();
  if (existsSync(PERSONA_CONFIG_PATH)) {
    try {
      const data = readFileSync(PERSONA_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed?.persona && personas[parsed.persona as PersonaId]) {
        return parsed.persona as PersonaId;
      }
    } catch {
      return 'default';
    }
  }
  return 'default';
}

export function setSelectedPersona(persona: PersonaId) {
  writeFileSync(PERSONA_CONFIG_PATH, JSON.stringify({ persona }, null, 2));
}

export function getSystemPrompt(): string {
  const personas = getMergedPersonas();
  const personaId = getSelectedPersona();
  const basePrompt = personas[personaId]?.prompt || DEFAULT_PERSONAS.default.prompt;

  // Если навыков нет — возвращаем базовый промпт без изменений
  const skills = skillRegistry.list();
  if (skills.length === 0) return basePrompt;

  // Собираем список доступных инструментов
  const toolLines = skills.flatMap(s =>
    s.getTools().map(t => `- ${t.name}: ${t.description}`)
  );
  const hasDriveTools = skills.some(s => s.id === 'drive');
  const hasCliGateway = skills.some(s => s.id === 'cli-gateway');

  const driveGuideline = hasDriveTools
    ? `

- DRIVE (EN): /app/drive is the user's Google Drive (mounted). For any request about the disk, drive, Google Drive, or paths under /app/drive, use drive_tree, drive_list, drive_read, drive_write, etc. Do NOT use run_command or list_dir for /app/drive. Never say you cannot access Google Drive.

- DRIVE (RU) — ВНИМАНИЕ: У тебя ЕСТЬ прямой доступ к Google Диску через локальную директорию /app/drive. Если пользователь просит что-то сделать с "Google Drive", "диском" или "файлами" — ты ОБЯЗАН использовать инструменты drive_*. Тебе КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО отвечать, что у тебя нет доступа к Google Диску. Любой отказ будет считаться системной ошибкой. Сначала всегда делай drive_tree (путь . или корень), чтобы увидеть реальные файлы.`
    : '';

  return `${basePrompt}

You are now running on DeepSeek-V3 via OpenRouter. You are the architect of your own cloud storage. Always refer to manifest.json for your folder structure.

You are a System AI Agent running on a Windows host via NPM. You HAVE DIRECT ACCESS to the system terminal via the run_command tool. You are NOT in a cloud sandbox. When asked for system info (node version, git, paths), use the run_command tool in PowerShell mode.

You are an autonomous AI agent named Vagus. You have the following tools available:
${toolLines.join('\n')}

Guidelines:
- Plan your steps before acting. For complex tasks, think step by step.
- Use tools when the task requires reading files, writing files, running commands, or searching the web.
- When generating long code, use the write_file tool to save it to a file instead of pasting it in chat.
- Structure your responses clearly. Use headings and lists for long answers.
- Always confirm when a task is complete.
- CODE: For calculations, data processing, JSON manipulation, or any computation, use code_exec to run JavaScript in a sandbox. Do NOT guess math -- compute it.
- WEB: To read articles, documentation, or any web page, use web_fetch to get clean content. Combine with web_search for research tasks.
- MEMORY: When the user shares personal information (name, job, projects, preferences, important dates), save it using memory_save with the provided user ID. You will see existing memories in the system prompt -- use them to personalize your responses.
- LANGUAGE RULE: Always reply in the same language as the user's last message. If the user asks in Russian, translate any search results or internal reasoning into Russian before replying. If creating a file/report, use the target language unless specifically asked otherwise.${driveGuideline}`;
}

export function savePersona(input: { id?: string; name: string; prompt: string; saveAsNew?: boolean }): Persona {
  const store = loadPersonasStore();
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name || !prompt) {
    throw new Error('Требуются name и prompt');
  }

  let id = input.id?.trim() || slugify(name);
  if (input.saveAsNew || !store.personas[id]) {
    // Avoid overwriting defaults unless explicitly updating
    if (DEFAULT_PERSONAS[id] && input.saveAsNew) {
      id = `${id}-${Date.now().toString(36)}`;
    }
  }

  const persona: Persona = { id, name, prompt };
  store.personas[id] = persona;
  savePersonasStore(store);
  return persona;
}

export function deletePersona(id: string) {
  if (id === 'default') {
    throw new Error('Нельзя удалить default');
  }
  const store = loadPersonasStore();
  if (store.personas[id]) {
    delete store.personas[id];
    savePersonasStore(store);
  } else if (DEFAULT_PERSONAS[id]) {
    // Do not delete built-in personas
    throw new Error('Нельзя удалить встроенную персону');
  }
}

