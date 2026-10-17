# Windsurf (Cascade)

**Поверхность:** агент редактора · **Ссылка на файл:** `@src/App.tsx` · **Файл правил:** `AGENTS.md`
**В списке приложения:** «Windsurf»

> **Переименование.** Документация `docs.windsurf.com` теперь ведёт на `docs.devin.ai` и описывает
> **Devin Desktop**; Cascade — тот же агент внутри. Родные каталоги правил переехали: предпочтительно
> `.devin/rules/`, а `.windsurf/rules/` остаётся legacy-фолбэком. Workflows — `.devin/workflows/`
> против `/.windsurf/workflows/`.

## Главное

Cascade в режиме Code создаёт, правит и удаляет файлы проекта, поэтому задача описывается как
изменение, а не как набор файлов для вставки. Их собственный гайд по промптам просит ровно три части:
**цель → релевантный контекст (включая `@`-ссылки) → ограничения** (фреймворк, библиотеки, язык,
сложность, требования безопасности).

## Что говорит документация (октябрь 2026)

- **Режимы.** Cascade: **Ask** (только чтение), **Plan** (исследует проект и готовит план, ничего не
  меняя), **Code** (правит файлы) ([Cascade modes](https://docs.windsurf.com/windsurf/cascade/modes)).
- **Правила.** Workspace rules с режимами активации (всегда включено, по решению модели, по glob,
  вручную); «keep rules simple, concise, specific, and clearly formatted»
  ([Rules / Memories](https://docs.windsurf.com/windsurf/cascade/memories)).
- **`AGENTS.md`.** Читается тем же движком правил: корневой файл действует всегда, файл в подпапке —
  для файлов этой папки и ниже ([AGENTS.md](https://docs.windsurf.com/windsurf/cascade/agents-md)).
- **Memories ≠ правила.** Автоматические Memories хранятся локально и не коммитятся; для
  договорённостей, которые должны переживать клон репозитория, нужны Rules или `AGENTS.md`. Memories
  относятся к legacy-агенту Cascade, а не к Devin Local — агенту по умолчанию в новых вкладках.
- **Ссылки.** В гайде по промптам упоминаются `@`-ссылки, включая `@func:...` и `@class:...`; для
  внешней документации — `@docs`, `@web` или просто URL
  ([Prompt Engineering](https://docs.windsurf.com/best-practices/prompt-engineering), [Web and Docs Search](https://docs.windsurf.com/windsurf/cascade/web-search)).
  Точный синтаксис ссылки на файл в гайде явно не выписан — берите его из меню упоминаний редактора.
  В этом приложении для Windsurf используется `@путь`, как и у Cursor: если ваш интерфейс подставляет
  ссылку иначе, поправьте её в готовом промпте перед вставкой.
- **Контекст.** Пиньте только то, что нужно задаче
  ([Context Awareness](https://docs.windsurf.com/context-awareness/overview)).
- **Строка о правилах в готовом промпте.**
  `- Договорённости проекта лежат в AGENTS.md — прочитай их (@AGENTS.md) и не противоречь им.`

## Промпт

````markdown
## Задача
Сделать так, чтобы список задач сохранялся между перезагрузками страницы.

## Файлы
- @src/store/tasks.ts — здесь живёт состояние задач
- @src/hooks/useTasks.ts — точка, где задача читается компонентами

## Ограничения
- Только localStorage, без новых зависимостей.
- Ограничиться языком и стеком проекта: TypeScript, React.

## Что не меняется
Разметка списка, фильтры, существующие действия над задачей.

## Приёмка
- Перезагрузка страницы сохраняет список и его порядок.
- Пустое хранилище — пустой список без ошибок.

## Проверка
Запусти `npm test` и покажи команду с результатом; невыполненное назови невыполненным.
````

Если неизвестно, где живёт нужный код, начните с режима **Plan** (он исследует проект без правок) —
это дешевле, чем откатывать правки, сделанные по неверной гипотезе.

## Чего не делать

- не рассчитывать на Memories как на переносимые правила: они локальны и не коммитятся;
- не писать правило в `.windsurf/rules/`, если работаете в новом Devin Desktop — предпочтителен
  `.devin/rules/`;
- не просить у Cascade полные файлы: он правит проект сам;
- не смешивать `@func:`/`@class:` и пути в одном списке файлов: держите один стиль ссылок.

## Источники

[docs.windsurf.com/best-practices/prompt-engineering](https://docs.windsurf.com/best-practices/prompt-engineering) ·
[docs.windsurf.com/windsurf/cascade/modes](https://docs.windsurf.com/windsurf/cascade/modes) ·
[docs.windsurf.com/windsurf/cascade/agents-md](https://docs.windsurf.com/windsurf/cascade/agents-md) ·
[docs.windsurf.com/windsurf/cascade/memories](https://docs.windsurf.com/windsurf/cascade/memories) ·
[docs.windsurf.com/windsurf/cascade/workflows](https://docs.windsurf.com/windsurf/cascade/workflows) ·
[docs.windsurf.com/context-awareness/overview](https://docs.windsurf.com/context-awareness/overview)
