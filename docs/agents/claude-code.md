# Claude Code

**Поверхность:** агент редактора · **Ссылка на файл:** `@src/App.tsx` · **Файл правил:** `CLAUDE.md`
**В списке приложения:** «Claude Code» (терминал, расширения IDE, десктоп и веб-режим Code — один и
тот же движок, поэтому и промпт один)

## Главное

Anthropic формулирует задачу как «Describe the outcome, not the steps», а проверку — как обязанность:
«Always provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it».
Файлы не прикладывают к промпту: «For very large inputs such as entire files or long logs, write the
content to a file and ask Claude to read it instead of pasting» — Claude Code читает проект сам.

## Что говорит документация (октябрь 2026)

- **`CLAUDE.md` против `AGENTS.md`.** По умолчанию Claude Code читает `CLAUDE.md`
  (`.claude/CLAUDE.md`, `CLAUDE.local.md`) **вместо** `AGENTS.md`, если такие есть в рабочей папке
  или выше. Нативная поддержка `AGENTS.md` — с v2.1.277, а документированный фолбэк для более старых
  версий — строка `@AGENTS.md` внутри `CLAUDE.md`. Настройкой можно включить чтение обоих
  ([How Claude remembers your project](https://code.claude.com/docs/en/memory)).
- **Приоритет не спасает от противоречий.** Файлы конкатенируются по области действия, но «if two
  instructions contradict each other, Claude may pick one arbitrarily» — спорные места нужно
  вычищать, а не выстраивать в порядке.
- **Размер памяти.** Ориентир — меньше 200 строк на файл; длинные файлы «consume more context and
  reduce adherence». Специализированные правила выносят в модульные файлы с областью действия.
- **Ссылки на файлы.** «Reference files with @ instead of describing where code lives». Ссылка на
  каталог показывает список, а не содержимое файлов.
- **План.** Explore → Plan → Implement → Commit — когда «решить не ту задачу» это реальный риск.
  Если дифф описывается одним предложением — план не нужен, идите прямо.
- **Формат.** Для `CLAUDE.md` — markdown-заголовки и списки; XML-теги полезны для сложного промпта,
  где нужно разделить инструкции, контекст и примеры, но не являются требованием для обычной задачи
  ([Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
- **Проверка.** Просите показать вывод проверки; отдельно — «trust-then-verify gap»: правдоподобная
  реализация, которая не обрабатывает граничные случаи.
- **Строка о правилах в готовом промпте.** Это приложение добавляет к задаче одну строку — с
  `CLAUDE.md`, а не с `AGENTS.md`, потому что именно его Claude Code читает:
  `- Договорённости проекта лежат в CLAUDE.md — прочитай их (@CLAUDE.md) и не противоречь им.`

## Промпт

````markdown
## Задача
Исправить выход из системы по истечении сессии: сейчас после истечения токена страница остаётся
открытой до перезагрузки.

## Файлы
- @src/auth/session.ts — здесь живёт проверка срока
- @src/auth/refresh.ts — образец того, как проект обновляет токен

## Что не меняется
Роутинг и форма входа. Соседние модули аутентификации не трогать.

## Приёмка
- После истечения токена любой запрос уводит на вход, без ручной перезагрузки.
- Обновление токена идёт тем же путём, что в @src/auth/refresh.ts.
- Добавлен регрессионный тест на истёкшую сессию.

## Проверка
Запусти тесты и `npm run typecheck`, покажи команду и результат. Что не запускал — назови
невыполненным.

## Что вернуть
Список изменённых файлов и что в каждом изменилось.
````

Английская версия — те же разделы, ссылки `@src/...`.

## Чего не делать

- не вставлять содержимое файлов, которые Claude Code может прочитать сам — для больших кусков
  документация прямо советует дать файл, а не текст;
- не заводить `CLAUDE.md` и `AGENTS.md` с разными правилами одновременно: один читается вместо
  другого, и проигравший файл молча перестаёт действовать (поэтому приложение пишет `CLAUDE.md` как
  указатель `@AGENTS.md`);
- не раздувать `CLAUDE.md`: после ~200 строк инструкции начинают игнорироваться;
- не требовать XML-разметки «потому что Claude» — для обычной задачи это лишний слой.

## Источники

[code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) ·
[code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) ·
[code.claude.com/docs/en/common-workflows](https://code.claude.com/docs/en/common-workflows) ·
[code.claude.com/docs/en/prompt-library](https://code.claude.com/docs/en/prompt-library) ·
[platform.claude.com — Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
