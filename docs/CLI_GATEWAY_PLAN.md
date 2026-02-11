# План реализации `system.cli_gateway`

## Контекст

Оркестратор Vagus должен иметь возможность взаимодействовать с ОС, но мы не доверяем ему прямой доступ к shell.
Строим "шлюз безопасности" — инструмент `system.cli_gateway` для Windows-среды.

## Scope: MVP-1 и MVP-2

**MVP-1 (в этом документе):**
- режимы безопасности читаются из ENV только при старте;
- kill-switch через `STOP.flag` и `CLI_GATEWAY_KILL=1`;
- confirm token хранится в памяти процесса (TTL 2-5 минут);
- управление только через файл/ENV, без HTTP-управления.

**MVP-2 (отложено):**
- Admin API для runtime-переключения режимов и внешнего подтверждения операций;
- расширенные policy-правила и внешнее хранилище подтверждений.

Важно: Admin API не входит в MVP-1.

---

## Этап 0: Конфигурация (`src/config/cli-gateway.config.ts`)

Создаём **отдельный конфиг-файл**, описывающий:

| Параметр | Тип | Пример |
|---|---|---|
| `cliGateway.mode` | `OFF \| SAFE \| LIMITED \| CONFIRM` | `OFF` (по умолчанию) |
| `cliGateway.projectRoot` | `string` | `C:\Users\me\project` |
| `cliGateway.stopFlag` | `string` | `STOP.flag` |
| `cliGateway.lockEnvVar` | `string` | `CLI_GATEWAY_KILL` |
| `cliGateway.allowlist` | `Record<string, BinaryDef>` | см. ниже |
| `cliGateway.trustedDirs` | `string[]` | доверенные директории для бинарников |
| `cliGateway.confirmTokenTTL` | `number` | `180000` (ms, 3 мин; допустимо 2-5 мин) |
| `cliGateway.secretPatterns` | `RegExp[]` | паттерны API-ключей |
| `cliGateway.timeoutMs` | `number` | `15000` |

**Allowlist-формат** (каждый бинарник описан по имени; путь разрешается автоматически через Trusted Resolver):

```typescript
interface BinaryDef {
  /** Имя бинарника (e.g. "git"). Путь определяется через where/which + Trusted Resolver. */
  name: string;
  /**
   * (Опционально) Явный путь-override из .env, если бинарник установлен нестандартно.
   * Если задан — Trusted Resolver пропускает where/which, но всё равно проверяет
   * что путь в доверенной директории.
   */
  pathOverride?: string;
  /** В каких режимах доступен */
  modes: ('SAFE' | 'LIMITED' | 'CONFIRM')[];
  /** Подкоманды/аргументы по режимам */
  commands: {
    SAFE?: string[][];      // e.g. [["status"], ["log", "--oneline"]]
    LIMITED?: string[][];   // e.g. [["add", "."], ["commit"]]
    CONFIRM?: string[][];   // e.g. [["push"], ["pull"]]
  };
}
```

Пример для git:

```typescript
{
  git: {
    name: 'git',
    // pathOverride не задан — Trusted Resolver сам найдёт через `where git`
    modes: ['SAFE', 'LIMITED', 'CONFIRM'],
    commands: {
      SAFE: [['status'], ['log'], ['diff'], ['branch']],
      LIMITED: [['add'], ['commit'], ['checkout'], ['stash']],
      CONFIRM: [['push'], ['pull'], ['clone'], ['reset']],
    },
  },
  npm: {
    name: 'npm',
    modes: ['SAFE', 'CONFIRM'],
    commands: {
      SAFE: [['list'], ['outdated'], ['run', '--list']],
      CONFIRM: [['install'], ['update'], ['uninstall']],
    },
  },
}
```

**Доверенные директории** (по умолчанию, расширяемые через env):

```typescript
// Windows
const TRUSTED_DIRS_WIN = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\Windows\\System32',
];
// Linux / macOS
const TRUSTED_DIRS_NIX = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
];
```

Env-переменные для `.env`:

```
# Режим безопасности (задаётся ТОЛЬКО при старте, runtime-переключение отсутствует)
CLI_GATEWAY_MODE=OFF

# Корневая директория проекта (sandbox для cwd)
CLI_GATEWAY_PROJECT_ROOT=./

# Env kill-switch: если = "1" — gateway превращается в кирпич (режим OFF)
CLI_GATEWAY_KILL=

# (Опционально) Дополнительные доверенные директории для Trusted Resolver
# CLI_GATEWAY_TRUSTED_DIRS=D:\tools,E:\portable

# (Опционально) Override пути для бинарников, если установлены нестандартно
# CLI_GATEWAY_GIT_PATH=D:\PortableGit\bin\git.exe
# CLI_GATEWAY_NPM_PATH=D:\nodejs\npm.cmd
```

---

## Этап 1: State Machine — режимы безопасности (`src/skills/cli-gateway/security.ts`)

Режим задаётся **только через ENV при старте приложения**. Никакого runtime-переключения, никаких HTTP-эндпоинтов.

Конечный автомат с 4 состояниями:

```
         ┌──────────────────────────────────────────────────────┐
         │          Задаётся через ENV при старте                │
         ▼                                                      │
OFF ◄── SAFE ◄── LIMITED ◄── CONFIRM                            │
 ▲                                                              │
 │   kill-switch (файл STOP.flag или ENV CLI_GATEWAY_KILL=1)    │
 └──────────────── мгновенно из ЛЮБОГО состояния ◄──────────────┘
```

**Логика:**

1. **При старте** — читаем `CLI_GATEWAY_MODE` из env. Если не задан или невалиден — `OFF`.
2. **Режим фиксирован на весь lifecycle процесса.** Чтобы сменить — перезапуск с новым env.
3. **Kill-Switch проверка** (вызывается синхронно ПЕРЕД каждой операцией):
   - `fs.existsSync(path.join(projectRoot, 'STOP.flag'))` — наличие файла-флага.
   - `process.env.CLI_GATEWAY_KILL === '1'` — env-переменная.
   - Если **любое** из условий истинно — принудительно `OFF`, операция отклонена.
   - **Важно:** проверка файла — синхронная и выполняется на каждый вызов. Создание файла `STOP.flag` оператором мгновенно блокирует все последующие операции.
4. **Режим CONFIRM** — при попытке опасной операции:
   - Gateway генерирует одноразовый UUID-токен.
   - Токен выводится в **stdout** (для человека-оператора, видящего логи).
   - Человек передаёт токен обратно в повторный вызов `system_cli_gateway` через поле `confirm_token`.
   - `system_cli_gateway_confirm` (если оставляем) используется только как вспомогательная проверка токена, но не как обязательный путь выполнения.
   - Токен хранится в **in-memory Map** с TTL (2–5 минут, настраивается). Никакой базы данных.
   - После использования или истечения TTL — токен удаляется.

---

## Этап 2: Ядро — безопасный запуск процессов (`src/skills/cli-gateway/executor.ts`)

Центральный модуль. **Никогда не использовать shell.**

### Trusted Path Resolver (`src/skills/cli-gateway/path-resolver.ts`)

Vagus **никогда** не передаёт путь к бинарнику. Vagus шлёт только **имя** (например, `"git"`).
Gateway сам определяет реальный путь — и проверяет его безопасность.

```typescript
import { execFileSync } from 'child_process';
import path from 'path';

/** Доверенные системные директории */
const TRUSTED_DIRS = process.platform === 'win32'
  ? ['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Windows\\System32']
  : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];

/**
 * Ищет бинарник по имени через системный where/which без shell.
 * На Windows — where.exe напрямую (не через cmd /c).
 * Затем проверяет, что найденный путь лежит в доверенной директории.
 * 
 * @returns Абсолютный путь к доверенному бинарнику
 * @throws  Если бинарник не найден или найден в недоверенной директории
 */
function resolveTrustedBinary(name: string, binaryDef: BinaryDef): string {
  // 1. Если есть pathOverride в конфиге (из .env) — используем его
  // 2. Иначе — ищем через where/which (shell: false, execFileSync)
  const locatorCmd = process.platform === 'win32' ? 'where' : 'which';
  const foundPath = execFileSync(locatorCmd, [name], { encoding: 'utf-8' })
    .trim().split('\n')[0].trim();

  // 3. Нормализуем и проверяем реальный путь (symlink resolution)
  const realPath = fs.realpathSync(path.resolve(foundPath));

  // 4. Security check: путь должен начинаться с одной из TRUSTED_DIRS
  //    или быть явно разрешён через CLI_GATEWAY_TRUSTED_DIRS env,
  //    или лежать в projectRoot/tools (локальные инструменты проекта)
  const projectTools = path.join(projectRoot, 'tools');
  const allTrusted = [...TRUSTED_DIRS, ...getExtraTrustedDirs(), projectTools];
  const isTrusted = allTrusted.some(dir =>
    realPath.toLowerCase().startsWith(dir.toLowerCase())
  );
  if (!isTrusted) {
    throw new Error(`UNTRUSTED_BINARY_PATH: ${name} resolved to ${realPath}`);
  }

  return realPath;
}
```

**Ключевой принцип:** путь к `executable` НИКОГДА не приходит от Vagus. Vagus знает только имена из allowlist.

### Процесс запуска

```typescript
import { spawn } from 'child_process';

function executeProcess(request: CliRequest): Promise<CliResult> {
  // 1. Валидация (см. этап 3)
  // 2. Trusted Path Resolver → получаем абсолютный проверенный путь
  const trustedPath = resolveTrustedBinary(request.executable, binaryDef);
  // 3. Запуск
  const child = spawn(trustedPath, request.args, {
    cwd: resolvedCwd,
    shell: false,          // ← КЛЮЧЕВОЙ МОМЕНТ
    windowsHide: true,
    timeout: config.timeoutMs,
    env: sanitizedEnv,     // копия process.env БЕЗ секретов
  });
  // 4. Capture: Сбор stdout/stderr с лимитом буфера (raw, не логируем!)
  // 5. *** SANITIZE ***: фильтр секретов (этап 4) — ОБЯЗАТЕЛЬНО ДО логирования
  // 6. Logging: логируем только ПОСЛЕ санитизации
  // 7. Response: возвращаем санитизированный результат
}
```

> **СТРОГИЙ ПОРЯДОК:** `Execution → Capture → SANITIZE → Logging → Response`
>
> Ни байта сырого вывода не попадает в лог или ответ до прохождения через sanitizer.

### Env процесса — строгий запрет на утечку

```typescript
// Формируем env для дочернего процесса:
// - Берём МИНИМАЛЬНЫЙ набор переменных (PATH, LANG, HOME)
// - НЕ копируем process.env целиком
// - ЗАПРЕЩЕНО логировать env процесса, даже в DEBUG-режиме
const sanitizedEnv: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
  LANG: process.env.LANG ?? 'en_US.UTF-8',
  // Ничего лишнего. Никаких API_KEY, TOKEN, SECRET.
};
```

**Почему `spawn` без `shell`:**
- Node.js `spawn` с `shell: false` вызывает `CreateProcessW` напрямую (Windows) или `execvp` (Linux).
- Аргументы передаются как **массив строк**, а не как одна строка.
- Операторы `&&`, `|`, `>`, `>>`, `;` — это синтаксис **оболочки**. Без оболочки они просто литеральные символы в аргументах.

---

## Этап 3: Валидация запроса (`src/skills/cli-gateway/validator.ts`)

Цепочка проверок **до** запуска процесса:

```
Запрос ──▶ [Kill-Switch?] ──▶ [Mode != OFF?] ──▶ [Имя в allowlist?]
       ──▶ [Trusted Path Resolver] ──▶ [Подкоманда разрешена в mode?]
       ──▶ [cwd внутри projectRoot?] ──▶ [Нет shell-символов в args?]
       ──▶ [CONFIRM → токен валиден?] ──▶ EXECUTE
```

Подробно:

1. **Kill-Switch** — файл `STOP.flag` в корне проекта или env `CLI_GATEWAY_KILL=1`. Если сработал → reject.
2. **Mode check** — `OFF` → reject всё.
3. **Allowlist lookup** — `request.executable` (только **имя**, например `"git"`) ищется в allowlist конфига. Не найден → reject.
4. **Trusted Path Resolver** — по имени из allowlist находим реальный путь через `where`/`which`, проверяем что он в доверенной директории (см. Этап 2). Путь НИКОГДА не принимается от Vagus.
5. **Command matching** — `request.args[0]` (подкоманда) проверяется по спискам текущего режима.
6. **cwd sandbox** — `path.resolve(projectRoot, request.cwd)` должен начинаться с `path.resolve(projectRoot)`. Также `fs.realpathSync` для symlink'ов.
7. **Shell-injection guard** — каждый элемент `args[]` проверяется regex'ом на `&&`, `||`, `|`, `;`, `` ` ``, `$(`, `>`, `>>`, `\n`, `\r`. Defense in depth.
8. **Confirmation** — если mode требует `CONFIRM` → проверяем `request.confirmToken` через in-memory cache с TTL.

---

## Этап 4: Санитизация вывода (`src/skills/cli-gateway/sanitizer.ts`)

### Строгий порядок пайплайна (Sanitization First)

```
  Execution ──▶ Capture raw output ──▶ *** SANITIZE *** ──▶ Logging ──▶ Response
                    │                       │
                    │                       ▼
                    │               Ни байта сырого
                    │               вывода не прошло
                    ▼               дальше этой точки
               Буфер в памяти
               (никуда не пишем!)
```

**Железные правила:**
1. `stdout`/`stderr` процесса собираются в буфер **в памяти**. До санитизации — **никакого** логирования, записи в файл или отправки.
2. Только **после** прохождения `sanitize()` данные могут быть залогированы и/или возвращены Vagus'у.
3. **Строгий запрет:** содержимое `env` дочернего процесса ЗАПРЕЩЕНО логировать, даже в режиме `DEBUG`. Это предотвращает утечку секретов через логи.
4. Любые секреты, попавшие в stdout/stderr через `echo` или вывод утилит, редактируются sanitizer-ом до логирования и до ответа.

### Фильтр секретов

```typescript
const SECRET_PATTERNS: RegExp[] = [
  // Key-value pairs (API_KEY=..., secret: "...", password=...)
  /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)\s*[=:]\s*['"]?[\w\-\.]{8,}['"]?/gi,
  // Bearer tokens
  /Bearer\s+[\w\-\.]+/gi,
  // AWS Access Key
  /AKIA[0-9A-Z]{16}/g,
  // GitHub PAT (classic & fine-grained)
  /ghp_[A-Za-z0-9_]{36}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  // OpenAI / OpenRouter keys
  /sk-[A-Za-z0-9\-]{20,}/g,
  // Hex secrets (key=abc123def...)
  /(?:secret|key|token)[=:]\s*[0-9a-f]{32,}/gi,
  // ENV-style secrets (ANY_KEY=value, ANY_TOKEN=value, etc.)
  /[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/g,
  // Private keys (-----BEGIN ... KEY-----)
  /-----BEGIN\s[\w\s]+KEY-----[\s\S]*?-----END\s[\w\s]+KEY-----/g,
  // Connection strings
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
];

function sanitize(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
```

Ограничение размера вывода: 64 KB, обрезка при превышении.

---

## Этап 5: Skill-класс (`src/skills/cli-gateway/index.ts`)

Реализуем интерфейс `Skill` из `src/skills/types.ts`:

```typescript
export class CliGatewaySkill implements Skill {
  readonly id = 'cli-gateway';
  readonly name = 'CLI Gateway';
  readonly description = 'Безопасный шлюз для выполнения CLI-команд';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'system.cli_gateway',
        description: '...',
        parameters: { /* JSON Schema */ },
      },
      {
        name: 'system.cli_gateway_confirm',
        description: 'Подтвердить опасную операцию токеном',
        parameters: { ... },
      },
      {
        name: 'system.cli_gateway_status',
        description: 'Получить текущий режим и список доступных команд',
        parameters: { type: 'object', properties: {} },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    // Делегирует в executor через validator
  }
}
```

---

## Этап 6: Регистрация и интеграция

1. В `src/index.ts` — регистрируем:
   ```typescript
   import { CliGatewaySkill } from './skills/cli-gateway/index.js';
   skillRegistry.register(new CliGatewaySkill());
   ```
2. В `.env.example` — документируем новые переменные.
3. В `config.ts` — добавляем секцию `cliGateway`.

---

## Этап 7: Управление (File/Env Control — без Admin API)

> **Admin API удалён по решению Архитектора.** Управление — только через файлы и env.

### Переключение режима

Режим (`OFF`/`SAFE`/`LIMITED`/`CONFIRM`) задаётся **исключительно** через env-переменную `CLI_GATEWAY_MODE` при старте приложения. Чтобы сменить режим — перезапуск с новым значением.

### Kill-Switch

Мгновенная блокировка через **любой** из двух механизмов:
- **Файл-флаг:** создание файла `STOP.flag` в корне `projectRoot`. Проверяется синхронно (`fs.existsSync`) на каждый вызов — мгновенная реакция.
- **ENV-переменная:** `CLI_GATEWAY_KILL=1`. Проверяется на каждый вызов.

```bash
# Мгновенная блокировка — оператор создаёт файл:
echo "" > STOP.flag

# Разблокировка — перезапуск без файла:
del STOP.flag   # Windows
rm STOP.flag    # Linux
```

### Confirmation tokens

- Генерируются в **stdout** (UUID v4) — видны оператору в логах/консоли.
- Хранятся в **in-memory `Map<string, { command, expires }>`** с TTL 2–5 минут.
- Одноразовые: удаляются после использования.
- Периодическая очистка: `setInterval` раз в 60 сек удаляет expired записи.
- **Никакой базы данных.** При перезапуске все pending-токены теряются (by design — безопасно).

---

## Этап 8: Тесты

- Unit-тесты валидатора: инъекции, выход за sandbox, некорректные бинарники.
- Unit-тесты санитайзера: все паттерны секретов.
- Unit-тесты state machine: переходы, kill-switch.
- Integration-тест: полный цикл `git status` через gateway.

---

## JSON-контракт

### Запрос от Vagus:

```json
{
  "executable": "git",
  "args": ["status", "--short"],
  "cwd": ".",
  "confirm_token": null
}
```

### Ответ (успех):

```json
{
  "ok": true,
  "exit_code": 0,
  "stdout": " M src/index.ts\n?? new-file.txt",
  "stderr": "",
  "duration_ms": 142
}
```

### Ответ (бинарник не в allowlist):

```json
{
  "ok": false,
  "error": "EXECUTABLE_NOT_ALLOWED",
  "message": "Executable 'curl' is not in the allowlist",
  "allowed": ["git", "npm", "node"]
}
```

### Ответ (требуется подтверждение):

```json
{
  "ok": false,
  "error": "CONFIRMATION_REQUIRED",
  "message": "Command 'git push' requires human confirmation",
  "confirm_token": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "expires_in_ms": 180000
}
```

Повторный вызов с токеном:

```json
{
  "executable": "git",
  "args": ["push", "origin", "main"],
  "cwd": ".",
  "confirm_token": "a1b2c3d4-5678-90ab-cdef-1234567890ab"
}
```

### Ответ (kill-switch):

```json
{
  "ok": false,
  "error": "KILL_SWITCH_ACTIVE",
  "message": "CLI Gateway is disabled (STOP.flag detected or CLI_GATEWAY_KILL=1)"
}
```

---

## Защита от инъекций: `git status && format c:`

### 5 уровней защиты:

**Уровень 1: Структурный (JSON-контракт)**

Vagus не передаёт строку команды. Он передаёт структурированный JSON:
```json
{ "executable": "git", "args": ["status", "&&", "format", "c:"] }
```
`&&` — просто строка-аргумент для git. Git выдаст ошибку.

**Уровень 2: `shell: false` в Node.js `spawn`**

`CreateProcessW` (Windows API) не интерпретирует `&&`. Без оболочки весь массив передаётся одному процессу.

**Уровень 3: Валидация аргументов (defense in depth)**

```typescript
const FORBIDDEN_IN_ARGS = /[&|;`$><\n\r]/;
for (const arg of args) {
  if (FORBIDDEN_IN_ARGS.test(arg)) {
    throw new ValidationError('SHELL_INJECTION_DETECTED', ...);
  }
}
```

**Уровень 4: Allowlist бинарников**

`format` нет в allowlist → запрос отклонён.

**Уровень 5: Trusted Path Resolver**

Vagus шлёт только имя `"git"`. Gateway сам определяет путь через системный `where`/`which` и проверяет, что найденный бинарник лежит в доверенной директории (`Program Files`, `/usr/bin` и т.д.). Путь к executable **никогда** не принимается от Vagus — предотвращает подмену бинарника.

---

## Структура файлов

```
src/skills/cli-gateway/
├── index.ts           # CliGatewaySkill (Skill interface)
├── executor.ts        # spawn-обёртка (shell: false) + пайплайн sanitize-first
├── path-resolver.ts   # Trusted Path Resolver (where/which + trusted dirs check)
├── validator.ts       # цепочка валидации (8 шагов)
├── sanitizer.ts       # удаление секретов из вывода (ПЕРЕД логированием!)
├── security.ts        # state machine (OFF/SAFE/LIMITED/CONFIRM) + kill-switch (File/Env)
├── confirm-store.ts   # in-memory Map токенов подтверждения (TTL 2-5 мин, без БД)
└── types.ts           # CliRequest, CliResult, BinaryDef и т.д.
```

## Порядок реализации

1. `types.ts` — контракты и типы
2. `security.ts` — state machine + kill-switch (File/Env)
3. `path-resolver.ts` — Trusted Path Resolver (where/which + trusted dirs)
4. `validator.ts` — валидация (8 шагов)
5. `sanitizer.ts` — фильтр секретов
6. `executor.ts` — spawn-обёртка + пайплайн sanitize→log→response
7. `confirm-store.ts` — in-memory хранилище токенов (Map + TTL)
8. `index.ts` — сборка в Skill
9. Конфиг + регистрация
10. Тесты

Каждый этап — отдельный коммит, каждый модуль тестируется изолированно.

---

## Пошаговый план внедрения (A-J)

Ниже прикладной roadmap, привязанный к текущей структуре репозитория.

### Этап A: kill-switch и проверка статуса

**Файлы:** `src/skills/cli-gateway/config.ts`

- Добавить `isKillSwitchActive(): boolean`.
- Проверять оба источника: `STOP.flag` и `CLI_GATEWAY_KILL=1`.

**Стоп-пойнт:** при наличии `STOP.flag` функция возвращает `true`.

**Smoke-test:** создать `STOP.flag`, вызвать gateway, получить `KILL_SWITCH_ACTIVE`.

### Этап B: kill-switch в execute path

**Файлы:** `src/skills/cli-gateway/index.ts`

- В `system_cli_gateway` проверять `isKillSwitchActive()` перед любой валидацией команды.
- Возвращать типизированную ошибку `KILL_SWITCH_ACTIVE`.

**Стоп-пойнт:** ни одна команда не запускается при активном kill-switch.

### Этап C: минимальный env для spawn

**Файлы:** `src/skills/cli-gateway/index.ts`

- Передавать в `spawn` только `PATH`, `HOME`/`USERPROFILE`, `LANG`.
- Не передавать `process.env` целиком.

**Стоп-пойнт:** команды запускаются, но env не содержит API ключей приложения.

### Этап D: trusted resolver без cmd-shell

**Файлы:** `src/skills/cli-gateway/path-resolver.ts`

- На Windows использовать `where.exe` напрямую, без `cmd /c`.
- Для `pathOverride` делать `realpath` перед проверкой trusted dirs.
- Явно учитывать `projectRoot/tools` как trusted-path.

**Стоп-пойнт:** путь из недоверенной директории отклоняется.

### Этап E: защита от shell-инъекций в args

**Файлы:** `src/skills/cli-gateway/index.ts` (или выделить `validator.ts`)

- Добавить проверку каждого аргумента на `&&`, `||`, `|`, `;`, `` ` ``, `$(`, `>`, `>>`, `\n`, `\r`.
- При срабатывании возвращать `SHELL_INJECTION_DETECTED`.

**Стоп-пойнт:** payload с `&& format c:` блокируется до запуска процесса.

### Этап F: порядок sanitize -> log -> response

**Файлы:** `src/skills/cli-gateway/index.ts`, `src/skills/cli-gateway/sanitizer.ts`

- Гарантировать, что логируется только scrubbed output.
- Никогда не логировать env дочернего процесса.

**Стоп-пойнт:** в логах отсутствуют сырые токены.

### Этап G: confirm-flow без заглушек

**Файлы:** `src/skills/cli-gateway/index.ts`, `src/skills/cli-gateway/confirmation.ts`

- Убрать недоопределённые заглушки (`makeBlockedResponse`).
- Согласовать поток: `CONFIRMATION_REQUIRED` -> повторный `system_cli_gateway` с `confirm_token`.
- `system_cli_gateway_confirm` оставить только как опциональный helper или убрать из MVP-1.

**Стоп-пойнт:** опасная команда выполняется только с валидным токеном.

### Этап H: усиление sanitizer и лимит вывода

**Файлы:** `src/skills/cli-gateway/sanitizer.ts`

- Расширить regex-паттерны (API keys, bearer, private keys, connection strings).
- Ограничить итоговый stdout/stderr (например, 64 KB, с явной пометкой обрезки).

**Стоп-пойнт:** секреты редактируются, oversized output обрезается контролируемо.

### Этап I: unit-тесты

**Файлы:** `src/skills/cli-gateway/*` + тестовый каталог/скрипты

- Тесты для kill-switch, validator, resolver, sanitizer, confirm store.

**Стоп-пойнт:** тесты проходят локально и в CI.

### Этап J: smoke-тесты end-to-end

**Сценарии:**
1. SAFE: `git status` проходит.
2. Инъекция: `["status","&&","format","c:"]` блокируется.
3. Kill-switch: `STOP.flag` блокирует все команды.
4. CONFIRM: `git push`/`npm install` требует токен и выполняется только после подтверждения.

**Финальный стоп-пойнт:** все smoke-тесты зелёные, MVP-1 закрыт.
