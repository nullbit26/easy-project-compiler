# ChatGPT

**Поверхность:** чат в браузере; **на десктопе** режимы Work и Codex — полноценный агент редактора ·
**Ссылка на файл:** `Target File: <путь>` · **Файл правил:** — (Codex читает `AGENTS.md`)
**В списке приложения:** «ChatGPT / API»

## Главное

Всё зависит от поверхности, а не от названия модели.

| Поверхность | Видит файлы проекта? | Что просить |
| --- | --- | --- |
| Chat, Canvas, Projects в браузере | нет | приложить релевантный код и просить **полный файл** на выходе |
| Projects (инструкции проекта) | это не файлы репозитория: `AGENTS.md` из папки не подхватывается | постоянные предпочтения — в инструкции проекта, задача и код — в самом сообщении |
| Десктопное приложение, режим **Work** | да, локальные файлы и приложения — с разрешения | работать по папке, как с агентом редактора |
| Десктопное приложение, режим **Codex** | да: папки, репозитории, терминал, инструменты разработчика | задача + критерии приёмки; `AGENTS.md` читается |

## Что говорит документация (октябрь 2026)

- **ChatGPT agent больше не доступен** — OpenAI перенаправляет на **Work** для длинных задач; облачный
  браузер в Work работает с сайтами, а не с локальным диском
  ([ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent), [Using cloud browser](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt)).
- **Проекты** держат вместе чаты, файлы и инструкции проекта, но это не доступ к репозиторию
  ([Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)).
- **Инструкции.** Общие предпочтения — в custom instructions, конвенции проекта — в инструкциях
  Project, задача и код — в сообщении ([Custom instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions)).
- **`AGENTS.md`** — у **Codex**, а не у обычных проектов чата: он читает слоистые глобальные и
  проектные инструкции ([Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)).
- **Десктоп ≠ веб.** Новое десктопное приложение содержит Chat, Work и Codex; Work в десктопе может
  работать с локальными файлами и приложениями с разрешения, Codex — с папками, репозиториями и
  терминалом; Work в вебе и на мобильном доступа к файлам не имеет
  ([ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex), [Moving to the new desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app)).
- **Структура промпта.** Для API OpenAI советует markdown-заголовки и списки, а теги `XML` — как
  границы между инструкцией и контекстом
  ([Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)).
- **GPT-5.x.** В гайде по промптам для агентных сценариев: явный объём работ и критерии остановки,
  соответствие «усилия рассуждения» сложности задачи, конвенции проекта как контекст; противоречивые
  инструкции ухудшают результат ([GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)).
- **Версии.** GPT-5.5 выводится из Codex при входе через ChatGPT **14 октября 2026**; сессии по API-ключу
  это не затрагивает ([Models](https://learn.chatgpt.com/docs/models)).

## Промпт — браузерный чат (Chat, Canvas, Projects)

````markdown
## Задача
Исправить выход из системы по истечении сессии: сейчас страница остаётся открытой до перезагрузки.

## Контекст проекта
- Стек: TypeScript, React, Vite.
- Состояние сессии — в Zustand-сторе, запросы — через fetch-обёртку.

## Исходный код (актуальное содержимое файлов; ничего не додумывать за пределами приведённого)

Target File: src/auth/session.ts
```ts
// полное содержимое файла
```

## Требования
- Не сокращать код: никаких «остальное без изменений».
- Показать полный новый код файла целиком.

## Приёмка
- После истечения токена любой запрос уводит на вход без ручной перезагрузки.
````

## Промпт — десктоп, режим Codex или Work с доступом к папке

````markdown
## Задача
Исправить выход из системы по истечении сессии.

## Файлы
src/auth/session.ts — проверка срока; src/auth/refresh.ts — образец обновления токена.

## Что не меняется
Роутинг и форма входа.

## Приёмка
- После истечения токена любой запрос уводит на вход без перезагрузки.

## Проверка
Запусти `npm test` и `npm run typecheck`, покажи команду и результат; невыполненное назови
невыполненным.
````

## Чего не делать

- не просить браузерный чат «посмотреть репозиторий»: у Chat и Projects нет доступа к локальной папке,
  и результат будет выдуман;
- не рассчитывать, что Projects подхватят `AGENTS.md` из папки — это механизм Codex;
- не требовать дифф, не дав файл, к которому он применяется: без основы дифф неоднозначен;
- не считать, что десктопное приложение автоматически равно вебу или наоборот: право доступа к файлам
  зависит от выбранного режима (Chat / Work / Codex);
- не смешивать в одном промпте инструкции и данные без границ: заголовки или XML-теги отделяют
  требования от приложенного кода.

## Источники

[help.openai.com — Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) ·
[help.openai.com — Custom instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions) ·
[help.openai.com — Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) ·
[help.openai.com — Moving to the new desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app) ·
[learn.chatgpt.com — AGENTS.md for Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md) ·
[developers.openai.com — Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) ·
[developers.openai.com — GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
