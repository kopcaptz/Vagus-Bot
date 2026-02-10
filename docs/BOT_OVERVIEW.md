# BOT OVERVIEW (быстрый разбор Vagus Bot)

## Что это за бот

Vagus Bot — мультиканальный AI-бот на Node.js/TypeScript с:
- каналами общения (Web + Telegram),
- единым маршрутизатором сообщений,
- AI через OpenRouter/OpenAI-совместимый API,
- системой Skills (инструменты для модели),
- контекстной и долговременной памятью,
- веб-панелью управления (модели, персоны, история, контекст).

## Основной runtime-поток

1. **`src/index.ts`** поднимает БД, cleanup памяти, модель по умолчанию.
2. Регистрируются skills (memory всегда, остальные — по флагам и env).
3. Регистрируются каналы (`web`, `telegram`) и стартует web-сервер.
4. Любое входящее сообщение идёт через `channelRegistry.handleMessage()`.
5. Дальше `routeMessage()`:
   - пишет user/session/message в SQLite,
   - обрабатывает slash-команды,
   - проверяет rate-limit,
   - собирает контекст и вызывает AI,
   - сохраняет ответ бота в БД.

## Каналы

- **Web канал**: используется API `/api/ai/test` и `/api/ai/upload`.
- **Telegram канал**:
  - поддерживает текст и фото,
  - есть owner/guest режим,
  - есть allowlist режим,
  - статусные апдейты во время tool-вызовов/итераций.

## AI и модели

- Текущая модель хранится в `.model-config.json`.
- Тиры моделей: `FREE`, `BUDGET`, `PRO_CODE`, `FRONTIER`, `FREE_TOP`, `none`.
- Провайдер в текущей сборке — OpenAI-compatible endpoint (обычно OpenRouter).
- Есть fallback: при ошибке выбранного тира переключение на `BUDGET`.
- Поддержаны изображения (vision) для OpenAI/Anthropic форматов.

## Skills (инструменты модели)

Через `skillRegistry` модель получает function/tools API.

Возможные skills:
- `memory` (всегда),
- `core`,
- `sandbox`,
- `browser`,
- `cli-gateway`,
- `web-search` (если есть `TAVILY_API_KEY`),
- `drive` (если валиден `DRIVE_ROOT`).

## Память

### 1) Краткосрочная (контекст чата)

- Хранится в SQLite `messages`.
- Настраивается через API (`enabled`, `maxMessages`, `maxTokens`, `includeSystemPrompt`).
- В контекст добавляется: system prompt + memory block + история + текущий запрос.

### 2) Долговременная Memory v2

- Markdown хранилище на пользователя:
  - `profile.md`,
  - `working.md` (с TTL),
  - `archive.md`,
  - `meta.json`.
- SQLite для семантического поиска и fact/chunk-индекса.
- Инструменты: `memory_save/read/search/get/forget/update`.
- Есть pre-retrieval блок в system prompt:
  - `[PROFILE MEMORY]`,
  - `[WORKING MEMORY]`,
  - `[RELEVANT MEMORY FOR THIS TURN]`.

## API (основное)

- `/api/stats` — состояние бота.
- `/api/models`, `/api/models/select`.
- `/api/personas/*` — CRUD и выбор персоны.
- `/api/ai/test`, `/api/ai/upload`.
- `/api/history/*`.
- `/api/context/config`, `/api/context/:chatId`.
- `/api/users`, `/api/sessions`, `/api/database/stats`.

## Что важно по эксплуатации

- Без `ADMIN_TOKEN` web API открыт.
- Без `TELEGRAM_BOT_TOKEN` Telegram просто не стартует (web работает).
- Инструменты (`TOOLS_ENABLED=true`) сильно расширяют возможности и риски — это управляется через env и соответствующие skill guardrails.

## Короткий вывод

Архитектура аккуратно разделена: **каналы → роутер → AI/skills → БД/память**.
Это позволяет добавлять новые каналы и инструменты без ломки основной логики обработки сообщений.
