# Google: Gemini, Antigravity, Jules

**Поверхность:** чат (веб-приложение) и агент редактора (CLI, Antigravity, Jules) ·
**Ссылка на файл:** `@src/App.tsx` (в CLI, Antigravity, Jules); в веб-чате — приложенный файл ·
**Файл правил:** `GEMINI.md` (у Gemini CLI и Antigravity), `AGENTS.md` (Antigravity, Jules)
**В списке приложения:** пока **нет** — ни одной строки Google в списке агентов не заведено

## Главное

У Google четыре разные поверхности, и путать их — основная ошибка:

| Поверхность | Видит проект? | Что делать |
| --- | --- | --- |
| **Gemini Apps** (браузер, Canvas, Notebooks) | только то, что загружено или импортировано | приложить код; импорт репозитория с GitHub — **снимок**: история коммитов недоступна, записи обратно нет |
| **Gemini CLI** | да, через `GEMINI.md` | задача + пути + критерии приёмки; потребительский доступ прекращён 18.06.2026, преемник — Antigravity CLI |
| **Antigravity** | да: правила `.agents/rules/`, `AGENTS.md` или `GEMINI.md` | задача, объём, релевантные пути, критерии приёмки, команда проверки |
| **Jules** | да: клонирует репозиторий в VM, ищет корневой `AGENTS.md` | конкретный промпт, затем ревью плана |

## Что говорит документация (октябрь 2026)

- **Gemini Apps.** Файлы загружаются; веб-приложение умеет импортировать папку кода или репозиторий
  GitHub, но это **снимок** — без синхронизации, истории коммитов и записи обратно
  ([Upload & analyze files](https://support.google.com/gemini/answer/14903178), [Import a GitHub repository](https://support.google.com/gemini/answer/16176929)).
  Canvas умеет создавать и править код, но репозиторием не является
  ([Canvas](https://support.google.com/gemini/answer/16047321)).
- **Постоянный контекст.** Notebooks (источники + инструкции ноутбука) и Gems; Gems переходят в
  **Skills** с ноября 2026 для личных аккаунтов, Skills пока не работают с Canvas
  ([Notebooks](https://support.google.com/gemini/answer/16972047), [Gems](https://support.google.com/gemini/answer/15236321),
  [Gems → Skills](https://support.google.com/gemini/answer/18560919), [Skills](https://support.google.com/gemini/answer/17094296)).
- **Формат промпта.** Google для Gemini 3 советует: одинаково оформленные разделы, явные разделители —
  **XML-теги или markdown-заголовки**, последовательно по всему промпту; явно задавать ограничения и
  объём; при длинном контексте давать контекст **до** вопроса
  ([Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)).
- **Gemini CLI.** Файл контекста по умолчанию — `GEMINI.md`; чтение `AGENTS.md` включается настройкой
  `context.fileName` ([Provide context with GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)).
- **Antigravity.** Правила принимаются из `AGENTS.md`, `GEMINI.md` и `.agents/rules/`; найденные
  правила накапливаются, при конфликте приоритет у более конкретного каталога
  ([Rules](https://antigravity.google/docs/rules/)). В best practices — цикл с проверкой результата
  ([CLI best practices](https://antigravity.google/docs/cli/best-practices/)).
- **Jules.** Ищет корневой `AGENTS.md`, рекомендует конкретный промпт и ревью плана
  ([Getting started](https://jules.google/docs/)).
- **Переход.** Потребительский доступ к Gemini CLI прекращён 18 июня 2026, преемник — Antigravity CLI
  ([Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)).

## Промпт — веб-приложение Gemini (чат)

````markdown
## Задача
Исправить выход из системы по истечении сессии: страница остаётся открытой до перезагрузки.

## Контекст
- TypeScript, React, Vite; состояние сессии — в сторе, запросы — через общую обёртку.

## Исходный код
Ниже — актуальное содержимое файлов. Считать его полным.

Target File: src/auth/session.ts
```ts
// полное содержимое файла
```

## Требования
- Вернуть полный код файла целиком, без сокращений.
- Не выдумывать содержимое файлов, которых нет в промпте: если чего-то не хватает — сказать об этом.

## Приёмка
- После истечения токена любой запрос уводит на вход без перезагрузки.
````

## Промпт — Antigravity, Gemini CLI или Jules (агент редактора)

````markdown
## Задача
Исправить выход из системы по истечении сессии.

## Файлы
@src/auth/session.ts — проверка срока; @src/auth/refresh.ts — образец обновления токена.

## Что не меняется
Роутинг и форма входа. Соседние модули аутентификации оставить как есть.

## Приёмка
- После истечения токена любой запрос уводит на вход без перезагрузки.

## Проверка
Запусти `npm test` и `npm run typecheck`, покажи команду и результат; невыполненное назови
невыполненным.
````

## Чего не делать

- не полагаться на импорт репозитория в веб-приложении как на доступ к проекту: это снимок без записи
  и без истории;
- не рассчитывать, что обычный чат Gemini подхватит `AGENTS.md` — это механизм CLI, Antigravity и Jules;
- не дублировать `GEMINI.md` и `AGENTS.md` разными правилами: Antigravity читает оба, конфликт решается
  конкретностью каталога, а не порядком;
- не запускать потребительский Gemini CLI как основной путь — он прекращён 18.06.2026, используйте
  Antigravity CLI;
- не смешивать XML-теги и markdown-разделители наполовину: Google просит выбрать одно и держаться его.

## Источники

[ai.google.dev/gemini-api/docs/prompting-strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) ·
[support.google.com — Upload & analyze files](https://support.google.com/gemini/answer/14903178) ·
[support.google.com — Import a GitHub repository](https://support.google.com/gemini/answer/16176929) ·
[support.google.com — Gems → Skills](https://support.google.com/gemini/answer/18560919) ·
[geminicli.com/docs/cli/gemini-md](https://geminicli.com/docs/cli/gemini-md/) ·
[antigravity.google/docs/rules](https://antigravity.google/docs/rules/) ·
[antigravity.google/docs/cli/best-practices](https://antigravity.google/docs/cli/best-practices/) ·
[jules.google/docs](https://jules.google/docs/) ·
[developers.googleblog.com — Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
