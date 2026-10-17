# Промпты по каждому агенту

Один документ на инструмент. Общая часть — что писать в задаче, почему, и какие антипаттерны есть
у всех — в [../agent-prompting.md](../agent-prompting.md). Здесь только то, что действительно
различается, и готовые промпты.

| Инструмент | Поверхность | Ссылка на файл | Файл правил | Режимы |
| --- | --- | --- | --- | --- |
| [Cursor](cursor.md) | агент редактора | `@src/App.tsx` | `AGENTS.md` | Agent, Plan |
| [Claude Code](claude-code.md) | агент редактора | `@src/App.tsx` | `CLAUDE.md` | обычный, Plan |
| [Windsurf / Devin](windsurf.md) | агент редактора | `@src/App.tsx` | `AGENTS.md` | Code, Plan, Ask |
| [GitHub Copilot](github-copilot.md) | агент редактора | `#file:src/App.tsx` | `AGENTS.md` | Agent, Plan |
| [Cline](cline.md) | агент редактора | `@/src/App.tsx` | `AGENTS.md` | Plan, Act |
| [Roo Code](roo-code.md) | агент редактора | `@/src/App.tsx` | `AGENTS.md` | Architect / Code / Orchestrator |
| [Lovable](lovable.md) | конструктор | обычный путь | `AGENTS.md` | Chat, Plan, Build |
| [Bolt](bolt.md) | конструктор | обычный путь | `agents.md` | Plan, Build |
| [Replit](replit.md) | конструктор | обычный путь | `replit.md` | Plan, Build, Design Canvas |
| [ChatGPT](chatgpt.md) | чат / агент (десктоп) | `Target File: <путь>` | — | Chat, Work, Codex |
| [DeepSeek](deepseek.md) | чат | `Target File: <путь>` | — | Instant, Expert |
| [Google: Gemini, Antigravity, Jules](google.md) | чат и агент редактора | `@src/App.tsx` | `GEMINI.md` / `AGENTS.md` | Canvas, Antigravity, Jules |

**Поверхность** — это ответ на вопрос «видит ли инструмент проект и правит ли он файлы сам»:

- *агент редактора* — читает и правит файлы проекта; просите изменение, а не файл целиком;
- *конструктор* — собирает проект сам; ему нужны намерение, границы и одно изменение за раз;
- *чат* — не видит проект; ему нужно приложить код и попросить полный файл на выходе.
