import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

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
  return personas[personaId]?.prompt || DEFAULT_PERSONAS.default.prompt;
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

