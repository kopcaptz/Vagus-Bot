# Memory v2 — долговременная память бота

## Расположение данных

- **Файлы:** `data/memory/users/{userId}/`
  - `profile.md` — устойчивые факты о пользователе (имя, язык, предпочтения)
  - `working.md` — временные (текущие задачи, планы) с датой истечения `[exp:YYYY-MM-DD]`
  - `archive.md` — остальное
  - `meta.json` — счётчики (profileCount, workingCount, archiveCount) и версия
- **SQLite:** `data/sqlite/memory.sqlite` — чанки с эмбеддингами и `fact_id` для семантического поиска и операций forget/update.

Старый формат `data/memory/{userId}.md` при первом обращении к пользователю мигрируется в новую структуру (бэкап в `.bak`).

## Формат строки факта в .md

```
- [id:pf_001] [t:profile] [imp:high] Пользователь предпочитает русский.
- [id:wk_014] [t:working] [imp:normal] [exp:2026-03-01] Сейчас ставим simple-bot...
- [id:ar_120] [t:archive] [imp:low] Обсуждали структуру памяти.
```

Парсинг и запись: `src/memory/storage/md/format.ts`, `read.ts`, `write.ts`.

## Политика сохранения (policy)

- **Валидация:** длина 12–240 символов, не вопрос (?, вопросительные начала), не команда (npm install, cd, «сделай промпт» и т.д.), без подозрительных секретов (sk-, Bearer, длинные hex).
- **Классификация:** по ключевым словам и опциональному meta от модели — type (profile/working/archive), importance (high/normal/low), для working — expiresAt.
- **Дедуп:** подстрочный (подстрока в обе стороны) и опционально семантический (поиск по эмбеддингу, порог 0.9).
- **Лимиты:** maxFactsPerUser=500, maxProfileFacts=50, maxWorkingFacts=50; при превышении вытесняются старые факты из archive (сначала low, затем normal).

## Pre-retrieval (контекст для ответа)

В `getContextForAI` перед формированием системного промпта вызывается `buildMemoryBlocksForPrompt(userId, currentMessage)`:

- **[PROFILE MEMORY]** — факты из profile (high), лимит ~800 символов
- **[WORKING MEMORY]** — не истёкшие working, лимит
- **[RELEVANT MEMORY FOR THIS TURN]** — семантический поиск по текущему сообщению (topK=5), с decay по возрасту для archive/normal, лимит ~2000 символов

Так модель получает релевантную память без явного вызова memory_search.

## Инструменты (MemorySkill)

- **memory_save** — сохранить факт (валидация, классификация, запись в нужный .md, ingest с fact_id)
- **memory_read** — прочитать все факты (profile + working + archive)
- **memory_search** — семантический поиск с decay по возрасту; возвращает chunk id и fact_id
- **memory_get** — полный текст чанков по id из memory_search
- **memory_forget** — удалить факт по id (pf_xxx, wk_xxx, ar_xxx) или по запросу (поиск → удаление первого)
- **memory_update** — обновить текст факта по id или запросу (замена в .md, переинжест чанков)

## TTL и очистка

- В working фактах поле `[exp:YYYY-MM-DD]`. При чтении working и при сборке блоков факты с истёкшей датой не показываются.
- Job `src/memory/jobs/cleanup.ts`: при старте бота (`runCleanup()`) удаляются истёкшие строки из working.md и соответствующие чанки в SQLite по fact_id.

## Decay при поиске

В семантическом поиске (`memorySearchWithFactId`) для записей archive/normal к score применяется множитель `exp(-ageDays/halfLifeDays)` (halfLifeDays=60). Profile и high не затухают.

## Ручная проверка

Скрипт для миграции одного пользователя, сохранения факта, чтения и забывания:

```bash
cd simple-bot
npx tsx scripts/manual_check_memory.ts [userId]
```

По умолчанию userId = `test-user`. Требуется настроенный .env (при необходимости — ключ для эмбеддингов).
