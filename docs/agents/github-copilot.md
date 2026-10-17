# GitHub Copilot

**Поверхность:** агент редактора · **Ссылка на файл:** `#file:src/App.tsx` · **Файл правил:** `AGENTS.md`
**В списке приложения:** «GitHub Copilot» (VS Code Chat в режиме Agent, Copilot cloud agent на
GitHub, Copilot CLI)

## Главное

Это три разных поверхности под одним именем, и различаются они прежде всего тем, **где** выполняются:

| Поверхность | Ссылка на файл | Правит локальные файлы? |
| --- | --- | --- |
| VS Code Chat, режим Agent | `#` + выбор из списка (`#codebase`, `#fetch`); `#file:<путь>` — в теле кастомного агента | да, в рабочей папке или worktree сессии |
| Copilot CLI | `@src/app.js` | да, в текущем каталоге, с подтверждениями |
| Copilot cloud agent на GitHub | путь в тексте задачи | нет: правит в облачном окружении и обновляет ветку/PR |

## Что говорит документация (октябрь 2026)

- **Синтаксис.** В чате VS Code контекст добавляют, набрав `#` и выбрав файл, папку, символ или
  инструмент; `#codebase` берёт всю кодовую базу; `#fetch` ходит в сеть
  ([Add context to chat](https://code.visualstudio.com/docs/chat/copilot-chat-context)). Формы
  `#file:<путь>` и `#tool:<имя>` документированы **для тела кастомного агента**
  ([Custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)), а в CLI
  файл подключается как `@относительный/путь`
  ([Using GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)).
  `@`-упоминания вида `@terminal` в чате VS Code — это участники чата, не файлы.
- **Инструкции.** Проектный файл — `.github/copilot-instructions.md` или `AGENTS.md` в корне;
  точечные правила — `.github/instructions/**/*.instructions.md` с frontmatter `applyTo: "**/*.ts"`
  ([Use custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions)).
  GitHub добавляет: `AGENTS.md` может лежать в любом месте репозитория, и **ближайший** к файлу
  побеждает ([Adding repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)).
- **Переименования 2026.** «Custom chat modes» стали **custom agents**: файлы `.chatmode.md`
  переименовываются в `.agent.md`. Настройки-инструкции для генерации кода и тестов отменены с
  VS Code 1.102 в пользу файловых инструкций.
- **Что писать в задаче.** GitHub для cloud-агента перечисляет три вещи: описание задачи,
  **полные критерии приёмки** (включая, нужны ли юнит-тесты) и указание, какие файлы менять
  ([Get the best results](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)).
  VS Code для агента в IDE: одна ограниченная задача с наблюдаемым результатом, релевантные файлы,
  ошибки, ограничения и существующие команды тестов
  ([Best practices](https://code.visualstudio.com/docs/agents/best-practices)).
- **Строка о правилах в готовом промпте.** Синтаксис этого инструмента — единственный не `@`:
  `- Договорённости проекта лежат в AGENTS.md — прочитай их (#file:AGENTS.md) и не противоречь им.`
- **Планирование.** У CLI есть Plan mode: анализ запроса и репозитория, уточняющие вопросы и
  структурированный план до написания кода. Документация советует его для сложных многофайловых
  изменений и не советует для мелких багфиксов.

## Промпт

````markdown
## Задача
Кнопка «Экспорт» в шапке отчёта скачивает CSV со всеми отфильтрованными строками.

## Файлы
- #file:src/components/ExportButton.tsx — новый компонент
- #file:src/pages/Report.tsx — подключить кнопку в шапке

## Что не меняется
Фильтры, пагинация, стили таблицы, роутинг.

## Приёмка
- Нажатие скачивает report.csv с заголовком и строками текущего фильтра.
- Пустой результат — файл из одного заголовка, без ошибки в консоли.
- Проходят объявленные в проекте `npm run typecheck` и `npm test`.

## Проверка
Запусти их и покажи команду с результатом; невыполненное назови невыполненным.
````

Для **CLI** те же строки ссылок записываются как `@src/components/ExportButton.tsx`. Для
**cloud-агента** ссылки не нужны: он ищет по репозиторию сам — важнее критерии приёмки и список
файлов обычным текстом.

## Чего не делать

- не писать `#file:` в чате VS Code как единственный способ — надёжнее набрать `#` и выбрать файл из
  списка (форма `#file:` — для тела кастомного агента);
- не ждать, что cloud-агент изменит вашу локальную папку: он работает в облаке и открывает ветку/PR;
- не полагаться на старые `.chatmode.md` и настройки-инструкции — они переименованы и отменены;
- не рассчитывать на подтверждение каждой правки: в режиме Agent изменения сохраняются в рабочую
  папку или worktree, и их нужно смотреть диффом.

## Источники

[code.visualstudio.com/docs/agent-customization/custom-instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions) ·
[code.visualstudio.com/docs/agent-customization/custom-agents](https://code.visualstudio.com/docs/agent-customization/custom-agents) ·
[code.visualstudio.com/docs/chat/copilot-chat-context](https://code.visualstudio.com/docs/chat/copilot-chat-context) ·
[code.visualstudio.com/docs/agents/best-practices](https://code.visualstudio.com/docs/agents/best-practices) ·
[docs.github.com — Prompt engineering](https://docs.github.com/en/copilot/concepts/prompting/prompt-engineering) ·
[docs.github.com — Repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) ·
[docs.github.com — Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)
