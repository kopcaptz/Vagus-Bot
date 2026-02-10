# План реализации `system.cli_gateway`

## Контекст

Оркестратор Vagus должен иметь возможность взаимодействовать с ОС, но мы не доверяем ему прямой доступ к shell.
Строим "шлюз безопасности" — инструмент `system.cli_gateway` для Windows-среды.

---

## Этап 0: Конфигурация (`src/config/cli-gateway.config.ts`)

Создаём **отдельный конфиг-файл**, описывающий:

| Параметр | Тип | Пример |
|---|---|---|
| `cliGateway.mode` | `OFF \| SAFE \| LIMITED \| CONFIRM` | `OFF` (по умолчанию) |
| `cliGateway.projectRoot` | `string` | `C:\Users\me\project` |
| `cliGateway.lockFile` | `string` | `.cli-gateway.lock` |
| `cliGateway.lockEnvVar` | `string` | `CLI_GATEWAY_KILL` |
| `cliGateway.allowlist` | `Record<string, BinaryDef>` | см. ниже |
| `cliGateway.confirmTokenTTL` | `number` | `60000` (ms) |
| `cliGateway.secretPatterns` | `RegExp[]` | паттерны API-ключей |
| `cliGateway.timeoutMs` | `number` | `15000` |

**Allowlist-формат** (каждый бинарник описан явно):

```typescript
interface BinaryDef {
  /** Абсолютный путь к бинарнику, или имя в PATH */
  path: string;
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
    path: 'C:\\Program Files\\Git\\cmd\\git.exe',
    modes: ['SAFE', 'LIMITED', 'CONFIRM'],
    commands: {
      SAFE: [['status'], ['log'], ['diff'], ['branch']],
      LIMITED: [['add'], ['commit'], ['checkout'], ['stash']],
      CONFIRM: [['push'], ['pull'], ['clone'], ['reset']],
    },
  },
  npm: {
    path: 'C:\\Program Files\\nodejs\\npm.cmd',
    modes: ['SAFE', 'CONFIRM'],
    commands: {
      SAFE: [['list'], ['outdated'], ['run', '--list']],
      CONFIRM: [['install'], ['update'], ['uninstall']],
    },
  },
}
```

Env-переменные для `.env`:

```
CLI_GATEWAY_MODE=OFF
CLI_GATEWAY_PROJECT_ROOT=./
CLI_GATEWAY_KILL=
```

---

## Этап 1: State Machine — режимы безопасности (`src/skills/cli-gateway/security.ts`)

Конечный автомат с 4 состояниями:

```
OFF ──(admin API)──▶ SAFE ──(admin API)──▶ LIMITED ──(admin API)──▶ CONFIRM
 ▲                                                                      │
 └──────────────── kill-switch (мгновенный переход) ◀───────────────────┘
```

**Логика:**

1. При старте — читаем `CLI_GATEWAY_MODE` из env. Если не задан — `OFF`.
2. **Kill-Switch проверка** (вызывается ПЕРЕД каждой операцией):
   - Существует ли файл `{projectRoot}/.cli-gateway.lock`?
   - Задана ли env `CLI_GATEWAY_KILL=1`?
   - Если да — принудительно `OFF`, игнорируем всё остальное.
3. Переключение режима — только через защищённый admin-endpoint (`POST /api/cli-gateway/mode`) с `ADMIN_TOKEN`.
4. В режиме `CONFIRM` — генерируем одноразовый UUID-токен, отправляем человеку (через web/telegram), ожидаем его обратно. Токен имеет TTL (по умолчанию 60 секунд).

---

## Этап 2: Ядро — безопасный запуск процессов (`src/skills/cli-gateway/executor.ts`)

Центральный модуль. **Никогда не использовать shell.**

```typescript
import { spawn } from 'child_process';

function executeProcess(request: CliRequest): Promise<CliResult> {
  // 1. Валидация (см. этап 3)
  // 2. Запуск
  const child = spawn(resolvedBinaryPath, request.args, {
    cwd: resolvedCwd,
    shell: false,          // ← КЛЮЧЕВОЙ МОМЕНТ
    windowsHide: true,
    timeout: config.timeoutMs,
    env: sanitizedEnv,     // копия process.env без секретов
  });
  // 3. Сбор stdout/stderr с лимитом буфера
  // 4. Санитизация вывода (этап 4)
  // 5. Возврат результата
}
```

**Почему `spawn` без `shell`:**
- Node.js `spawn` с `shell: false` вызывает `CreateProcessW` напрямую (Windows) или `execvp` (Linux).
- Аргументы передаются как **массив строк**, а не как одна строка.
- Операторы `&&`, `|`, `>`, `>>`, `;` — это синтаксис **оболочки**. Без оболочки они просто литеральные символы в аргументах.

---

## Этап 3: Валидация запроса (`src/skills/cli-gateway/validator.ts`)

Цепочка проверок **до** запуска процесса:

```
Запрос ──▶ [Kill-Switch?] ──▶ [Mode != OFF?] ──▶ [Executable в allowlist?]
       ──▶ [Подкоманда разрешена в текущем mode?] ──▶ [cwd внутри projectRoot?]
       ──▶ [Нет shell-символов в args?] ──▶ [CONFIRM → токен валиден?]
       ──▶ EXECUTE
```

Подробно:

1. **Kill-Switch** — файл `.cli-gateway.lock` или env. Если сработал → reject.
2. **Mode check** — `OFF` → reject всё.
3. **Allowlist lookup** — `request.executable` ищется в конфиге. Не найден → reject. Резолвим в абсолютный путь из конфига (не доверяем PATH).
4. **Command matching** — `request.args[0]` (подкоманда) проверяется по спискам текущего режима.
5. **cwd sandbox** — `path.resolve(projectRoot, request.cwd)` должен начинаться с `path.resolve(projectRoot)`. Также `fs.realpathSync` для symlink'ов.
6. **Shell-injection guard** — каждый элемент `args[]` проверяется regex'ом на `&&`, `||`, `|`, `;`, `` ` ``, `$(`, `>`, `>>`, `\n`, `\r`. Defense in depth.
7. **Confirmation** — если mode требует `CONFIRM` → проверяем `request.confirmToken`.

---

## Этап 4: Санитизация вывода (`src/skills/cli-gateway/sanitizer.ts`)

Перед возвратом stdout/stderr Вагусу — фильтр секретов:

```typescript
const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth)\s*[=:]\s*['"]?[\w\-\.]{8,}['"]?/gi,
  /Bearer\s+[\w\-\.]+/gi,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9_]{36}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /sk-[A-Za-z0-9\-]{20,}/g,
  /(?:secret|key|token)[=:]\s*[0-9a-f]{32,}/gi,
  /[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+/g,
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

## Этап 7: Admin API

Эндпоинты в `src/server/api.ts`:

- `GET /api/cli-gateway/status` — текущий режим, список бинарников.
- `POST /api/cli-gateway/mode` — переключить режим (требует `ADMIN_TOKEN`).
- `POST /api/cli-gateway/confirm` — сгенерировать confirmation token.
- `POST /api/cli-gateway/kill` — активировать kill-switch (создать lock-файл).

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
  "expires_in_ms": 60000
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
  "message": "CLI Gateway is disabled (lock file detected)"
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

**Уровень 5: Абсолютные пути**

`"git"` → `"C:\\Program Files\\Git\\cmd\\git.exe"` из конфига. Предотвращает подмену бинарника.

---

## Структура файлов

```
src/skills/cli-gateway/
├── index.ts           # CliGatewaySkill (Skill interface)
├── executor.ts        # spawn-обёртка (shell: false)
├── validator.ts       # цепочка валидации
├── sanitizer.ts       # удаление секретов из вывода
├── security.ts        # state machine (OFF/SAFE/LIMITED/CONFIRM)
├── confirm-store.ts   # хранилище одноразовых токенов подтверждения
└── types.ts           # CliRequest, CliResult, BinaryDef и т.д.
```

## Порядок реализации

1. `types.ts` — контракты и типы
2. `security.ts` — state machine + kill-switch
3. `validator.ts` — валидация
4. `sanitizer.ts` — фильтр секретов
5. `executor.ts` — spawn-обёртка
6. `confirm-store.ts` — хранилище токенов
7. `index.ts` — сборка в Skill
8. Конфиг + регистрация
9. Admin API endpoints
10. Тесты

Каждый этап — отдельный коммит, каждый модуль тестируется изолированно.
