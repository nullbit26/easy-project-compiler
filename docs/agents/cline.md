# Cline

**Поверхность:** агент редактора · **Ссылка на файл:** `@/src/App.tsx` · **Файл правил:** `AGENTS.md`
**В списке приложения:** «Cline»

## Главное

Ссылка на файл начинается от **корня рабочей папки**: `@/src/index.ts`, папка — с косой чертой на
конце (`@/src/components/`), в multi-root проекте — `@имя-workspace:/путь`. Каждая правка требует
подтверждения. Документация просит **одна задача — одна цель** и «clear and specific initial
prompts».

## Что говорит документация (октябрь 2026)

- **Ссылки.** Файл `@/path/to/file`, папка `@/path/to/folder/`. Упоминание файла подставляет его
  содержимое в контекст — это не разрешение и не просьба его изменить
  ([Adding Context](https://docs.cline.bot/core-workflows/working-with-files)).
- **Режимы.** **Plan** читает код, ищет и обсуждает стратегию, но не меняет файлы и не запускает
  команды; **Act** правит файлы и запускает команды, сохраняя разговор планирования. Для средних
  задач — Plan → Act; для больших многофайловых или многосессионных — `/deep-planning`
  ([Plan & Act Mode](https://docs.cline.bot/core-workflows/plan-and-act)).
- **Когда план не нужен.** Документация перечисляет прямо: опечатка, простая правка, импорт,
  изменение конфига, переименование — это Act и ничего больше.
- **Правила.** `.clinerules/` или `.cline/rules/`; короткие markdown-правила, «one concern per file»,
  и объяснение, **почему** неочевидное ограничение существует. Cline читает и `AGENTS.md`, и файлы
  правил других инструментов; правила рабочей папки важнее глобальных
  ([Rules](https://docs.cline.bot/customization/cline-rules)).
- **Задачи.** «One task should have one goal»; для несвязанной работы — новая задача, а не продолжение
  старой ([Tasks](https://docs.cline.bot/core-workflows/task-management)).
- **Устаревшее.** **Focus Chain отменён** без прямого заменителя; `.clineignore` помечен как
  «deprecate soon» и никогда не был границей безопасности
  ([Deprecations](https://docs.cline.bot/resources/deprecations), [.clineignore](https://docs.cline.bot/customization/clineignore)).
  Без исключений Cline «may load your entire project into context, including dependencies, build
  artifacts, and generated files» — то есть контекст надо ограничивать вручную.
- **Права.** «YOLO mode disables all safety checks» и разрешает все терминальные команды, включая
  разрушительные ([Auto Approve & YOLO Mode](https://docs.cline.bot/features/auto-approve)).
- **Строка о правилах в готовом промпте.** Пути считаются от корня рабочей папки, поэтому и ссылка
  такая же: `- Договорённости проекта лежат в AGENTS.md — прочитай их (@/AGENTS.md) и не противоречь им.`

## Промпт

````markdown
## Задача
Сделать поле поиска живым: список фильтруется по мере ввода, без кнопки.

## Файлы
- @/src/components/SearchField.tsx — переиспользовать существующее поле
- @/src/pages/List.tsx — фильтрация списка

## Что не меняется
Порядок сортировки, пагинация и разметка карточек. Другие страницы не трогать.

## Приёмка
- Ввод символа фильтрует список без отправки формы.
- Очистка поля возвращает полный список.
- Существующие тесты списка проходят.

## Проверка
Запусти тесты проекта и покажи команду с результатом; невыполненное назови невыполненным.
````

Многофайловая или незнакомая работа — начните в **Plan** и не переключайтесь в Act, пока план не
совпал с вашим замыслом: в отличие от повторного плана, откат правок стоит дороже.

## Чего не делать

- не подключать `@`-ссылкой папки вроде `@/src/` «на всякий случай»: содержимое попадает в контекст
  целиком, и это вытесняет полезные файлы;
- не ждать, что `.clineignore` защитит от чтения секретов — это не граница безопасности;
- не полагаться на Focus Chain в старых инструкциях: механизм отменён;
- не включать YOLO, чтобы «не нажимать подтверждения» — отменять выполненные команды Cline не может;
- не писать `@src/App.tsx` без ведущей косой черты: путь считается от корня рабочей папки.

## Источники

[docs.cline.bot/core-workflows/working-with-files](https://docs.cline.bot/core-workflows/working-with-files) ·
[docs.cline.bot/core-workflows/plan-and-act](https://docs.cline.bot/core-workflows/plan-and-act) ·
[docs.cline.bot/core-workflows/task-management](https://docs.cline.bot/core-workflows/task-management) ·
[docs.cline.bot/customization/cline-rules](https://docs.cline.bot/customization/cline-rules) ·
[docs.cline.bot/resources/deprecations](https://docs.cline.bot/resources/deprecations) ·
[docs.cline.bot/features/auto-approve](https://docs.cline.bot/features/auto-approve)
