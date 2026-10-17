# Roo Code

**Поверхность:** агент редактора · **Ссылка на файл:** `@/src/App.tsx` · **Файл правил:** `AGENTS.md`
**В списке приложения:** «Roo Code»

## Главное

Ссылки — от корня рабочей папки (`@/path/to/file.ts`, папка — с косой чертой на конце). Правки
предлагаются диффом и ждут подтверждения. Документация по большим проектам просит конкретные пути и
имена функций, малые инкрементальные изменения и схему **analyze → plan → execute → review**.

## Что говорит документация (октябрь 2026)

- **Ссылки.** `@/path/to/file.ts` от корня воркспейса; папка — `@/path/to/folder/`. Кроме файлов
  есть `@problems`, `@terminal`, `@git-changes` и `@<хеш-коммита>`. Упоминание папки подтягивает
  файлы **непосредственно** в ней, без рекурсии, и при большом объёме контекст обрезается
  ([Context Mentions](https://docs.roocode.com/basic-usage/context-mentions)).
- **Правила.** Предпочтительно `.roo/rules/` (рекурсивно читается), фолбэк — `.roorules` в корне;
  правила режима — `.roo/rules-{modeSlug}/`. Читается и корневой `AGENTS.md` (`AGENT.md` как фолбэк)
  ([Custom Instructions](https://docs.roocode.com/features/custom-instructions), [Customizing Modes](https://docs.roocode.com/features/custom-modes)).
- **Инструменты.** `apply_diff` для точечных правок (изменение показывается диффом и ждёт
  подтверждения), `write_to_file` для новых файлов — тоже с подтверждением
  ([Tool use overview](https://docs.roocode.com/advanced-usage/available-tools/tool-use-overview)).
- **Что писать в задаче.** Конкретное изменение и конкретные пути/функции; релевантный контекст,
  примеры или формат вывода; разбиение сложной работы на шаги; итерации
  ([Prompt Engineering Tips](https://docs.roocode.com/advanced-usage/prompt-engineering)).
- **Большие проекты.** Контекст = системный промпт + история + упомянутые файлы + вывод команд.
  Совет: быть конкретным, разбивать задачи, **суммировать** большой код вместо вставки, менять
  понемногу ([Working with Large Projects](https://docs.roocode.com/advanced-usage/large-projects)).
- **Режимы.** Встроенный Architect для планирования (чтение + правки только markdown), Code для
  работы, Orchestrator для делегирования подзадач в изолированных контекстах. Режима «Review» среди
  встроенных нет — его создают отдельно
  ([Using Modes](https://docs.roocode.com/basic-usage/using-modes), [Boomerang Tasks](https://docs.roocode.com/features/boomerang-tasks)).
- **Строка о правилах в готовом промпте.**
  `- Договорённости проекта лежат в AGENTS.md — прочитай их (@/AGENTS.md) и не противоречь им.`

## Промпт

````markdown
## Задача
Исправить двойной запрос при первом открытии страницы отчёта.

## Файлы
- @/src/pages/Report.tsx — эффект, который запрашивает данные
- @/src/hooks/useReport.ts — место, где запрос выполняется

## Что не меняется
Разметка, стили и схема данных. Другие страницы не трогать.

## Формат ответа
Диффом, без переписывания файлов целиком.

## Приёмка
- При открытии страницы выполняется один запрос.
- Повторное открытие не выполняет запрос, если данные не устарели.

## Проверка
Запусти тесты проекта, покажи команду и результат; невыполненное назови невыполненным.
````

Для многофайловой работы сначала Architect (план), затем переключение в Code по одному шагу из плана.
Делегирование подзадач в Orchestrator полезно, когда разведка «съедает» контекст основной задачи.

## Чего не делать

- не упоминать папку целиком ради «общего понимания»: рекурсии нет, но даже один уровень может
  вытеснить полезный контекст;
- не требовать перезаписи всего файла там, где достаточно `apply_diff`;
- не ждать автоматического ревью: режим проверки надо создать самому;
- не рассчитывать на автоматическую подгрузку правил из чужих форматов: предпочтительны
  `.roo/rules/` и `AGENTS.md`.

## Источники

[docs.roocode.com/basic-usage/context-mentions](https://docs.roocode.com/basic-usage/context-mentions) ·
[docs.roocode.com/features/custom-instructions](https://docs.roocode.com/features/custom-instructions) ·
[docs.roocode.com/features/custom-modes](https://docs.roocode.com/features/custom-modes) ·
[docs.roocode.com/advanced-usage/prompt-engineering](https://docs.roocode.com/advanced-usage/prompt-engineering) ·
[docs.roocode.com/advanced-usage/large-projects](https://docs.roocode.com/advanced-usage/large-projects)
