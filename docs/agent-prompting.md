# Как правильно промптить ИИ-агентов — исследование, октябрь 2026

Этот документ — выжимка из официальной документации одиннадцати инструментов и нескольких
исследований 2026 года. Он отвечает на три вопроса: **что вообще нужно писать в задаче**, **что
действительно различается между сервисами**, и **чего делать нельзя**. Документы по каждому
конкретному агенту — в [docs/agents/](agents/README.md).

---

## 1. Короткий ответ

**Особый «фирменный» промпт под каждый сервис не нужен.** Ни один вендор не документирует свой
стиль промпта, а эксперимент, который держит содержание промпта постоянным и меняет только
разметку (Markdown / YAML / JSON / plain, [arXiv 2411.10541](https://arxiv.org/html/2411.10541v1)),
не находит формата, который выигрывает у всех. Формат разметки — вопрос вкуса, а не совместимости.

Реально различаются **три вещи**, и только они:

| Различие | Почему это важно |
| --- | --- |
| **Видит ли инструмент проект** | Чат без доступа к файлам увидит только то, что принесёт сам промпт. Агент редактора, которому приложили весь код, тратит контекст впустую. |
| **Правит ли он файлы сам или отдаёт код** | Cursor, Claude Code, Copilot, Cline, Roo Code, Windsurf правят файлы в проекте: просить у них «полный файл целиком» — просить сделать работу дважды. Lovable, Bolt, Replit собирают проект сами: им нужны намерение, границы и одно изменение за раз. |
| **Как он хочет, чтобы файл назвали** | `@src/App.tsx` (Cursor, Claude Code), `@/src/App.tsx` от корня проекта (Cline, Roo Code), `#file:src/App.tsx` (Copilot в IDE), обычный путь (конструкторы), `Target File: src/App.tsx` (чат — синтаксиса `@` у него нет). Названный не тем синтаксисом файл не подключается, а текст при этом выглядит так, будто подключился. |

Всё остальное — общее для всех, и оно одинаково у всех одиннадцати.

### Пятнадцать слов, которые решают почти всё

Задача = **что должно получиться → в каких файлах → что нельзя менять → как проверим → что вернуть**.

Это ровно то, что просят все вендоры, почти одними и теми же словами:

- GitHub: «Avoid ambiguity», «Complete acceptance criteria», «directions about which files need changing» ([Best practices for using GitHub Copilot to work on tasks](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results));
- VS Code: «one bounded task with an observable result» ([Best practices for using AI in VS Code](https://code.visualstudio.com/docs/agents/best-practices));
- Anthropic: «Describe the outcome, not the steps» ([Prompt library](https://code.claude.com/docs/en/prompt-library));
- Windsurf/Devin: цель → релевантный контекст (`@`-ссылки) → ограничения ([Prompt Engineering](https://docs.windsurf.com/best-practices/prompt-engineering));
- Cursor: «Provide concrete examples or referenced files» ([Rules](https://cursor.com/docs/rules));
- Roo Code: конкретные пути и функции, разбиение на шаги, указание формата вывода ([Prompt Engineering Tips](https://docs.roocode.com/advanced-usage/prompt-engineering)).

---

## 2. Каркас задачи, который работает везде

```markdown
## Задача
Одно наблюдаемое изменение. Не «улучши страницу», а «кнопка экспорта сохраняет CSV со всеми строками таблицы».

## Файлы
- src/components/ExportButton.tsx — новый компонент кнопки
- src/pages/Report.tsx — подключить кнопку в шапке

## Что не меняется
Стили таблицы, фильтры, роутинг. Соседние страницы не трогать.

## Приёмка
- Нажатие скачивает файл report.csv с заголовком и всеми отфильтрованными строками.
- Пустая таблица — файл с одним заголовком, без ошибки.
- tsc и npm test проходят.

## Проверка
Запусти `npm run typecheck` и `npm test`, покажи команду и результат. Что не запускал — назови невыполненным.

## Что вернуть
Списком: изменённые пути и что в каждом изменилось.
```

Английская версия того же — просто перевод заголовков; вендоры не различают языки промпта.

Три подстановки зависят от инструмента, и только они:

1. **Раздел «Файлы»**: для Cursor/Claude Code — `@src/pages/Report.tsx`; для Copilot — `#file:`; для
   Cline/Roo — `@/src/...`; для конструкторов — обычный путь без ссылки (они открывают проект сами);
   для чата — `Target File: <путь>` плюс сами файлы в промпте.
2. **«Что вернуть»**: агент редактора возвращает список изменённых файлов (правки уже в проекте);
   чат — полный код каждого файла (ему больше нечего показать).
3. **Ссылка на постоянные правила проекта**: `AGENTS.md` (у Claude Code — `CLAUDE.md`).

---

## 3. Контекст: сколько и чего прикладывать

Единогласно: **релевантное, а не всё**.

- Anthropic: «Bloated CLAUDE.md files cause Claude to ignore your actual instructions!»; ориентир —
  **меньше 200 строк на файл памяти**, длинные файлы «consume more context and reduce adherence»
  ([How Claude remembers your project](https://code.claude.com/docs/en/memory));
- Cursor: «Keep rules under 500 lines»; не копировать целиком style guides и не документировать
  каждую возможную команду ([Rules](https://cursor.com/docs/rules));
- VS Code: «Avoid adding unrelated or large sources because they also consume context window tokens»
  ([Understand context in AI agents](https://code.visualstudio.com/docs/agents/concepts/context));
- Cursor: «Including irrelevant files can confuse the agent about what's important»
  ([Best practices for coding with agents](https://cursor.com/blog/agent-best-practices));
- Roo Code: называть конкретные пути и функции, а не «разберись сам»
  ([Working with Large Projects](https://docs.roocode.com/advanced-usage/large-projects)).

**Что говорит исследование.** «Evaluating AGENTS.md» (2026, [arXiv 2602.11988](https://arxiv.org/html/2602.11988v2))
измеряет задачи с файлами контекста и без: файлы **не улучшили успешность в среднем**, но увеличили
стоимость вывода **больше чем на 20%**. Файлы, написанные разработчиками, работали лучше
сгенерированных моделью. Отдельно важно: длина файла контекста в этом исследовании **не давала
значимого эффекта** — то есть дело не в длине как таковой, а в отсутствии пользы от написанного.
Вывод — не «пишите короче», а «не пишите того, что агент может узнать сам».

---

## 4. Планировать или делать сразу

Документация не говорит «всегда планируй». Она говорит: планируй, когда непонятен объём, подход
или код; делай сразу, когда дифф описывается одним предложением.

- Anthropic: если можно описать правку одним предложением — иди прямо, без плана; Explore → Plan →
  Implement → Commit — для случаев, когда «решить не ту задачу» это реальный риск
  ([Best practices for Claude Code](https://code.claude.com/docs/en/best-practices));
- Cursor: Plan Mode — для сложных многофайловых задач и неясных требований; для знакомых мелких правок
  — прямой Agent ([Plan Mode](https://cursor.com/docs/agent/plan-mode));
- Cline: явно перечисляет, когда план **не** нужен — опечатка, импорт, конфиг, переименование
  ([Plan & Act Mode](https://docs.cline.bot/core-workflows/plan-and-act));
- GitHub Copilot CLI: «models achieve higher success rates with a concrete plan»; `/plan` для
  многофайловых изменений, не для быстрых багфиксов ([Best practices for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices));
- Bolt и Lovable: Plan Mode вместо немедленной сборки, но Chat — когда решения ещё нет
  ([Plan Mode](https://support.bolt.new/prompting/plan-mode), [Plan mode](https://docs.lovable.dev/features/plan-mode)).

**Что говорит исследование.**

- «From Plan to Action» (ASE '26, [arXiv 2604.12147](https://arxiv.org/html/2604.12147v3)): 21 120
  траекторий SWE-agent, четыре модели. Стандартный план повышает долю решённых задач, его удаление
  снижает успех, а напоминания о плане каждые пять шагов повышают и соблюдение плана, и успех.
  И там же важное предупреждение: **плохой или неподходящий план хуже отсутствия плана** — лишние
  «полезные» фазы отвлекают модель.
- «SWE-Review» (2026, [arXiv 2607.06065](https://arxiv.org/html/2607.06065v1)): цикл
  генерация → ревью → правка на SWE-bench Verified поднимает долю решённых задач у трёх генераторов:
  27,5 % → 56,9 %, 50,9 % → 68,8 %, 72,2 % → 75,4 %. Это доказательство пользы **отдельного
  ревьюера**, а не того, что агент, проверяющий сам себя, получит тот же выигрыш.
- «Instructions Are Evidence, Not Objectives» (октябрь 2026, [arXiv 2610.17757](https://arxiv.org/html/2610.17757v1)):
  в задачах, где требования выводятся из проекта, режим планирования **ни разу не повысил** Success@1
  у трёх протестированных моделей. План не заменяет исследование задачи: он фиксирует то, что уже
  понято.

Практический вывод: план — инструмент против неясности, а не ритуал.

---

## 5. Проверка: просить доказательство, а не заверение

Anthropic называет это **«trust-then-verify gap»**: «Claude produces a plausible-looking
implementation that doesn't handle edge cases». Их правило — «Always provide verification (tests,
scripts, screenshots). If you can't verify it, don't ship it» и «show evidence rather than asserting
success» ([Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)).

Поэтому в промпте должна быть строка, которую легко проверить на исполнение:

> Назови проверки, которые выполнил ты: команда и её результат. Проверку, которой не было, назови
> невыполненной.

Это не формальность. Все модели пишут уверенную строку «тесты проходят» без запуска тестов, поэтому
вопрос «какие проверки ты запускал» возвращает разговор к фактам. Дополнительно:

- указывайте **команды, которые проект реально объявляет** (из `package.json`), а не «запусти тесты»;
- неполный набор тестов — не доказательство: «tests pass» и «требования выполнены» — разные
  утверждения (см. arXiv 2610.17757 выше).

---

## 6. Антипаттерны

| Антипаттерн | Что происходит | Как правильно |
| --- | --- | --- |
| **Кухонная раковина**: один чат на всё, история на сотни сообщений | Anthropic называет это «The kitchen sink session» и «The infinite exploration»; агент путает старые решения с новыми | Отдельная сессия на несвязанную задачу; узкая область исследования; субагенты для шумной разведки |
| **Раздутый файл правил** | «Bloated CLAUDE.md files cause Claude to ignore your actual instructions!» | Только то, что агент не может узнать сам: команды сборки, где что лежит, неочевидные конвенции |
| **Противоречащие или дублирующие инструкции** | Claude может выбрать одно из двух произвольно; Copilot: «try to avoid providing conflicting sets of instructions» | Одно требование сказано один раз и в одном файле; спорные места разрешать явно |
| **Размытая задача** («сделай красиво», «улучши») | «Avoid vague prompts» (VS Code), «Avoid ambiguity» (GitHub) | Наблюдаемый результат + критерии приёмки |
| **Вера в слово «готово»** | «plausible-looking implementation that doesn't handle edge cases» | Требовать команду и её вывод; невыполненное помечать как невыполненное |
| **Просить полный файл у того, кто правит файлы сам** | Контекст уходит на пересказ кода, который уже лежит в проекте, а ревью становится тяжелее | Просить изменение и список затронутых путей |
| **Просить «измени» у чата без доступа к проекту** | Чат угадывает содержимое файла, которого не видел | Приложить полный релевантный файл или честный фрагмент с указанием границ |
| **Один гигантский промпт на всю фичу** | «Instead of asking for an entire feature at once, decompose it into smaller, well-scoped steps» (VS Code) | Одно ограниченное изменение за раз; для большой фичи — план, затем порции |
| **Указание ссылок несуществующим синтаксисом** | Агент не подключает файл, а текст выглядит так, будто подключил | Синтаксис из документации инструмента (см. таблицу в разделе 1) |
| **Расчёт на то, что промпт ограничит опасные действия** | Cline: «YOLO mode disables all safety checks», включая `rm -rf`; чекпойнты не отменяют выполненные команды | Ограничивать правами и подтверждениями, а не текстом промпта |

---

## 7. `AGENTS.md` и постоянные инструкции

**Конвенция.** [agents.md](https://agents.md/) — обычный Markdown без обязательных полей; ближайший
`AGENTS.md` к файлу важнее более далёкого. Официальный список совместимых инструментов на сайте:
Codex, Jules, Factory, Aider, goose, opencode, Zed, Warp, VS Code, Devin, Junie, Amp, Cursor,
Roo Code, Gemini CLI, Kilo Code, GitHub Copilot (cloud agent), Ona, Windsurf, Augment Code.

**Кто что читает из списка агентов этого приложения:**

| Инструмент | Свой файл | `AGENTS.md` |
| --- | --- | --- |
| Cursor | `.cursor/rules/*.mdc` (обычный `.md` в этой папке **игнорируется**) | да, корневой и вложенные |
| Claude Code | `CLAUDE.md` — читается **вместо** `AGENTS.md`, если есть оба | да, с v2.1.277; документированный фолбэк — `@AGENTS.md` внутри `CLAUDE.md` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**.instructions.md` | да, в любом месте репозитория, ближайший важнее |
| Cline | `.clinerules/`, `.cline/rules/` | да |
| Roo Code | `.roo/rules/` (рекурсивно), `.roorules` как фолбэк | да (и `AGENT.md` как фолбэк) |
| Windsurf / Devin | `.devin/rules/` (предпочтительно), `.windsurf/rules/` — legacy, `.devin/workflows/` | да, через тот же движок правил |
| Lovable | knowledge проекта | да, корневой `AGENTS.md` (и `CLAUDE.md`) |
| Bolt | `agents.md` (так в документации — строчными) | находит сам |
| Replit | `replit.md` | в документации поддержки нет |
| Gemini CLI / Antigravity / Jules | `GEMINI.md` / `GEMINI.md` и `.agents/rules/` | Antigravity и Jules — да, Gemini CLI — через настройку `context.fileName` |

**Единого правила приоритета между `AGENTS.md` и родными файлами инструментов не существует.**
VS Code прямо советует не полагаться на единый порядок: набор источников аддитивен. Практический
вывод: один `AGENTS.md` как источник правды + тонкие указатели там, где инструмент настаивает на
своём имени (`CLAUDE.md` — это `@AGENTS.md` и одна строка объяснения, а не копия).

**Что писать в файл правил:** назначение проекта одной фразой; проверенные команды установки, сборки,
тестов и линта; где что лежит и куда добавлять новый код; неочевидные конвенции; как проверять
изменение; чего делать нельзя.

**Что не писать:** общие советы («пиши хороший код»), целые стайлгайды, примеры, которые есть в коде,
списки всех возможных команд, редкие частные случаи, устаревшие команды, и — главное — одно и то же
правило в двух файлах.

---

## 8. Как это устроено в этом приложении

Различия из раздела 1 живут в одном месте — [src/utils/agentProfiles.ts](../src/utils/agentProfiles.ts):
три поверхности (`workspace`, `chat`, `builder`), синтаксис ссылки, файл правил. Из него строится
и брифинг модели ([server/utils/promptTexts.ts](../server/utils/promptTexts.ts)), и локальный движок
([server/controllers/prompt.controller.ts](../server/controllers/prompt.controller.ts)), поэтому оба
пути говорят пользователю одно и то же. Тест
[src/tests/agentProfiles.test.ts](../src/tests/agentProfiles.test.ts) держит таблицу сверенной с
документацией, а [src/tests/agentDocs.test.ts](../src/tests/agentDocs.test.ts) — эти документы
сверенными с таблицей.

---

## 9. Документы по агентам

| Инструмент | Поверхность | Ссылка на файл | Файл правил |
| --- | --- | --- | --- |
| [Cursor](agents/cursor.md) | агент редактора | `@src/App.tsx` | `AGENTS.md` |
| [Claude Code](agents/claude-code.md) | агент редактора | `@src/App.tsx` | `CLAUDE.md` |
| [Windsurf / Devin](agents/windsurf.md) | агент редактора | `@src/App.tsx` | `AGENTS.md` |
| [GitHub Copilot](agents/github-copilot.md) | агент редактора | `#file:src/App.tsx` | `AGENTS.md` |
| [Cline](agents/cline.md) | агент редактора | `@/src/App.tsx` | `AGENTS.md` |
| [Roo Code](agents/roo-code.md) | агент редактора | `@/src/App.tsx` | `AGENTS.md` |
| [Lovable](agents/lovable.md) | конструктор | обычный путь | `AGENTS.md` |
| [Bolt](agents/bolt.md) | конструктор | обычный путь | `agents.md` |
| [Replit](agents/replit.md) | конструктор | обычный путь | `replit.md` (пишет сам Replit) |
| [ChatGPT](agents/chatgpt.md) | чат (браузер) / агент (десктоп Work, Codex) | `Target File: <путь>` | — (Codex читает `AGENTS.md`) |
| [DeepSeek](agents/deepseek.md) | чат | `Target File: <путь>` | — |
| [Google: Gemini, Antigravity, Jules](agents/google.md) | чат и агент редактора | `@src/App.tsx` | `GEMINI.md` / `AGENTS.md` |

---

## 10. Источники

**Документация вендоров (октябрь 2026).** Cursor: [Rules](https://cursor.com/docs/rules),
[Prompting agents](https://cursor.com/docs/agent/prompting), [Plan Mode](https://cursor.com/docs/agent/plan-mode),
[Subagents](https://cursor.com/docs/subagents), [Best practices for coding with agents](https://cursor.com/blog/agent-best-practices).
Anthropic: [Memory / CLAUDE.md](https://code.claude.com/docs/en/memory),
[Best practices](https://code.claude.com/docs/en/best-practices), [Common workflows](https://code.claude.com/docs/en/common-workflows),
[Prompt library](https://code.claude.com/docs/en/prompt-library), [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices).
Windsurf/Devin: [Prompt Engineering](https://docs.windsurf.com/best-practices/prompt-engineering),
[Cascade modes](https://docs.windsurf.com/windsurf/cascade/modes), [AGENTS.md](https://docs.windsurf.com/windsurf/cascade/agents-md),
[Memories](https://docs.windsurf.com/windsurf/cascade/memories).
GitHub/VS Code: [Prompt engineering](https://docs.github.com/en/copilot/concepts/prompting/prompt-engineering),
[Task best practices](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results),
[Repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions),
[Copilot CLI best practices](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices),
[VS Code best practices](https://code.visualstudio.com/docs/agents/best-practices),
[Chat context](https://code.visualstudio.com/docs/chat/copilot-chat-context),
[Custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions).
Cline: [Adding context](https://docs.cline.bot/core-workflows/working-with-files),
[Plan & Act](https://docs.cline.bot/core-workflows/plan-and-act), [Rules](https://docs.cline.bot/customization/cline-rules),
[Tasks](https://docs.cline.bot/core-workflows/task-management), [Deprecations](https://docs.cline.bot/resources/deprecations).
Roo Code: [Context mentions](https://docs.roocode.com/basic-usage/context-mentions),
[Prompt engineering](https://docs.roocode.com/advanced-usage/prompt-engineering), [Large projects](https://docs.roocode.com/advanced-usage/large-projects),
[Custom instructions](https://docs.roocode.com/features/custom-instructions).
Lovable: [Prompting](https://docs.lovable.dev/prompting/prompting-one), [Chat mode](https://docs.lovable.dev/features/chat-mode),
[Plan mode](https://docs.lovable.dev/features/plan-mode), [Build mode](https://docs.lovable.dev/features/agent-mode),
[Knowledge](https://docs.lovable.dev/features/knowledge). Bolt: [Prompting](https://support.bolt.new/prompting/prompting-effectively),
[Plan Mode](https://support.bolt.new/prompting/plan-mode), [Manage context](https://support.bolt.new/prompting/manage-context),
[Release notes](https://support.bolt.new/release-notes). Replit: [Effective prompting](https://docs.replit.com/learn/effective-prompting),
[replit.md](https://docs.replit.com/features/project-setup/replit-dot-md), [Plan mode](https://docs.replit.com/features/agent/plan-mode).
OpenAI: [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering),
[AGENTS.md for Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt),
[ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex),
[Model pages](https://learn.chatgpt.com/docs/models). Google: [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies),
[GEMINI.md](https://geminicli.com/docs/cli/gemini-md/), [Antigravity rules](https://antigravity.google/docs/rules/),
[Jules getting started](https://jules.google/docs/), [Import a repo in Gemini Apps](https://support.google.com/gemini/answer/16176929).
DeepSeek: [V4 release notes](https://api-docs.deepseek.com/news/news260424/), [Change log](https://api-docs.deepseek.com/updates/).

**Исследования.** [Does Prompt Formatting Have Any Impact on LLM Performance?](https://arxiv.org/html/2411.10541v1) ·
[Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?](https://arxiv.org/html/2602.11988v2) ·
[Agent READMEs: An Empirical Study of Context Files for Agentic Coding](https://arxiv.org/html/2511.12884v2) ·
[From Plan to Action: How Well Do Agents Follow the Plan?](https://arxiv.org/html/2604.12147v3) ·
[SWE-Review: Closing the Loop on Issue Resolution with Agentic Code Review](https://arxiv.org/html/2607.06065v1) ·
[Instructions Are Evidence, Not Objectives](https://arxiv.org/html/2610.17757v1) ·
[Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy).
