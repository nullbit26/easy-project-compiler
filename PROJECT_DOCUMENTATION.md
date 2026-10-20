# Technical Documentation: Easy Project Compiler (AI Project Architect)

---

## 1. Project Purpose and Executive Summary

**Easy Project Compiler** (formerly known as *AI Project Architect*) is an engineering coordination platform and orchestration layer designed for software developers, non-coders, and "vibe-coders" who build applications using autonomous AI coding agents (such as Cursor, Claude Code, Windsurf, GitHub Copilot, Cline, Roo Code, Replit, Lovable, Bolt, and ChatGPT/API-driven models).

It is two things at once, and the second one grew out of the first:

1. **A planner and coach for AI agents** — it turns a vague idea into a testable plan, compiles precise prompts, audits what an agent produced, explains errors in three levels of depth, and writes the rules files (`AGENTS.md`, a one-line `CLAUDE.md` pointer, `.cursor/rules/project.mdc`) the agents expect.
2. **A local workbench for the real project folder** — it reads and writes the folder that is actually on the user's disk, runs the project, runs the project's *own* checks (type check, lint, tests, build), asks the model to repair exactly what failed, keeps undoable history, and saves versions with the user's own Git.

### 1.1 The Core Problem
When users interact with AI coding assistants without structured planning, and without a way to verify the result, projects commonly encounter critical failure modes:
1. **Context Window Degradation & Architectural Drift:** As conversations grow, LLMs forget previous decisions, generate duplicate helper singletons, or alter folder conventions.
2. **Ambiguous Requirements & Premature Plan Generation:** Generic one-shot prompting results in superficial roadmaps lacking testable acceptance criteria, explicit file boundaries, and dependency ordering.
3. **Unverified Task Completion:** Users often assume that generated code is complete when only a fraction of the acceptance criteria has been met, leading to cascading runtime failures. "The model wrote it" and "it works" are different statements, and nothing in a chat window tells them apart.
4. **Debugging Friction:** Beginners often struggle to translate raw stack traces or compiler errors into targeted instructions that AI coding agents can safely repair without introducing regressions.
5. **Work Lost Between Tools:** Prompts are copied into an editor by hand, code is pasted back for review, and a change that broke something is discovered later with nothing to roll back to.

### 1.2 The Solution
Easy Project Compiler acts as an intelligent intermediary and development lifecycle manager:
- **Interactive Clarification & Scoping:** Queries the user on architectural trade-offs (e.g., rendering engine modes, persistence strategies) before generating execution phases.
- **Precision Prompt Compilation:** Automatically compiles context-bounded prompts with targeted file references, strict acceptance criteria, token estimations, and security warnings customized for specific AI agent interfaces — and the context is chosen from the folder's own imports (the types a task forgot to name, the importers that a signature change would break, its tests), not from the first files in alphabetical order.
- **Audited Session Review:** Evaluates AI coding agent outputs against discrete acceptance criteria, computes exact completion percentages, and synthesizes step-by-step continuation prompts for partial completions.
- **Visual Error Coaching:** Parses runtime and compilation errors into a multi-tier explanation hierarchy (Simplified, Clear, and Technical), maps visual cause chains, and generates deterministic code patches with safe repair prompts.
- **Rules File Synthesis:** Automatically generates framework-specific configuration rules (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/project.mdc`) tailored to the project stack and technical depth level.
- **A real workspace, not a screenshot of one:** the connected folder is run in a sandbox served from its own loopback origin, checked by its own commands, written to through reviewable proposals with one-click undo, and versioned with Git — locally, without a network round trip.
- **Every long AI step shows its own request:** the prompt compile and the verdict are read in a live terminal — what was sent, which model answered, the text as it is written — and both can be stopped with the same control, which ends them honestly as `Отменено` instead of leaving a request running behind a hidden card.

### 1.3 Product Principles (what the app refuses to do)

These rules are enforced in code, not just in copy:

| Principle | Where it is enforced |
| :--- | :--- |
| **One folder only** — the app can never read or write outside the folder the user connected | `server/store/workspaceStore.ts` (`resolveWorkspacePath`) |
| **Secrets stay secret** — `.env`, keys, certificates are never read out loud, never sent to a model, and never shown in a diff | `isSensitiveRelativePath`, `gitService.getGitDiff` |
| **No installs, no network for checks** — checks run the project's own scripts and local binaries only | `server/services/projectChecks.ts` |
| **Nothing is written without review — except the auto-code the user launched** — the model returns text; the user ticks files and presses "write", and one task the user explicitly handed to the auto-code loop (`server/services/autonomousLoop.ts`) is written to its verdict without a click in between — always with the same undo backup and a visible live log | `server/services/changeProposals.ts`, `/api/files/apply`, `/api/autonomous/*` |
| **Every write is undoable** — a copy of each touched file is kept next to the app, never inside the folder | `applyFileChanges` / `undoFileChanges`, `data/workspace-backups/` |
| **The change has a weight** — every write reports what it added, what the project weighs now, and how heavy the build became, without pretending to know what it cannot measure | `server/services/changeWeight.ts` |
| **Tidying uses the project's own tool** — only a formatter that already exists inside the folder, only on the files just written, and never at the cost of the write | `server/services/codeFormatter.ts` |
| **Git is local** — there is no push, pull or fetch anywhere in the code | `server/services/gitService.ts` (no such commands exist) |
| **The app is a localhost tool** — every file route answers only to localhost callers | `server/utils/localRequest.ts` |
| **No page titles, no boxes around controls** — a screen opens with its work, not with an eyebrow, a badge and a paragraph repeating what the sidebar entry already says; toolbars (preview, plan, the step line of the loop) are rows of controls, not framed cards | every screen that used to open with such a header: `CodePreviewRunner`, `PlanKanban`, `PromptCompiler`, `SessionReview`, `SimpleFlow`, `BriefView`, `ProjectMap`, `VisualErrorCoach`; the sidebar footer (`Sidebar.tsx`, `BuildBadge.tsx`) is small print without a single pill |
| **One screen — one surface** — no card inside a card; the blocks of a screen are separated by a hairline and air, and the frames that remain are the ones that mean something (a field, a proposed change, a failed check) | `tests/oneSurface.test.tsx` walks every screen of the running app and fails on a plate inside a plate; `#/files` must render no cards at all (see 4.11) |

---

## 2. System Architecture

The application is structured as a full-stack, decoupled architecture composed of a client-side Single Page Application (SPA) and a server-side Node.js/Express application acting as a secure AI gateway, a local compiler, and the only component that touches the user's disk.

```
+-------------------------------------------------------------------------------+
|                                CLIENT (SPA)                                   |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                     React 19 + TypeScript + Tailwind                    |  |
|  |         (HashRouter: Dashboard, Plan Board, Compiler, etc.)            |  |
|  +-------------------------------------------------------------------------+  |
|  |            ProjectContext (State Orchestrator & LocalStorage)           |  |
|  +-------------------------------------------------------------------------+  |
|                                     |                                         |
|                                     v (REST API / Fetch)                      |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|                               SERVER (Node.js)                                |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                  Express 4.21 Gateway & Static Asset Host               |  |
|  +-------------------------------------------------------------------------+  |
|  |   Routing Layer (/api/project, /prompt, /session, /error, /files,       |  |
|  |                  /preview, /settings, /health)                          |  |
|  +-------------------------------------------------------------------------+  |
|  |            Controllers Layer (Validation, Logic, Schemas)               |  |
|  +-------------------------------------------------------------------------+  |
|  |   AI Router (Gemini / OpenAI / Anthropic / NVIDIA / OpenRouter / Groq)  |  |
|  |                    + Local Deterministic Compiler                       |  |
|  +-------------------------------------------------------------------------+  |
|  |   Local Services:  workspace store | file writer | backups | checks |   |  |
|  |                    preview builder + loopback preview origin | Git      |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
        |                                    |
        v                                    v
  data/ (keys, workspace.json,        the user's connected
  backups, checkpoints)               project folder (read/write,
                                      plus its own .git repository)
```

### 2.1 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend Framework** | React 19 (`react`, `react-dom`), TypeScript 5.8 |
| **Client Routing** | React Router v7 (`react-router-dom` using `HashRouter`) |
| **Styling & Icons** | Tailwind CSS 4 (`@tailwindcss/vite`), Lucide Icons (`lucide-react`) |
| **Animations** | Motion (`motion/react`) |
| **Backend Runtime** | Node.js (with `tsx` for development execution, `esbuild` for production bundling) |
| **Web Server** | Express 4.21 (`express`, `@types/express`) |
| **AI Integration** | Google GenAI SDK (`@google/genai`) plus OpenAI-compatible HTTP for OpenAI, NVIDIA NIM, OpenRouter and Groq |
| **Local tooling invoked by the app** | the user's own `npm`/`bun`/`pnpm`/`yarn`, `tsc`, `eslint`, `vitest`, `jest`, `pytest`, and `git` |
| **Desktop shell** | Electron 44 (`electron/main.ts`, `electron-builder` for the portable build) |
| **Development & Build** | Vite 6, Vitest 4 (jsdom + Testing Library), TypeScript Compiler (`tsc`) |
| **Localisation** | Russian / English dictionaries in `src/i18n/translations.ts` behind `LanguageContext` |

### 2.2 AI Provider Layer (multi-provider cascade + deterministic fallback)
To ensure system availability regardless of network status, API key configuration, or upstream quota limits, all intelligence endpoints implement a two-stage execution model (`server/ai/aiProvider.ts`):

1. **Primary Stage (provider cascade):**
   - Tries every provider that has a key, starting with the provider the user configured most recently (`getActiveProvider()` in `server/store/apiKeyStore.ts`).
   - Gemini goes through `@google/genai` with structured JSON schema outputs and a model sequence (`gemini-3.8-flash` &rarr; `3.6-flash` &rarr; `3.5-flash-lite`); OpenAI, NVIDIA NIM, OpenRouter and Groq are called through their OpenAI-compatible chat endpoints, each with its own ordered model list.
   - A dead or retired model does not abort the chain: the next candidate, then the next provider, is tried.
   - Every answer passes a multi-stage resilient parser (`resilientJsonParse`) that handles raw payloads, markdown code fences, stray text, and trailing commas.
   - **The answer has a stated ceiling, and running out of room is a known event.** Every request asks for one explicitly (`AI_MAX_OUTPUT_TOKENS`, 16 000 — left out, the ceiling is whatever the host defaults to, which is how a change set that carries whole files used to arrive cut in half), and the provider's own finish reason is read in all three dialects (`finish_reason: length`, `stop_reason: max_tokens`, `finishReason: MAX_TOKENS`). A host that refuses the field is asked again once without it, and Anthropic falls back from the large ceiling to the known-good 8 000 — a missing ceiling costs less than a missing provider.
   - **A cut-off answer keeps its finished part.** When the provider itself says the answer hit the output limit, the unfinished tail is dropped and the open containers are closed (`server/ai/jsonRepair.ts` → `repairTruncatedJson`), so the files that *did* arrive whole are used instead of being thrown away with the one still being written. Nothing is invented: no field is guessed, no number whose last digit is also the last character of the answer is completed (a cut `45` may have been `4500`), and nothing that was cut before its first complete value survives. The repair is applied *only* when the provider reported the cut — an answer the model considered finished and that does not parse is a different problem, and returning part of it would hand a caller something that looks whole.
   - **An unaffordable ceiling is a wallet fact, not an answer.** A host that bills per token can refuse the request outright — OpenRouter answered `402` with «you requested up to 16000 tokens, but can only afford 5318» — and the provider was lost, so the caller saw an empty model answer and the auto loop reported «Модель не вернула изменений» about a billing problem. The request is now asked again once with the number the host itself named (minus a small margin, never below 512), which keeps the provider and the answer; the second ask is bounded by `options.maxTokens`, so it cannot recurse.
   - Time is bounded twice: `AI_REQUEST_TIMEOUT_MS` per model and `AI_TOTAL_BUDGET_MS` for the whole provider chain.
2. **Secondary Stage (deterministic local rule engine):**
   - Automatically executes if no key is configured or every provider fails.
   - Applies domain-specific semantic analyzers, path heuristics, and acceptance-criteria keyword matching to produce valid structural payloads instantly — so every screen has something useful on it with no key at all.

### 2.3 The Connected Folder (workspace layer)
Everything that touches the user's disk goes through `server/store/workspaceStore.ts`, which remembers exactly one folder:

- **Connection:** `bindWorkspace()` normalises a pasted path (quotes, trailing separators), refuses a missing folder, a file, or a read-only folder, and persists the choice to `data/workspace.json`.
- **Path guard:** `resolveWorkspacePath()` rejects absolute paths, `..` escapes, NUL bytes and anything resolving outside the folder, and refuses files that look like secrets (`.env*`, `.npmrc`, `id_rsa*`, `*.pem|key|pfx|p12`, names containing `secret`/`credential`/`api-key`/`token`).
- **Reading:** `scanWorkspace()` builds the file list the UI shows (build folders, dot-folders and ignored directories are skipped); `readWorkspaceTextFile()` reads text with a size limit.
- **Writing:** `writeWorkspaceTextFile()` and `applyFileChanges()` write through the same guard, and copy each touched file into `data/workspace-backups/<changeset>/` with a manifest first.
- **Undo:** `undoFileChanges(backupId)` restores a whole changeset; `rollbackToCheckpoint()` restores the state at a named checkpoint.
- **Local-only:** `requireLocal()` guards every `/api/files/*` route, so a page loaded from the network cannot drive the file API of a running instance.
- **Re-read, not remembered:** the store compares the text of `data/workspace.json` on every read, so a folder bound by another window, a dev run or an older copy of the app is seen without a restart, while a folder that was deleted stops counting as connected.
- **The folder follows the project (client side):** `src/services/projectFolder.ts` reconnects the project's own `workspaceRoot` when the server came up without one (fresh `data`, a deleted file, an update that replaced it), refuses to show project A's code in project B, and leaves the app's one connected folder alone for a project that never recorded a path. Two guards keep the repair cheap and race-free: `folderGate.ts` holds folder requests until the reconnect lands (React runs a child's effects before its parent's), and `folderFeed.ts` tells every open window that the folder changed, so Git, the checks, the preview and the studio re-read instead of showing the previous folder.

---

## 3. Codebase Structure and Module Responsibilities

```
/
├── server.ts                       # Express bootstrap, Vite middleware, health/focus routes
├── electron/                       # Desktop shell (window without a native frame, preload bridge)
├── server/                         # Server-side modules
│   ├── ai/
│   │   ├── aiProvider.ts           # Router: Gemini / OpenAI / Anthropic / NVIDIA / OpenRouter / Groq
│   │   ├── geminiProvider.ts       # Gemini client, resilient JSON parser
│   │   └── jsonRepair.ts           # Keeps the finished part of an answer the provider cut off
│   ├── controllers/
│   │   ├── error.controller.ts     # Error diagnosis and code patch generation
│   │   ├── files.controller.ts     # Workspace, reading/writing, backups, checks, checkpoints
│   │   ├── git.controller.ts       # Git status, one file's diff, branches, local commit (localized messages)
│   │   ├── preview.controller.ts   # Preview status and the build the sandbox embeds
│   │   ├── project.controller.ts   # Question generation, idea decomposition, plan adaptation
│   │   ├── prompt.controller.ts    # Agent-targeted prompt compilation
│   │   └── session.controller.ts   # Output evaluation and continuation prompt synthesis
│   ├── routes/
│   │   ├── error.routes.ts         # /api/error/diagnose
│   │   ├── files.routes.ts         # /api/files/… (workspace, files, checks, git, checkpoints)
│   │   ├── preview.routes.ts       # /api/preview/status, /build
│   │   ├── project.routes.ts       # /api/project/…
│   │   ├── autonomous.routes.ts    # /api/autonomous/start, /pipeline, /stream (SSE), /status
│   │   ├── prompt.routes.ts        # /api/prompt/compile
│   │   ├── session.routes.ts       # /api/session/review
│   │   └── settings.routes.ts      # /api/settings/api-keys (list, save, delete, test)
│   ├── services/
│   │   ├── autonomousLoop.ts       # The self-healing write loop: proposal → disk → format → checks → repair (max 4)
│   │   ├── autonomousEvents.ts     # The loop's live event log; SSE readers subscribe here
│   │   ├── changeProposals.ts      # Turns a task into reviewable file proposals via the model
│   │   ├── changeWeight.ts         # What a write added, what the project weighs now, what the build weighs
│   │   ├── codeFormatter.ts        # Tidies the written files with the project's own Prettier/Biome/Ruff
│   │   ├── codeGraph.ts            # The import graph as pure functions: specifiers, resolution, plan order
│   │   ├── contextPlan.ts          # Reads the folder and spends the prompt budget on the graph's plan
│   │   ├── folderPicker.ts         # Native folder dialog (Windows/macOS), with a browser fallback
│   │   ├── gitService.ts           # Git status, diff, branches and a path-limited local commit
│   │   ├── previewBuilder.ts       # Builds the folder into something runnable (site or bundle)
│   │   ├── previewServer.ts        # Loopback origin that serves the folder to the sandbox
│   │   ├── projectChecks.ts        # Discovers and runs the project's own type/lint/test/build
│   │   └── workspaceFiles.ts       # Scan, read, write, backups, checkpoints, rollback
│   ├── store/
│   │   ├── apiKeyStore.ts          # Provider keys in data/api-keys.json + preferred provider
│   │   ├── verificationBaseline.ts # The previous run's checks and problems, per folder (the delta)
│   │   ├── weightBaseline.ts       # Last measured folder and build size, per folder
│   │   ├── weightBudget.ts         # The ceiling a project puts on its own build output
│   │   └── workspaceStore.ts       # The single connected folder + path/secret guards
│   └── utils/
│       ├── apiResponse.ts          # Unified JSON envelope response handlers
│       ├── checkOutputParser.ts    # Turns raw tool output into structured problems (file, line, severity)
│       ├── checkVerdict.ts         # A failed check outranks a model that says "completed"
│       ├── compileStream.ts        # The live compile channel: attempt, delta, result and error frames
│       ├── ideaAnalyzer.ts         # Local semantic analyser used by the fallback engine
│       ├── levelGuidance.ts        # Explanations and next steps per technical level
│       ├── localAcceptance.ts      # The offline prompt's criteria, built from the folder's real facts
│       ├── localRequest.ts         # Allows file routes from localhost only
│       ├── offlineFirstSteps.ts    # Useful first steps when no model is configured
│       ├── promptTexts.ts          # The exact instructions given to the model, as pure functions
│       ├── reviewStatus.ts         # The verdict's status enum, so a translated answer keeps its meaning
│       ├── rulesStaleness.ts       # The rules-vs-folder block the compiled prompt carries
│       ├── verificationDelta.ts    # Regressed/recovered checks and new/fixed problems between runs
│       ├── workspaceCode.ts        # Reads the code the AI needs as context
│       └── workspaceDigest.ts      # Compact, token-bounded description of the folder
├── src/                            # Frontend source code
│   ├── App.tsx                     # Top-level application shell and route registry
│   ├── main.tsx                    # React DOM root entry point
│   ├── index.css                   # Tailwind imports and the app's own keyframes (toast, runner light, AI mosaic)
│   ├── components/
│   │   ├── AiActivityIndicator.tsx # "The model is working" indicator
│   │   ├── ApiSettingsPanel.tsx    # API keys as a settings list: auto-save, collapse, test
│   │   ├── BriefView.tsx           # Product brief and architecture specification view
│   │   ├── BuildBadge.tsx          # Build id shown in the sidebar
│   │   ├── CheckpointTimeline.tsx  # One collapsed history: writes, checkpoints as markers, rollback
│   │   ├── CodePreviewRunner.tsx   # Runs the connected folder (site, game, app) in a sandbox
│   │   ├── Dashboard.tsx           # Project overview, phase progress bars, and stats
│   │   ├── ErrorBoundary.tsx       # Catches a render crash instead of showing a blank page
│   │   ├── GitPanel.tsx            # Changed files, diffs and "save this version" (local commit)
│   │   ├── LaunchSplash.tsx        # The short launch screen: mark, name, and a line that finishes
│   │   ├── Navbar.tsx              # The narrow window's menu button; no strip at all on a desktop window
│   │   ├── AutopilotPlate.tsx      # The live terminal plate of the auto-code loop and the pipeline
│   │   ├── PlanCanvas.tsx          # The plan as an infinite board (pan, zoom, minimap, drag)
│   │   ├── PlanContextMenu.tsx     # The board's right-click menu ("Авто" for one card; icons with tooltips)
│   │   ├── PlanKanban.tsx          # The same plan as status columns, kept for list readers
│   │   ├── PlanTaskDialogs.tsx     # Add-task and AI plan-adaptation dialogs, shared by both views
│   │   ├── ProjectCheckStrip.tsx   # The folder's own checks as one row; runs them after a write
│   │   ├── ProjectMap.tsx          # File tree and architectural entity visualizer
│   │   ├── ProjectSetup.tsx        # Wizard for new project creation (Idea & Questions / Import)
│   │   ├── ProjectWorkspace.tsx    # The folder screen: files, proposals, checks, history, Git
│   │   ├── RulesWatchdog.tsx       # Runs the rules check by itself after every written batch
│   │   ├── RunTerminal.tsx         # The live request log of both AI screens; replaces the form while it runs
│   │   ├── PromptCompiler.tsx      # Precision prompt generation interface
│   │   ├── SavedProjectsDrawer.tsx # Slide-out project management drawer
│   │   ├── SessionReview.tsx       # AI audit tool for agent outputs and continuation generation
│   │   ├── Sidebar.tsx             # Collapsible navigation drawer (folds to an icon strip)
│   │   ├── SimpleFlow.tsx          # Step-by-step helper for non-coders
│   │   ├── TaskStatusMenu.tsx      # A card's state, chosen from the app's own menu
│   │   ├── TitleBar.tsx            # App-drawn window header: controls, the screen-tools slot, the add-a-column plus
│   │   ├── Toast.tsx               # Non-blocking notification component
│   │   ├── UpdateNotice.tsx        # The update row: version, one icon, light running along the edge
│   │   ├── VerificationPanel.tsx   # Runs the project's checks and shows what broke
│   │   ├── VisualErrorCoach.tsx    # Interactive error diagnosis and code patch applicator
│   │   ├── studio/
│   │   │   ├── StudioScreen.tsx    # The split workspace: plan, sandbox, terminal, checks, files, editor
│   │   │   ├── SplitLayout.tsx     # The resizable split tree; every pane fills its box exactly
│   │   │   ├── paneActions.tsx     # The window's controls lent to each panel's own header (a context)
│   │   │   ├── studioLayout.ts     # Editable split tree, add/close surgery and resize arithmetic (pure, tested)
│   │   │   ├── PreviewPane.tsx     # The sandbox as a window: an edge-to-edge running project
│   │   │   ├── TerminalPane.tsx    # The autopilot's live log, read from the shared feed
│   │   │   ├── ChecksPane.tsx      # ProjectCheckStrip, as one window of the split
│   │   │   ├── FilePane.tsx        # The connected folder's real files; a click opens the editor
│   │   │   └── EditorPane.tsx      # Reads, edits and writes one file on disk
│   │   ├── split/
│   │   │   └── splitSizes.ts       # The drag arithmetic shared by the studio and the workspace row
│   │   ├── workspace/
│   │   │   ├── WorkspacePane.tsx   # A pane beside the screen: its header, close and screen chooser
│   │   │   └── workspaceLayout.ts  # Extra panes as a row of shares, plus their storage (pure, tested)
│   │   └── ui/
│   │       ├── AiMosaic.tsx        # The "the model is working" mark: 25 cubes that drift and turn
│   │       ├── Button.tsx          # The app's one button, icon button and segmented control
│   │       └── HelpHint.tsx        # The quiet question mark that carries one sentence
│   ├── context/
│   │   ├── LanguageContext.tsx     # RU/EN dictionaries and switching
│   │   └── ProjectContext.tsx      # Centralized React Context for project state and storage
│   ├── data/
│   │   ├── seedProjects.ts         # Reference project templates (Unity, React, Phaser, Godot)
│   │   └── seedProjectsEn.ts       # English variants of the same templates
│   ├── i18n/
│   │   └── translations.ts         # Every user-facing string, in both languages
│   ├── services/
│   │   ├── aiActivity.ts           # Client-side "AI working" state shared across screens
│   │   ├── api.ts                  # Typed client-side HTTP communication layer
│   │   ├── autopilotFeed.ts        # The autopilot's log as shared state (deduplicated SSE events)
│   │   ├── folderFeed.ts           # "The folder these windows were reading is not the folder any more"
│   │   ├── folderGate.ts           # Holds folder requests until a start-up reconnect has landed
│   │   ├── projectFolder.ts        # The one repair: the project's own folder is the server's folder
│   │   ├── rulesCheck.ts           # Reads the folder and compares the rules with it, once
│   │   ├── rulesWatch.ts           # "A batch was written" — what the automatic check listens to
│   │   ├── runStream.ts            # The live request log both screens read (facts, model, answer, outcome)
│   │   └── serverPresence.ts       # Whether /api/health answers, asked once when the window opens
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces, types, and domain models
│   └── utils/
│       ├── agentProfiles.ts        # What each agent may assume: three surfaces, mention syntax, rules file
│       ├── apiFailure.ts           # What a screen says when the build request never reached the server
│       ├── byteSize.ts             # One way to print a size and the sentence that goes with it
│       ├── canvasEdges.ts          # Dependency lines: what each link means now, how it is routed, and how several links merge into one input
│       ├── canvasView.ts           # Pan/zoom/fit maths, viewport culling, the lane layout, the crossfaded dot grid
│       ├── checkEvidence.ts        # What the folder's checks proved, as facts the review receives
│       ├── compileTrace.ts         # Reads the compiler's own keys as the steps it has reached
│       ├── copyText.ts             # Copying through the desktop shell, then the clipboard, then the selection
│       ├── fileExtractor.ts        # Finds code blocks in pasted agent output
│       ├── fileFacts.ts            # Language/framework facts derived from file names
│       ├── fileListParser.ts       # Parses a pasted folder listing
│       ├── folderPath.ts           # Path comparison/formatting for the folder field
│       ├── journeySteps.ts         # The four steps of the loop, numbered once for every screen
│       ├── laneSkin.ts             # How a plan lane is painted, and which colours a user may choose
│       ├── nextAction.ts           # The next step, derived from the plan on every render
│       ├── planAdapt.ts            # Maps the AI's re-aligned plan JSON onto project phases
│       ├── rulesAudit.ts           # Reads the rules back against the folder: repeats, dead references, contradictions
│       ├── rulesCheckStamp.ts      # When the rules were last compared, and how that moment is printed
│       ├── rulesFiles.ts           # Where the rule files go, and the document each one gets
│       ├── rulesFindingLabels.ts   # One name per finding kind, shared by the rules panel and the prompt
│       ├── rulesGenerator.ts       # Generator for AGENTS.md, the CLAUDE.md pointer, the .mdc rule
│       ├── sandboxDocument.ts      # Builds the document for a single pasted snippet
│       ├── selfTest.ts             # Whether this window is the app checking itself, not a person using it
│       ├── serverUnreachable.ts    # The sentence every screen uses when the app's own server is not there
│       ├── simpleDiff.ts           # Line diff used by review screens
│       ├── sse.ts                  # Server-sent-event frames, read a chunk at a time on both ends
│       ├── starterFile.ts          # The one file a project with no code can start from, per stack
│       ├── taskFiles.ts            # What a path dropped on a plan card becomes (cleaned, deduped, capped)
│       ├── textLocalizer.ts        # Turns engine text into the user's language
│       ├── uiLanguage.ts           # The chosen language, readable outside React (the API layer writes errors)
│       ├── updateRules.ts          # Which version is newer, what a manifest must contain, where its file lives
│       └── workingMode.ts          # Guided/full interface and autonomy levels
├── tools/
│   ├── assets/                     # make-icons.mjs — the app and .exe icons
│   ├── desktop/                    # build-desktop.mjs, run-desktop.mjs, verify-desktop.mjs
│   ├── exe/                        # build-sea.mjs (single executable), e2e-verify.mjs
│   ├── eval/                       # The context eval: fixtures, two strategies, one answerer and scorer
│   ├── folder-picker/              # Native dialog helper used by folderPicker.ts
│   ├── preview/                    # Development pages: the live AI status card and the update row
│   ├── release/                    # publish-release.mjs — upload, then read the feed back
│   └── screens/                    # capture-screens.mjs — screenshots, contact sheet and text digest
├── metadata.json                   # AI Studio application metadata
├── package.json                    # Package manifest and build scripts
├── tsconfig.json                   # TypeScript compiler configuration
├── vitest.config.ts                # Test runner configuration (jsdom)
└── vite.config.ts                  # Vite bundler configuration
```

---

## 4. Detailed Feature Breakdown

### 4.1 Interactive Project Setup Wizard (`ProjectSetup.tsx`)
- **Mode A: Idea & Clarification Flow:**
  1. *Input Formulation:* User inputs project concept, target engine/framework, AI agent, technical level (`Beginner / Non-coder`, `Vibe-coder`, `Intermediate`, `Advanced`), architectural pattern, and MVP depth (`Fast Prototype`, `Production MVP`, `Scalable Enterprise`).
  2. *AI Clarification Step:* System queries `/api/project/generate-questions` to present 3–4 project-specific architectural questions and key technical trade-offs (e.g., Canvas 2D vs. WebGL Shader, FSM vs. ECS, LocalStorage vs. Cloud DB).
  3. *Plan Compilation:* Synthesizes complete roadmaps containing structured phases, tasks, goals, acceptance criteria, test requirements, and folder hierarchies via `/api/project/create-idea`.
- **Mode B: Existing Project Import:**
  - `/api/project/import-workspace` ingests an existing project map, a pasted file structure, or a custom JSON specification.
  - `/api/project/describe-implemented` takes the folder that is already connected and describes what has been built so far, so a half-finished project enters the plan as reality rather than as a plan.
- **The dialog is drawn from the app's one button.** Every control here — the idea/import tabs, the four interface tiles, the folder actions, the AI actions and the two ways to start the plan — comes from `ui/Button.tsx` (`buttonClass`): `primary` (indigo tint with a hairline ring) for the action that moves the wizard on, `secondary` for the alternatives (including the disclosures and the trade-off choices), `ghost` for API/«Закрыть»/«Назад», `warning` for the «Дополнить примерными деталями» suggestion and `success` for creating a project from an import. The wizard used to be the one screen still carrying solid `bg-indigo-600` slabs and a filled green create button, which read as a different kit from the rest of the app and competed with the fields they sat next to. The numbered step circles keep their fill: they are a state marker, not a control (§4.20). The dialog also stopped stacking plates: the interface block, the folder block and the AI analysis are sections divided by hairlines on the dialog's own surface, not filled cards inside a card.
- **AI Smart Auto-Select:**
  - `/api/project/analyze-idea` classifies input text to recommend matching engines, architecture patterns, and platforms.

### 4.2 Project Dashboard (`Dashboard.tsx`)
- Displays overall completion percentages, active task cards, phase progression timelines, and reliability guarantees.
- Provides quick-action navigation to the active task in the Prompt Compiler or Error Coach.
- **One surface, not a stack of plates.** The project block is a single panel: the completion number and its bar sit beside the name with a hairline between them instead of in a second filled box, and the recommended action is a plain row under that line rather than a tinted card inside the card. The phases below are three columns divided by hairlines, not three bordered plates inside the panel; the four counters are siblings of the panel, so nothing on the screen is a frame around a frame.

### 4.3 Plan Board & Dynamic Adaptation (`PlanCanvas.tsx`, `PlanKanban.tsx`)
- The plan opens as an **infinite board** (`PlanCanvas.tsx`): pan by dragging, zoom at the cursor with the wheel, a minimap that is also a control, zoom/fit buttons and keyboard shortcuts (`+`, `-`, `0`, `F`, arrows).
- **A card's state is chosen from this app's own menu (`TaskStatusMenu.tsx`), and its action is one short word.** The card used to carry a native `<select>`: the trigger could be styled, the list could not — it opened as an operating-system popup with a blue highlight in the middle of a slate-and-indigo board, and it showed *nothing* for a task in `partial`, because no option carried that value while the loop writes it. The menu is drawn here instead: a dot in the state's own colour (one `STATUS_DOT` map, shared with the card header), the word the dictionary already has for the state, and a list with a check against the current one. It is rendered into `document.body` at fixed coordinates, not inside the card: cards live in a scaled container, and a list inside one would be a list at 33% zoom. It closes on a click outside, on Escape and on any scroll or resize, because a menu that stays put while the board moves hangs over the wrong card. The compile button lost its long label — the card now says `Промпт`, with `Компилировать промпт` as its tooltip and accessible name — and is drawn light on the dark board, as the one action the board exists for.
- **The controls are icons, and the overview is one short button.** The header row used to be six bordered boxes of text — a segmented Холст/Канбан switch, a long phase filter and three labelled buttons — which made a board whose whole point is the plan read like a form; the controls are now flat 32 px icons in one row with their words in the tooltip (`title` and `aria-label` are the same string, so a screen reader and a test hear what the tooltip shows). The phase filter is the one exception, because a filter has to show its value. The board overview lost its `Обзор холста` title and its icon — a card naming the board over a picture of the board said nothing the picture does not — and is folded away by a single chevron instead, leaving a strip in the corner; folded, the map is taken out of the flow rather than unmounted, so reopening it keeps its view. The tools in the other corner follow the same rule: one 32 px row of icons (links, zoom out, zoom percentage, zoom in, fit), where the links toggle used to be a filled `Связи N` pill. The word and the count live in its tooltip and accessible name, the row ends with a close button that folds it to a single slider icon, and closing it hides only the controls — the lines are a property of the plan, so they stay exactly as they were. Tested in `tests/planBoard.test.tsx` 18b.
- **The background never jumps.** The dots are not drawn at the board's own scale — a grid in world units becomes a solid haze a couple of steps below 100% and a sparse scatter above it — and they are not switched off at some threshold either, which is what made the background snap away exactly at the zoom "fit the plan" lands on. `gridLevels` (`utils/canvasView.ts`) instead draws **two levels and crossfades them**: the level that is about to turn too dense fades out while the level twice as coarse fades in, and the two always add up to one grid. The spacings are still powers of two times `GRID_BASE`, so a coarser level sits exactly on every other dot of the finer one and nothing moves while the zoom changes; only a set of dots arrives or leaves. A line drawn at a constant *screen* width is the same mistake in another place, so link thickness, arrowheads, dashes and port dots all follow the zoom between a floor and a ceiling (`linkScale`).
- Cards are ordinary React elements inside one transformed container, so the controls *inside* a card — status dropdown, "Compile Prompt" — keep working on the board. Cards are drawn as real DOM, not painted onto a canvas.
- Four **status lanes** sit on the board as faint bands (`ready`, `active`, `blocked`, `done`), so a free canvas still says what a column says.
- **A card is drawn whole at every zoom.** An earlier version dropped the footer — the status dropdown and the "Compile Prompt" button — below 60% zoom, on the reasoning that the text is unreadable that small anyway. The reasoning was wrong about the user: fit-the-plan lands at 50–85% on a four-lane board, so the button the screen exists for disappeared exactly while the whole plan was being looked at. Below 70% the button now keeps its size and turns into an icon of it (44 world px, with the full label as its `title` and `aria-label`) instead of becoming a four-pixel smudge, and the status dropdown and the card's text stay where they are.
- Cards are placed automatically by `laneLayout` (see `utils/canvasView.ts`) on first open; a dragged position is stored on the task as `canvasPosition` and wins over the layout, so a reload does not scatter the plan. "Arrange into lanes" puts every card back — into each zone *as that zone is drawn*, because the layout is laid out from the placements the user made rather than from an empty map (a card at its lane's resting place while the zone stays where it was dragged is a button that scatters a plan; `tests/planBoard.test.tsx` 13b). The view is fitted to the zones rather than to the cards, so the bottom of every lane stays on the screen as the view lands.
- **A zone carries the cards lying on it.** A zone is picked up anywhere on it — by the handle at its top, or by any empty part of the plate, which is the largest part of it — and moving it moves the zone, not just the band: every card whose **centre** sits inside the lane's rectangle travels with it, by the same distance the zone is stored as having travelled. "Lying on the zone" is read from the card's centre rather than its whole box, so a card leaning over the edge belongs to the place most of it is in and does not change hands halfway through a gesture. The cards the board laid out follow their lane by construction, so only the ones placed by hand are written down — writing a position for a laid-out card would freeze a card the plan is still allowed to rearrange — and the zone and those cards are written as **one** project update (`onUpdateCanvasLanes(lanes, positions)`). That is not a convenience: every writer in `ProjectContext` rebuilds the plan from the copy it read, so a second call would rebuild it from a snapshot without the first change in it and silently drop it, which is what "the cards stayed behind" was. `cardsOnZone` is the rule, tested in `tests/planCanvas.test.ts` (the centre, the edge, the narrowed question), `tests/planBoard.test.tsx` 47 (the same gesture through the DOM: what is drawn while the zone is in the hand, and what is stored in one call when it lands) and `tests/laneCarry.test.tsx` (the one-write contract at the project level).
- **Dragging is the whole card, and it is followed from the window.** A press anywhere on a card that is not one of its controls starts the drag, so nobody has to hunt for a twenty-pixel header strip — which, at 40% zoom, was eight pixels tall. The move and release listeners are attached to `window` *synchronously in the `pointerdown` handler*, not in an effect on the card: an effect runs after the render that follows the press, and a fast flick can deliver its first move before that — the first moves used to be silently dropped, which is what "I had to grab it several times" was. A release writes the position once (`onUpdateTaskPositions`), a press that never moved stays a click, and the drag reads the live plan through refs so a listener registered at the start cannot keep a stale copy.
- Rendering is culled to the viewport and every card is memoized on primitives, so moving one card re-renders that card rather than a plan of twenty; the whole transform maths is pure and tested in `tests/planCanvas.test.ts` (including the grid's spacing, its crossfade and the ink it lays down from one zoom step to the next).
- **Dependency lines** (`utils/canvasEdges.ts`) draw each `task.dependencies` link and colour it by what it means *now*: emerald "ready to start" (the dependency is finished, the task is not), dashed indigo "waiting on a task", dashed amber "started before its dependency" (work is under way while the task it needs is still open), faded slate "both done". Cards carry a `waits N` badge only — a task that is merely *unblocked* is said by the green link that reaches it and by the legend, not by a badge: on a plan that runs in order every card but one is ready, so the old "может начинать" chip said "this is fine" eleven times and pushed the goal down the card. A legend explains the four colours, and a reference that points at no task in the plan is reported above the board instead of quietly drawing nothing. A reference is resolved three ways: by task id, by the **short name** of one (`task_0_1` answers to `0_1`), and by title. The short name is not a convenience — an AI-written plan names a dependency by where the task sits, because ids are assigned after it answers, and the plans saved that way greeted the board with "В зависимостях указаны имена, которых нет в плане: 0_0, 0_1, 1_0" while every one of those dependencies was real. Real ids are registered first, so a short name can never shadow a task that genuinely carries that id; the prompts that build plans now ask for titles instead, and the offline fallback plans (`project.controller.ts`) write the ids the app really assigns. The lines follow a card while it is dragged, and the toggle in the board controls hides them.
- **A link is a routed line, not a curve.** It leaves its port square on (26 world px), travels, and turns at a radius that matches the cards' own corners; the route falls back to a curve only where elbows would have to double back through the cards they connect. Each line is drawn twice — a dark, wider copy underneath and the coloured line on top — because that underlay is what keeps a 1px line readable over the dot grid and the lane it crosses. The two ends carry port dots (a line that simply stops at a border reads as clipped), the arrowhead is measured in stroke widths so it grows and shrinks with the line, and the link under the pointer gets a label chip that follows its own midpoint. Hovering a card dims every link that has nothing to do with it: a plan of twenty tasks is a thicket otherwise, and the dependency being asked about is the hardest thing in it to find.
- **Several links into one task share one input.** A task with three dependencies has one input, not three: drawn as three arrows it reads as three places to attach to, and two arrowheads side by side on one border look like a mistake. Links that arrive at the same side are merged into a **trunk** — one stem on the middle of that side, one arrowhead, in the colour of the most alarming thing the group is waiting for (blocked > waiting > ready > done) — and each member turns onto that trunk at its own step out from the card, along the side's axis, so no member puts a corner on the trunk itself. The order follows the sources, so the links never cross on their way in. Links that *leave* one card still get their own share of the side, because three dependencies drawn as one line would be counted as two. Tested in `tests/canvasEdges.test.ts` (states, side choice, ports, elbow routing, merging, and the zoom scaling of a link's width) and `tests/planBoard.test.tsx` (the same board read through the DOM: a drag from the card's body, a click that only selects, lines following a dragged card, a card's controls at every zoom, and one arrowhead into a fan-in).
- **Columns remain available** (`PlanKanban.tsx`) behind the Холст/Канбан switch in the header, for reading a plan as stages. The row of controls is the same in both views — the same icons, sizes and accent — because switching how a plan is read is not switching to another product.
- **Dynamic AI Task Adaptation:** Invokes `/api/project/adapt-plan` to adapt, expand, or re-order task dependencies in response to shifting requirements or user blockers. The answer is mapped by `utils/planAdapt.ts`; the dialogs live in `PlanTaskDialogs.tsx` and are shared by both views.

- **A file can be dropped on a card, and that is the card's AI context.** The list of project files (`ProjectWorkspace.tsx`, `studio/FilePane.tsx`) is a drag source: every row carries `draggable` and writes its path as `application/x-task-file` plus a `text/plain` copy, so the gesture works both inside the app and from anything else that drags a path. The card accepts a drop only while such a path is on the clipboard (a card dragged over a card is not a file), answers with a ring while the file is held over it, and appends the path to the task's `relevantFiles` — the plan's own guess and the user's pick are one list, because that list is what the compiled prompt reads. `utils/taskFiles.ts` holds the rules and is pure, so they are tested without a browser: `file://` URLs, backslashes, quotes, `./` and URI lists are cleaned into one project-relative path; folders, web URLs and oversized strings are refused; duplicates are dropped case-insensitively; the list is capped at eight, the newest pick winning. A second drop of the same file writes nothing (`tests/taskFiles.test.ts`, `tests/planBoard.test.tsx` 47–51). The card shows the count in its footer — a row of named chips under the goal made every card taller than the height the board had placed it at, and neighbours in a lane overlapped by as much as 22 px — and the list itself (every path, each with a cross that removes it) opens above the card, over the board rather than inside it. `ProjectContext.onUpdateTaskFiles` normalizes again on the way to storage: the board is not the last place that can refuse a path the plan cannot open.

### 4.4 Prompt Compiler Engine (`PromptCompiler.tsx`)
- **Nothing is drawn before there is something to put in it.** Until the first compile the result column is one sentence on the page: the framed empty result field — the largest blank surface in the app, holding a caption about pressing Start — now appears together with the prompt, and its toolbar (copy, export) with it. The «answer from the agent» field at the bottom sits directly on the page too, instead of inside a panel of its own.
- **One action per screen.** The screen used to offer every choice twice: a Start button in the empty result box *and* one under the form, an "open the review" button in the step header *and* one next to the paste box, and an agent picker in the top bar *and* in the step card, the second being a private copy that was never saved (and could therefore disagree with the bar until the project's agent changed and reset it). Now: one Start, at the end of the form; one way into the review, next to the answer it carries; one agent — the project's own setting, and this card is the only control for it (the top bar carries the project and nothing else). The written example sentence that used to sit in the task field is a placeholder again: a project with nothing on the plan shows an empty field and says what is missing instead of compiling a prompt about somebody else's game.
- **The stage is the journey's step 3.** The header reads `Шаг 3: Промпт` — the four steps of the journey (folder, task, prompt, check) are numbered once, in `utils/journeySteps.ts`, so this screen carries the same number the step-by-step helper gives the prompt instead of restarting at 1 (see 4.15).
- **Reading order matches the work:** the task and the files the agent will see on the left, the compiled prompt on the right, and "run it in the agent and check the result" across the full width under both — it is the next thing to do with the output, not a footnote inside the result column.
- **The wait is a terminal, not a spinner (`PromptCompiler.tsx`, `RunTerminal.tsx`, `services/runStream.ts`).** The result column used to show a turning arrow and `Сборка контекста и проверка правил...` for as long as the model took, which said that something was happening and nothing else. It now opens the same panel the step-by-step helper uses: the request's own facts first (`Задача:`, `Агент:`, `Контекст: 7 файлов · Balanced`, `POST /api/prompt/compile?stream=1 · 2.9 KB`), then each provider and model as it is tried, then the prompt as the model writes it, with the caret. The header carries one icon-only stop square, named `Отменить` through `title` and `aria-label`; aborting closes the response, `createCompileStream` aborts the provider request, and the run ends as `Отменено · запрос остановлен` — no error line, no prompt claimed, the log kept where the prompt would have appeared and `Повторить` beside it. The floating seconds card is hidden on this screen too (`AiActivityIndicator hidden={… || activePath === '/compiler'}`), because the terminal already says what is running and for how long; leaving the screen brings the card back for a request that is still in flight. Pinned by `tests/compilerRun.test.tsx` (the terminal's facts and the model's live text while the result frame is held open; the stop button aborting the request and leaving `Отменено` with `Повторить`, and no prompt).
- **One tone on the screen.** The compiler had its own palette: filled indigo chips for the chosen task and the context mode, bold uppercase stage labels, a green `0 проблем` pill beside a grey one, and an amber panel behind the architecture warnings. The chosen task and the mode are now held-down slate keys (`bg-slate-800` with a hairline ring, the same as `PRESSED_CLASS` in `ui/Button.tsx`), the stage label is one quiet uppercase line, the rules counts are plain numbers with a 4 px dot that is rose only when a problem exists, and a warning or an error is a 2 px margin rule beside the text rather than a coloured slab. Within the screen, indigo stays on the single primary action (Start) and on nothing else; the arrow that hands the pasted answer to the review is a secondary control, because the screen's one main action is the compile.
- Compiles structured prompts with clear execution constraints:
  - **What each target may assume (`src/utils/agentProfiles.ts`).** The compiler knows three surfaces, not eleven hand-written styles: a **workspace** agent (Cursor, Claude Code, GitHub Copilot, Cline, Roo Code, Windsurf) reads and edits the repository, so the prompt names the goal, the files and the checks and never asks for whole files; a **chat** (ChatGPT, DeepSeek) sees only what the prompt carries, so it is asked for complete labelled files; a **builder** (Lovable, Bolt, Replit) owns the project, so the prompt is an intent with its boundaries, one meaningful change at a time.
  - **File naming follows the tool, because it is not portable:** `@path` (Cursor, Claude Code), `@/path` from the root (Cline, Roo Code), `#file:` (Copilot in the IDE), a plain path for builders, and a `Target File:` label for chats, which have no mention syntax at all. The rules file named in the prompt is only one this app actually writes — `AGENTS.md`, the `CLAUDE.md` pointer, or `.cursor/rules/project.mdc` — and `null` where the tool reads none of them, because naming a file the project does not have would be a lie in the prompt's facts.
- Computes estimated token consumption, lists included and excluded files with justification, provides architectural warnings, and details acceptance criteria.
- **The compiled prompt carries the rules check (`server/utils/rulesStaleness.ts`):** the prompt is built on top of the project's own agent rules, so a rule that names a file the folder no longer has would send the agent to write code for a path that does not exist. The request carries the rules (`rules`, `projectName`), the server reads them against the connected folder with the same `auditRules` the rules panel runs, and the answer carries the result back:
  - **Before the task, not after it:** the checked section sits at the top of the prompt, because what the agent must *not* do has to be read before what it is asked to do. Each stale line is quoted as `file:line`, with the missing path or the undeclared script named, and the sentence says what not to do about it ("do not assume this file exists — say so instead of inventing its contents", "do not run it", "do not silently pick a side").
  - **Guaranteed, not requested:** the model is told to carry the block into its own `promptText` *and* the server appends it when the model dropped it — a warning that disappears on the way to the agent leaves it following a rule that is no longer true, which is the one outcome this exists to prevent.
  - **The same three honest shapes as the panel:** stale lines with a count, "nothing disagrees — follow them as they are" (said out loud, so the agent knows the rules can be trusted), and "not checked". The last one words itself by *why* nothing was checked — no folder is connected, or the folder could not be listed — because "not checked" must never read as "everything is missing".
  - The screen shows the same findings next to the prompt (`rulesCheck` in the response), so the user sees which instructions their agent is being warned about — one checker, one wording, never two answers.
  - **Dated facts:** the section names when the folder was read (`сверка: 16.10.2026, 14:32`), and the screen prints that moment next to the findings. Facts about a folder that keeps changing are worth little without the moment they were about, and the same moment is what the rules panel keeps as its last check.
  - Tested in `tests/rulesStaleness.test.ts` (a real temporary folder: the findings, both languages, and the prompt text the compiler returns) and `tests/compilerRulesCheck.test.tsx` (the request carrying the rules, and the block on screen).

### 4.5 Audited Session Review & Continuation (`SessionReview.tsx`)
- Analyzes code and terminal output generated by external AI agents.
- **A review always draws:** every list in a verdict passes through `withReviewDefaults` before it is shown or stored, because the attempt history counts entries (`completedCriteria.length`) and a verdict saved before a field existed — or one a provider sent without it — used to throw while rendering and take the whole screen down with it.
- Verifies output against discrete task acceptance criteria.
- Assigns a calculated completion score (0% to 100%).
- If completion is below 100%, automatically generates a targeted **Continuation Prompt** (e.g., *Attempt 2, to reach 100%*) specifying remaining criteria without rewriting existing code.
- **One word per thing.** The screen of the loop is a *step* (`Шаг 4: Проверка`, the journey's own number — see 4.15) and one pass of the loop is an *attempt* (`Попытка #1`) — the word the project already stores for it (`ReviewAttempt`). The names appear side by side, so one word for both made the screen read as a puzzle.
- **The first prompt opens on request.** Arriving with no verdict yet, the right column used to spend the whole visit on a page of prompt text that repeated the task and the acceptance criteria already on the left, and presented itself as the prompt for the first step while the compiler is the screen that builds it. The card now says where the real prompt comes from, copies the first prompt rather than a continuation of one, and opens its short version on request.
- **The verdict is read, not shouted.** Every action on the screen is the shared `sm` button (32 px, 12 px label, weight 500) — run the analysis, open the sandbox, mark completed, copy the continuation — and none of them is a filled slab: `success` is an emerald tint in a hairline ring, and the colour lives in the labels rather than in full-width borders. Icon chips are one shape (a 24 px tinted tile with a ring; the completed plate is the same idea at 36 px), heading icons are 14 px, and the two criteria panels are neutral `slate-800` cards with colour only in the passed/missing headings. Progress bars are 6 px; the verdict pill is a `rounded-md` chip that stays on one line. Measured on the live screen: all four controls sit at 32 px and `main` carries no `box-shadow` at all — the state is the text, not a glow.

### 4.6 Visual Error Coach (`VisualErrorCoach.tsx`)
- Ingests raw stack traces, compiler errors, or terminal logs.
- Produces a three-tier explanation hierarchy:
  1. **Very Simple:** High-level conceptual explanation without technical jargon.
  2. **Clear:** Standard engineering explanation with direct causality.
  3. **Technical:** Low-level breakdown of memory, pointers, or framework internals.
- Constructs a visual **Cause Chain** (`Component` &rarr; `File` &rarr; `Issue` &rarr; `Outcome`).
- Generates side-by-side code diffs (`oldCode` vs. `newCode`) with a single-click "Apply Fix to Code" feature that updates the Project Map in memory.

### 4.7 Sandboxed Code Preview Runner (`CodePreviewRunner.tsx`)
- Runs the **connected project folder** inside a sandboxed `<iframe>` — served from the project's **own loopback origin**, so the browser loads the folder's real files with real URLs, content types and byte ranges (`server/services/previewServer.ts`, built by `server/services/previewBuilder.ts`).
  - An HTML page is served as it is on disk: its stylesheets, module scripts, images, fonts, workers and WebAssembly are requested by the browser itself. Relative *and* absolute paths work, `import.meta.url` points at a real URL, media streams and seeks, and `serviceWorker`/`localStorage`/`IndexedDB` behave like on a normal site.
  - Cross-origin isolation (`Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy: credentialless`) is switched on only for projects whose own code asks for it (`SharedArrayBuffer`, threads, Unity/Godot/ffmpeg/emscripten markers), so `crossOriginIsolated`, threaded WASM and precise timers work without hiding third-party CDN assets from ordinary pages.
  - A script entry (`src/main.tsx`, `src/main.js`, …) is bundled by esbuild, JSX/TypeScript included; the bundle, its stylesheet and every emitted asset are served from `/__epc__/artifact/…` instead of being inlined. A package the folder never installed is left external and answered from a CDN import map; a library used as a browser global (`new Phaser.Game(...)` with no import) is added back as a `<script>` tag at the version `package.json` asks for.
  - One bridge script (`/__epc__/bridge.js`) is injected into served pages: it reports console output and uncaught errors through the same `PREVIEW_CONSOLE_LOG` protocol as the snippet sandbox, and subscribes to `/__epc__/stream` so an edit in the folder reloads the preview (throttled to one reload per second).
  - The origin is loopback-only, checks the `Host` header (so a rebinding attack gets 403), serves only the connected folder, refuses dotfiles and secret-like files, and answers GET/HEAD only.
  - If the origin cannot start, the screen falls back to the previous inline document, so the sandbox is never empty.
  - A served page keeps its own bytes: only the bridge `<script>` line is added to it (verified in the test suite), so what the sandbox shows is the file on disk rather than a rewritten copy.
- The entry-point picker lists every page and script the folder could start from, and rebuilds on selection without changing the address the iframe already has.
- Shows build diagnostics (file, line, message) with an "Explain and fix with AI" action, and offers runtime errors to the Error Coach.
- Still accepts a single pasted snippet, for code that is not in a folder yet (`src/utils/sandboxDocument.ts`).
- **The screen is a workspace, not a page.** `#/preview` is full-bleed like the plan and the studio (`h-full`, no page scroll): the toolbar and the console keep their height, the running page takes every pixel left over, and the run source, bundle composition and diagnostics sit in a 340 px rail that scrolls on its own. It used to be a 12-column page whose preview stopped at `clamp(360px, 64vh, 780px)` — a strip of empty window under the frame and an empty third of the window beside it.
- **A pane does not have to be a window.** The same screen reads the column it was given rather than the window: below a 768 px container the run-source rail folds behind one icon in the toolbar and scrolls on its own, so the frame takes the column instead of sharing it with a 340 px rail; the frame keeps a 240 px floor and fills every pixel left over. Measured in a 420×664 px column, the preview went from 402×150 px (rail stacked under it) to 402×355 px, and it still keeps 402×238 px with the rail open. A pane that is wide enough keeps the rail as it was, and the toolbar toggle is hidden there.

### 4.8 Project Map & Brief Specification (`ProjectMap.tsx`, `BriefView.tsx`)
- **Project Map:** Visualizes the virtual file registry, file sizes, symbols, imports, and exports.
- **Brief View:** Displays product problem statements, core values, MVP feature boundaries, non-goals, and technical constraints.

### 4.9 Rules Files Generator (`rulesGenerator.ts`, `rulesFiles.ts`)
- Automatically outputs tailored instructions for AI coding assistants:
  - `AGENTS.md` — the document itself, the convention the widest set of tools reads.
  - `CLAUDE.md` — **a pointer, not a copy**: Claude Code reads `CLAUDE.md` *instead of* `AGENTS.md` when both exist, so a second copy would drift and one of the two would silently stop applying. The file holds a `@AGENTS.md` import and the reason for it.
  - `.cursor/rules/project.mdc` — the rule Cursor actually reads. It is a `.mdc` file with YAML frontmatter (`description`, `alwaysApply: true`) because Cursor ignores a plain `.md` inside `.cursor/rules/` entirely, and `.cursorrules` is the legacy single-file form.
- **Writing them into the folder:** the rules panel's "Write to the folder" button puts all three into the connected folder through the audited write path (`POST /api/files/apply`), so every file that already existed is copied into `data/workspace-backups` first and the whole batch comes back with one button (`POST /api/files/undo`). Before anything is written the panel names the folder and marks each file `create` or `replace`; afterwards it reports the server's own result per file (`created`/`updated`, or the error) plus any tidy-up by the project's own formatter.
- **The invariant:** what the panel shows is what lands on disk — the write uses the same texts the tabs display (tested in `tests/rulesFiles.test.ts`, `tests/rulesWrite.test.tsx`).
- **The rules are checked against the folder they describe (`rulesAudit.ts`):** a rules file is written once and then the project moves on — the file it names is renamed, the script it calls is deleted, the same sentence appears twice. The panel compares the documents it is about to write with the real folder and says what no longer holds. Nothing here asks a model: every finding is a comparison, and every finding carries its file, its line and the quoted text so the reader can disagree with it and see why it fired.
  - **Repeats:** the same instruction twice in one file is a problem (the second occurrence is what gets dropped); the same sentence in two rules files is a note, because that is how two tools quietly start disagreeing.
  - **Dead references:** a path the folder no longer has, and an `npm run …` script its `package.json` does not declare. Paths are read out of backticks and out of bare prose, while globs, URLs, absolute Windows paths, `node_modules` and placeholders are left alone; a file that exists anywhere under that name is enough for the checker to stay quiet, because a false alarm about a glob is how a checker gets switched off.
  - **Contradictions:** two lines about the same subject with opposite polarity ("use `get_node()`" against "never use `get_node()`"). Subjects are compared after polarity words and verbs are stripped and word order is dropped; the guards are Unicode lookarounds, because JavaScript's `\b` is ASCII-only and would never match a word in a Russian rules file — which is most of them here.
  - **Format:** a Cursor rule without frontmatter (Cursor ignores the file entirely), frontmatter that can never apply by itself, and a document holding no instruction at all.
  - **Honesty about scope:** with no folder connected the panel says exactly that — file references and commands are not compared, rather than reporting a missing `package.json` nobody looked at. The counts on screen are the problems and notes it really has.
  - **Fixing only what needs no judgement:** one button drops repeats and lines whose file or script is gone, and gives the Cursor file the frontmatter it needs. Contradictions stay on screen untouched, because which half of a contradiction is right is the author's decision. The corrected rules replace what the panel shows, what gets written to the folder and what the project stores, so the correction survives a reload — and one pass is enough: fixing the fixed documents again changes nothing.
  - **The check runs by itself after every written batch (`RulesWatchdog.tsx`, `services/rulesCheck.ts`, `services/rulesWatch.ts`):** a batch of changes written into the folder is one more chance for the rules to have drifted, so the comparison is made right after the write instead of waiting for somebody to open the rules panel and wonder. Changes reach the folder from four screens (the workspace, the review screen, the guided flow and the rules panel's own write) and they all go through `applyFileChangesApi`, so that one call announces the batch (`notifyWorkspaceBatchWritten`) and one listener reacts — a check wired into a single caller would silently stop running in the next screen that grows a write of its own. An undo announces itself too, because it writes files back. Nothing is announced for a batch that wrote nothing, for a project without rules, or when no folder is connected.
    - **The date of the last comparison is kept on the project** (`lastRulesCheck`: when it ran, and the problems and notes it found), so it survives a reload and is visible on the screen that reports on the rules rather than only on the one that ran the check. The panel prints it under the findings ("Последняя сверка: 16.10.2026, 14:32 · 2 проблем · 1 заметок"), and a project nobody has checked says so instead of showing a date that would imply somebody looked.
    - **Only real comparisons move the date.** The panel's own redraw compares the same documents with the same folder facts, so it deliberately does not restamp; the button and the automatic pass do, and so does a fix, because the corrected documents are a new comparison. A check that could not read the folder leaves the previous date standing rather than replacing it with a fresher-looking one, and a check that comes back with exactly what the last one found is recorded in silence — a toast for every unchanged reading is how a warning stops being read. When the batch did leave the rules out of step, the app says so next to the counts and points at the panel.
    - **One reading of the folder, two users:** `services/rulesCheck.ts` reads the paths and the `package.json` scripts and runs the same `auditRules`, and both the panel and the watchdog go through it, so the two can never disagree about the same folder.
  - **A dated prompt:** the compiled prompt's rules section names when the folder was read (`сверка: 16.10.2026, 14:32`), and the compile screen prints the same moment next to the findings — facts about a folder that keeps changing are worth nothing without the moment they were about.
  - **Tests:** `tests/rulesAudit.test.ts` (the reading itself), `tests/rulesAuditPanel.test.tsx` (the panel: findings from the real folder, the no-folder caveat, the re-read after the folder changes, the recorded date, and the fix reaching both the folder write and the project) and `tests/rulesWatch.test.tsx` (the automatic check: the date landing on the project through the real API module, the panel showing it after a batch written from elsewhere, silence when the reading is unchanged, and the four things a check refuses to claim — a missing folder, an empty batch, a folder it could not read, and a comparison that never ran).

### 4.10 API Settings Panel (`ApiSettingsPanel.tsx`)
- Communicates with `/api/settings/api-keys` and `/api/api-status` to show which providers have a key, and `/api/settings/api-keys/:provider/test` to test one for real (the answer names the model that replied, or the exact reason it failed).
- **A settings list, not six forms.** One row per provider on a fixed three-column grid: the name and the link to its dashboard, the field (or the mask of a saved key), and the actions with the state at the far right edge. Rows are divided by a hairline (`border-b border-slate-800/60`), never by cards — the panel itself is one surface.
- **A saved row collapses to its mask.** The input exists only while a provider has no key or after the pencil is pressed; the row then carries three named icon buttons — test (refresh), replace (pencil) and delete (trash, only for a key saved here). Nothing explains what the icons do in prose: their accessible names and tooltips carry it.
- **There is no Save button.** The key is written when the field is left or Enter is pressed (`PUT /api/settings/api-keys/:provider`); an empty field means "not now" and returns to the mask. The in-flight save is tracked synchronously, so the blur that follows Enter cannot write the same key twice, and the row shows a quiet spinner while the request is out.
- Keys are written to the gitignored `data/api-keys.json` and are picked up without a restart.

### 4.11 Project Workspace Screen (`ProjectWorkspace.tsx`)
The screen where a project stops being a plan and becomes a folder. It shows the connected folder and its files, opens one file for reading and editing, takes a task description, asks the model for **reviewable file proposals** (`/api/files/generate-changes`), lets the user tick which files to write, and writes them through the guarded file service. Around that core sit the verification panel, the Git panel and the history timeline.

- **The folder is a row, not a banner.** The screen opens on the connected folder itself — its path, the file count and the three controls that act on it — with no title over it, no "creates and edits files" badge and no green tick. "Connected" is the path being there at all; a checkmark and a colour only said it twice, and the green was the loudest thing on a screen that otherwise only lists files. The sentence about the app working only inside the folder and keeping an undo copy is a fact about the app rather than a state of the folder, so it lives in the tooltip and accessible name of one quiet question mark beside the counts (`ui/HelpHint.tsx`), not in a paragraph under the row. The same neutral treatment is used wherever the connected folder is stated (step 1 of the helper, the folder field of the wizard).
- **One surface, not a stack of plates.** The folder row, the file list, the open editor, the generator, the checks, Git and the history used to be seven rounded cards stacked inside a pane that already has an edge — and once a file was open it was a card inside a card inside a card. A window has a frame of its own, so the blocks inside are separated by a hairline and air (`border-t border-slate-800/70 pt-5`), and none of them draws a border: the only frames left are the things whose frame means something — a field, a proposed change, a failing check. On a wide screen the list and the editor share one horizontal rule and a gap instead of two plates side by side, and `VerificationPanel`, `GitPanel` and `CheckpointTimeline` are sections of the same surface rather than cards on it. Pinned by `tests/oneSurface.test.tsx`, which measures the rule on this screen (no cards at all) and on every other one (no plate inside a plate).
- **Connecting a folder:** pasted path, browsing, or the OS folder dialog (`/api/files/pick-folder`, implemented in `server/services/folderPicker.ts` with a helper in `tools/folder-picker/`).
- **Context control:** the user ticks which files the AI may see; `server/utils/workspaceDigest.ts` keeps the description of the folder inside a token budget instead of mailing the whole project to the provider.
- **A row is a handle, not just a line.** Each row is draggable, so the path can be dropped on a plan card to join that task's context (`utils/taskFiles.ts`); the tooltip says so, because a drag source nobody knows about is a drag source nobody uses.
- **Proposals, not surprises:** every change is shown as a diff with a summary, warnings, and a list of files that were skipped; nothing is written until it is accepted.
- **Tidying up after the write (`server/services/codeFormatter.ts`):** the agent produces working but untidy code — inconsistent quotes and indentation, stray blank lines. Right after a batch is written, the app runs the project's *own* formatter over exactly those files:
  - **It uses what the project has.** Prettier, Biome and Ruff are recognised; the tool the project declares in `package.json` wins over one that merely has a binary in `node_modules`, and a config file counts for something in between. Nothing is installed, nothing is fetched.
  - **It stays inside the batch.** The list comes from the write that just happened, so a run never reformats the whole repository as a side effect. Files outside the folder, files that look like secrets, oversized files and extensions the tool does not own are skipped and reported.
  - **It never breaks a write.** A missing, failing or slow formatter leaves the files exactly as they were written; the screen is told what happened instead of being handed an error.
  - **It reports what it really did.** The changed files are read back from disk, so a formatter that ran over an already tidy file is described as "nothing to change", not as work done. The result travels with the response and is recorded on the same changeset, so the timeline shows "written: 2, tidied: 1 (Prettier)".
  - The write screen has one switch for it (on by default), and `format: false` turns it off for a single call.
- **How heavy the change was (`server/services/changeWeight.ts`):** "the checks still pass" says nothing about the bill — one batch can leave a project working and three times as heavy. Every accepted write is weighed, and the numbers are kept honest by construction:
  - **The batch is counted from its own copies.** Each file's size before the write is already known (the undo copy was just taken) and its size after is on disk, so "this change: +12.4 KB" describes this change and nothing else — even when something else moved in the folder at the same time.
  - **The project is compared with the last write.** The folder's own files are summed with the same walk the file list uses (dependencies, Git and build output are not part of it), and the total is stored per folder in `data/weight.json`. The first write in a folder says there is nothing to compare with instead of inventing a percentage.
  - **Anything the batch cannot explain is named.** If the project total moved more than the batch did — a hand edit, another tool — the difference is reported as "other changes", not folded into "this write added N KB".
  - **A word when it matters:** growth of at least 20 KB *and* 20% in one go is called out. With no previous measurement the sentence is about the write ("this write is heavy"), never about the project.
  - **A truncated walk is a floor.** When a folder has more files than the walk covers, the size is reported as a lower bound rather than a total.

### 4.12 Verification Loop (`VerificationPanel.tsx`, `server/services/projectChecks.ts`)
The half of the loop that answers "does it actually work?":

- **Discovery:** the folder's own `package.json` scripts are mapped to four kinds (`typecheck`, `lint`, `test`, `build`) through aliases (`lint`/`eslint`, `test`/`test:unit`/`unit`, …); when there is no script, a locally installed binary (`node_modules/.bin/…`, `tsc`, `vitest`, `jest`, `eslint`, `pytest`, …) is used instead. A folder with nothing to run gets an empty list and a "your own command" box rather than an error.
- **Execution:** commands run inside the connected folder with the detected package manager (`npm`, `bun`, `pnpm`, `yarn`), a per-kind timeout, a hard output cap, and a kill that takes the whole process tree with it — so a hanging test suite cannot hang the app.
- **Nobody is there to answer a prompt:** standard input of a check is closed rather than left as an open pipe, so a tool that asks a question (a runner in its interactive mode, a build script waiting for a keypress) reads end-of-file and gets on with its default instead of sitting there until the 150–300 s timeout fires. Watch mode is impossible by construction: `vitest` is invoked as `node <vitest.mjs> run --reporter basic`, `jest` with `--ci`, and a script that is bare `vitest` gets `-- run` appended.
- **Closing the app stops its checks:** every running check is tracked, and a synchronous `process.on('exit')` hook kills the whole tree. A timeout only fires in the process that owns it, so without this a build was merely orphaned when the window closed — still writing to the user's folder with no screen left to report it on.
- **Nothing is reported as passing that never ran:** an id the folder does not list, with no command sent along, comes back `unavailable` rather than a green run.
- **Safety:** only executables on an allow-list may be started, a user-typed command is split into tokens that cannot chain, redirect or substitute anything, and nothing is ever installed or fetched from the network.
- **Reading the result:** `server/utils/checkOutputParser.ts` strips ANSI colour, recognises failures from TypeScript, ESLint, Vitest/Jest, pytest and common build tools, and extracts file, line, column and severity — so the panel lists problems instead of raw log paste. It also reads the *names* of failed tests (`FAIL src/math.test.js > adding > adds two numbers`, `× adds two numbers`), because the name is the part a person can act on.
- **The verdict between runs (`server/utils/verificationDelta.ts`):** "the checks failed" is a fact, "this change broke the two tests that used to pass" is an answer. Every run is compared with the previous one in the same folder (`server/store/verificationBaseline.ts` → `data/verification.json`), and the report carries the difference:
  - **Regressed checks:** passed before, do not pass now. A check only counts when it ran the *same command* both times, and a check that was never run (`unavailable`) is not a green check to fall from.
  - **Recovered checks:** failed before, pass now.
  - **New / pre-existing / fixed problems**, decided by an identity of *check + file + message*. The line number is deliberately not part of it: a patch that adds ten lines at the top of a file shifts every later error, and counting each shift as new would make the verdict noise.
  - Every problem in the report is tagged `change: "new" | "persistent"` on the server, so the screen renders the badge instead of repeating the comparison — and the panel can hide the pre-existing backlog behind one checkbox ("only new"), which is the question the user actually has after a patch.
  - A first run in a folder honestly says there is nothing to compare with.
- **What the build weighs:** when the folder has a build output (`dist`, `build`, `out`, `.output`, `.next`, …) *and* its build check happened in this pass, the directory is measured and compared with the previous build (`data/weight.json`) — "the built project is 1.42 MB, +38 KB since the last build". A leftover `dist/` from an older run is never measured, because comparing it with itself would be a lie dressed as a number.
- **The guided flow runs them itself (`ProjectCheckStrip.tsx`, `src/utils/checkEvidence.ts`):** the four-step helper has no checks screen of its own (its terminal shows the AI request, not the project's commands), so the strip in step 4 runs the folder's own commands by itself the moment the answer's code is written, with a spinner on every row while it works and the outcome in place afterwards. One request runs all checks together on purpose: each run is compared with the previous one in the same folder (above), so one call per check would overwrite that baseline with every partial run. The result becomes *facts* — which command ran, what it answered, the first problems it printed — and those facts travel into the review (`/api/session/review`), which is what stopped the verdict from telling a non-coder to run `npm install` and `tsc` in a folder this machine is already running them in (see 4.15). A folder with nothing to run gets one plain sentence instead of a fake green.
- **A failed check outranks the model (`server/utils/checkVerdict.ts`):** the reviewer is told which commands already ran and is forbidden to hand them back; if it answers "Completed" over a folder that does not compile, the verdict is corrected to `Partially Completed` at most 90%, the failed command's problems are added to `missingCriteria`, and the fact itself is prepended to `warnings`. The offline engine does the same by itself, and its continuation prompt names the check's messages as the work to finish rather than commands to run. Pinned by `tests/checkEvidence.test.ts` and `tests/sessionReviewChecks.test.ts` (both engines, with and without facts).
- **Closing the loop:** after files are written, the checks that were run before are run again automatically (`autoVerify`, on by default), and `/api/files/fix-checks` sends exactly what failed back to the model as a repair task — narrowed to the new problems and the regressed checks when a verdict exists, so a repair request does not become a rewrite of the folder's whole backlog. The repair is reviewed, applied and re-checked the same way.
- **The panel is the checks, not a manual:** the paragraph about sandboxing became the `?` beside the title, and the two things set once — a custom command and the build-weight ceiling — fold into `Настройки сборки`, closed by default. The ceiling itself stays in the open once it exists, because "the build is 1.42 MB against a 500 KB limit" is state, not configuration. The check rows, the auto-verify switch and the run button sit on one grid, so no action floats at a random height.

### 4.13 Version Saving with Git (`GitPanel.tsx`, `server/services/gitService.ts`)
The user's own Git, driven from the app — locally, and only on the files the user ticked:

- **What changed:** `GET /api/files/git/status` reports the repository the folder sits in, the branch, and every changed path with its state (new, changed, deleted, renamed, conflict) plus a `sensitive` flag for files that look like secrets.
- **What changed inside a file:** `GET /api/files/git/diff?file=…` returns Git's own diff for the working tree, or the staged version when that is the one that differs. A file Git has never seen is shown as additions, synthesised without touching the index. A secret-like file is listed but its contents are not printed; oversized diffs are cut with a note.
- **Saving:** `POST /api/files/git/commit` stages the selected new files and creates a **path-limited commit** (`git commit -- <paths>`), so exactly the ticked files are saved and changes the user staged by hand in other files stay staged and untouched.
- **Committed paths only:** the selection is validated against the list Git itself reported, so nothing outside the folder — and no Git option — can reach the command line. Git is spawned with an argument array (never a shell), with `GIT_TERMINAL_PROMPT=0` so it can never stop to ask for credentials.
- **Honest failures:** "Git is not installed", "this folder is not under Git (run `git init`)", "Git does not know your name and email yet" and "there is nothing to commit" are separate, plain-language answers — and each carries the exact command that fixes it.
- **No network:** there is no push, pull, fetch or remote handling anywhere in the service or the routes.
- **The description is drafted, not demanded:** the panel writes a first version of the message from the selection itself (for example `Add: extra.txt` or `Update files (4)`), which the user edits — so saving a version needs no API key.

### 4.14 History: Checkpoints, Backups and Rollback (`CheckpointTimeline.tsx`, `workspaceFiles.ts`)
- **Backups per write:** every accepted change copies the touched files into `data/workspace-backups/<changeset-id>/` with a manifest, and the changeset is listed in the timeline with how many files it wrote and how the checks ended.
- **Undo:** one button restores a changeset (`/api/files/undo`); the copies live next to the app, never inside the user's folder.
- **Named checkpoints:** `/api/files/checkpoints` marks a moment ("before the big refactor"), `/api/files/rollback` returns the folder to that moment, and `/api/files/checkpoints/:id` removes a marker.
- **One history, closed by default:** the section used to be two lists one under the other — «Чекпоинты и откат» above «Что было записано» — telling the same story twice. A checkpoint is a name on one write, so it now appears on that write's row (`Откатить сюда`, its label), and the writes are the only list. The whole section is a disclosure with its write count in the header; `Отметить точку` lives inside it. A point whose write has fallen out of the 25-item window stays reachable in its own row, because a point you cannot roll back to is not a point.
- **Git is separate on purpose:** checkpoints and backups protect work done through the app; Git records the versions the user decides to keep. Neither replaces the other. The panel states that in its `?` instead of a paragraph, and the `git init` / identity answers are one compact line with the command — not a tutorial block. Pinned by `tests/historySection.test.tsx`.
- **One tone on the whole Files screen:** section headings use one neutral slate icon, every action is the indigo tint from `ui/Button.tsx`, and colour is left to the word or a 6 px dot — emerald for passed, rose for failed, amber for heavy. The history chips are hairline neutrals with the coloured icon; a filled green pill on every write turned a list of facts into a row of controls, and green checkboxes (the browser's own) read as a different kit beside the studio's muted rows. Native checkboxes are the indigo accent throughout, the run/save/generate actions share one primary style, and the verdict card is a neutral surface with a coloured icon rather than a green or rose panel.

### 4.15 Step-by-Step Helper, Working Modes and Language (`SimpleFlow.tsx`, `workingMode.ts`, `levelGuidance.ts`, `i18n/`)
- **Step-by-step helper:** the same machinery presented one step at a time — the folder, the task, the prompt, the answer — with one action per screen.
- **The screens are surfaces, not stacks of cards.** The plan's tasks on step 2 are rows separated by hairlines with the chosen row tinted, instead of eight bordered cards inside a bordered card; the connected folder on step 1 is a plain block on the panel rather than a plate inside the panel; and the answer field on step 4 is four rows while it is empty and twelve once it holds something. The eight-row empty field was the biggest rectangle on the screen and said nothing an empty field does not already say by being there — its size now follows its content, and there is no paste button, because the desktop shell deliberately cannot read the clipboard.
- **The request takes the screen, and the screen is a terminal (`SimpleFlow.tsx`, `RunTerminal.tsx`, `services/runStream.ts`).** Pressing `Собрать промпт` replaces the form with the request's own log before anything is sent: the task, the agent, how many files travel as context, `POST /api/prompt/compile?stream=1` with the payload size. The answer appends `200 OK · 27.4 с` and `Промпт собран · 1 240 симв.`, a failure appends the reason and leaves the log above the form with `Повторить`, and the prompt itself opens on step 3. The same panel takes over step 4 while the verdict is written, and the prompt compiler screen uses it for its own compile (see 4.4). Nothing on it is staged: lines are written when the event happens, and the only value that keeps moving is the one that says the model is still writing. The floating seconds card is not shown on this screen (`AiActivityIndicator hidden`), because two statuses for one request — one of them a countdown in the corner — is the same wait described twice.
- **The wait shows what the model is writing (`server/utils/compileStream.ts`, `server/ai/aiProvider.ts`, `src/utils/compileTrace.ts`, `src/utils/sse.ts`).** Thirty to sixty seconds of a spinner says nothing about whether the request is moving. The compile route now answers the same JSON envelope with an additional `text/event-stream` channel (`?stream=1`): an `attempt` frame when a provider or model is tried, a `delta` frame for each piece of the model's own text, then `result` (the finished prompt) or `error`. The screen reads the stream itself — the same `fetch` response, not a second request. The panel is deliberately quiet: one slate palette at three weights, no colour per line, a dot that is rose only on a failure. The request's facts sit in a labelled column (`Задача:`, `Агент:`, `Запрос:`), events carry a timestamp, and the model's text is shown unescaped once `promptText` begins — the prompt itself growing, with a caret — falling back to the tail of the raw answer before that. The keys the compiler writes are also worded as steps: `"includedFiles"` becomes `выбирает файлы для контекста`, `"promptText"` becomes `пишет промпт`, and so on, each said once and only after the answer has reached it. The panel's header says `пишет` rather than `работает` while text is arriving. While the run is open the header also carries one icon-only control — a stop square, named `Отменить` through `title` and `aria-label` — which aborts the fetch instead of hiding a request that keeps running: the response's close reaches `createCompileStream`, the provider request is aborted, and the router's fallback chain stops (`signal.aborted` is checked before every provider, model and schema retry). The log then stays above the form with `Повторить` and ends with `Отменено · запрос остановлен` — a stopped run is not a failure, so no error line is written and no red state is left behind. The review at step 4 has the same control and the same outcome: its fetch is aborted, the server aborts the reviewer's provider request on `res` close (`session.controller.ts`), the verdict is not written, and the pasted answer stays in its field so the retry costs one click. The live line is the app's own AI mark — the five-by-five square of turning cubes from `ui/AiMosaic.tsx` — instead of a sentence: the header already names the state, the mark's words stay in `sr-only` for a screen reader, and the cubes stop moving under `prefers-reduced-motion`. A server, proxy or provider that does not stream simply answers the plain envelope, and the same client call reads it — so the live view is an addition to the route, never a second path that can disagree with it. Streaming is wired for OpenAI-compatible hosts, Anthropic and Gemini; a failed model drops its partial text before the next attempt starts. Pinned by `tests/compileStream.test.ts` (frame grammar, step marks, the route's frames, and the responder going quiet when the reader leaves), `tests/aiRouter.test.ts` (a real chunked SSE answer parsed and aborted by the timeout; an already-aborted signal starts no request, and a cancel mid-answer does not walk on to the next model) and `tests/simpleFlow.test.tsx` (a held result frame keeps the terminal open while the model's text and its `пишет промпт` step are read; the stop button aborts the request and leaves `Отменено` above the form; the same button on step 4 keeps the log and the pasted answer) and `tests/reviewAbort.test.ts` (a disconnected review aborts its provider call).
- **The sign of a run lives on the sidebar entry (`Sidebar.tsx`).** The travelling light from the update row (`epc-runner`, indigo `--epc-runner-ink`) runs around the `Пошаговый помощник` entry while a compile, a review or an error diagnosis started by the helper is in flight — the place the reader already looks to open the screen. The step card keeps `aria-busy` so the state is still announced where the work happens, but it draws no ring of its own: the card is the thing being filled in, not the status. The light goes still under `prefers-reduced-motion`. Pinned by `tests/simpleFlow.test.tsx` (the sidebar entry carries `data-helper-running`, the class and `aria-busy` mid-review; the step card's class list does not).
- **The code is written before it is judged.** The write used to live only inside the verdict card, so the order on screen was paste → judge → write, and the reviewer had nothing on disk to judge against (and asked for commands nobody could run — see 4.12). The button now sits in the answer card, above the check, and the verdict card reports what was written and takes it back.
- **A run of the loop says so (`src/services/sessionProgress.ts`).** The answer takes tens of seconds and the screen looked identical whether the app was working or idle; four attempts into a task there was no sign that the loop was still going. While the answer is being handed over or judged, the sidebar entry that leads to the helper carries a pulsing dot with the attempt number, and the screen itself shows one line — `Сессия идёт • Попытка N • <что происходит сейчас>`. One store, read from both places (the sidebar is not a parent of the screen), and it closes with the verdict so nothing keeps blinking after the work is over.
- **A task is closed by what was measured, not by a button (`SimpleFlow.tsx`).** `Отметить задачу выполненной` used to work at 0%, in front of a failing build, which made both the verdict and the check strip beside it look like decoration; four attempts of the same task could each be "done". The button is now off until the verdict is a pass *and* the folder's own checks pass, and the card under it names every reason it is off — the progress below 100%, or the checks that failed by name (`Проверки проекта не проходят: Проверка типов`). The guard sits on the action as well as on the button, and a folder with nothing to check (no `package.json`, no tsconfig) keeps the old behaviour: there is nothing to fail. Pinned by `tests/simpleFlow.test.tsx` (both reasons together, the refusal, and the enabled path when the checks pass).
- **A prompt is not built for a folder with no files (`SimpleFlow.tsx`, `src/utils/starterFile.ts`).** Asked to change code that does not exist, the agent answers "send me the project files", the reviewer can only report that nothing was done, and the next attempt is written from that nothing — which is how one task reached its fourth attempt with 0% on screen. Steps 2 and 3 now say `Пока нечего менять` and offer the only two ways out: connect a folder that has code, or create the one file the agent can fill. The file's name follows the stack (Unity → `Assets/Scripts/Main.cs`, React → `src/App.tsx`, Python → `main.py`), the reader can change it, and its first line carries the task as a comment. `Собрать промпт`, `Скопировать промпт` and `Я вставил — дальше` are disabled until the folder has a file, and the guard sits on the actions as well as on the buttons. The folder is only trusted once it has been read, so a slow or failed scan never blocks a project that may well have files. Pinned by `tests/emptyProjectGuard.test.tsx` and `tests/starterFile.test.ts`.
- **Projects that never had a map get one from the folder (`ProjectContext.tsx`).** The demo projects that come from the canvas hold a plan and a folder and no `projectMap`, and every write that needed one read `projectMap.files` straight off the project — creating the first file of such a project ended in "Cannot read properties of undefined (reading 'files')" reported as a failed write. The map is now built from the project's own identity the first time a sync, a write or an AI reading needs it. Pinned by `tests/projectMapFallback.test.tsx`.
- **Files named in headings are read as names, not as the sentence above them (`src/utils/fileExtractor.ts`).** The extractor took the first `###` it found in the 200 characters before a code fence, so a two-file answer named its second block after its first (`### src/main.ts … ### package.json` → one file, `src/main.ts`), and the dedupe then dropped it entirely: the very files the reviewer keeps asking for — `package.json`, `tsconfig.json`, `jest.config.js` — could never reach the folder. The header is now the closest line above the fence that is *nothing but* a name (`### x`, `**x**`, `` `x` ``, `File: x`), and a plain sentence above the fence is not read as a path. Pinned by `tests/fileExtractor.test.ts`.
- **Working modes:** the guided interface and the full workspace are two parts of one project state (`src/utils/workingMode.ts`), together with how much the app may do on its own (autonomy level).
  - **The helper is the default for every preset but the most technical one.** Picking a preset is the user saying how technical they are, and the answer for Beginner, Vibe-coder and Intermediate is the four steps; handing someone a ten-section workspace because they chose "Intermediate" put the screens in the way of the work. `Advanced` still opens the workspace.
  - **A preset's interface is not the user's choice.** The wizard writes the preset's interface into the project, so `interfaceModeChosen` records whether the value was picked by a person: a stored interface counts only when it was, and otherwise the preset decides. That flag is also what lets the default change reach projects saved under the old one, and what keeps a deliberate choice from being undone by an unrelated preset change.
  - **The top bar carries nothing.** The agent, the interface and the autonomy are project settings, chosen in the creation wizard and stored on the project; a row of pickers above every screen read as chrome and made the app look like a settings panel, and the project's name was already in the sidebar an inch below. What is left of the bar is the narrow window's menu button — on a desktop window it draws no strip, no height and no rule, so a full-bleed screen starts directly under the title bar.
  - **The helper has a door, in the sidebar.** While the guided interface is on, `Показать все разделы` in the sidebar reveals every section and records `full` on the project as the user's own choice — the sections are what the sidebar lists, so the door belongs there. The `Полный экран` button that used to hold a full-width strip of its own above the screen is gone: it was a second bar over a screen that was already the whole workspace.
  - **Tests:** `tests/modeParts.test.tsx` (the derivation, the defaults, the preset-write-versus-choice rule and the door) and `tests/projectMode.test.tsx` (the wizard's four cards).
- **One journey, one count (`src/utils/journeySteps.ts`).** The helper and the workspace loop teach the same four things — connect the folder, choose the task, build the prompt, check the answer — and they used to number them apart: the helper called the folder step 1 and the prompt step 3, while the compiler called that same prompt `Шаг 1: Компиляция промпта` and the review `Шаг 2`. Switching interfaces therefore restarted the count, and the same act wore two numbers. The four steps and their numbers now live in one module: the helper spells each step out on its own screen, the workspace shows the last two in depth (`Шаг 3: Промпт` on the compiler, `Шаг 4: Проверка` on the review), and both read the number from the same place — so a switch between the two interfaces carries on from where the reader was. The dictionaries hold the words (`Папка`, `Задача`, `Промпт`, `Проверка`) and no screen holds a step number of its own.
- **One word per thing.** `Шаг`/"Step" names a step of that journey and is not reused for a pass of the loop (see 4.5); the stage badge says `Текущий шаг`/"Current step", because `Этап`/"Phase" is the plan's word for a stage. The three panels inside the compiler stage carry names (`Что нужно сделать`, `Что увидит агент`, `Запустить в агенте и проверить`) instead of their own 1, 2 and 3, so no screen shows two numbering systems at once. The task card prints its state in the reader's language (`Готово`, `Частично`) and leaves the percentage to its bar, which is the only place that number appears in the card.
- **The workspace list is grouped.** Ten sections in one flat column made a dashboard, a file browser and the four steps of the AI loop look like the same kind of place; they now sit under `Начало`/`Start`, `Цикл с ИИ`/`AI loop` and `Проект`/`Project`, with the headers drawn only while the list is unfolded. The dashboard tab is called `Обзор проекта`/"Project overview" — it is an overview, and "control panel" next to an API-keys button read like settings.
- **The panel folds, and the list with it.** The 256 px column was always there, even while a wide board wanted the room; a chevron beside the project header now folds the whole panel to a 56 px strip, and `»` brings it back. Folded, every screen is still a named control — the icon plus `title` and `aria-label` — projects are their initials with the full name in the tooltip, and the session dot keeps its words for a screen reader. The shape is remembered (`easy_project_compiler_sidebar_folded`), so a folded panel stays folded on the next start. This is a different control from "Show all sections": one folds the words, the other folds the list. Pinned by `tests/sidebarFold.test.tsx`.
- **The words on screen are pinned:** `tests/interfaceWords.test.tsx` (the attempt wording, the translated state without its repeated number, the folded first prompt, the three groups and their order, and the panel titles of the compiler stage) and `tests/journeyNumbering.test.tsx` (the one count: the four steps' numbers, both headings — `Шаг 3: Промпт`, `Шаг 4: Проверка` — the loop showing step 3 instead of restarting at 1, and the helper's first screen using the same four names).
- **Level guidance:** `server/utils/levelGuidance.ts` explains the next action per technical level, and `offlineFirstSteps.ts` supplies useful first steps when no model is configured.
- **Bilingual throughout:** Russian and English dictionaries in `src/i18n/translations.ts`; server messages are localized per request, so an error reaches the user in the language the screen is in.

### 4.16 Desktop Window and Build Identity (`electron/`, `TitleBar.tsx`, `Sidebar.tsx`, `BuildBadge.tsx`)
- The desktop build opens its own window with no native title bar: the app draws the header and the window buttons, and `electron/preload.ts` is the entire bridge (the page never receives Node, the file system or a shell).
- **The sidebar is the window's one full-height column.** It starts at the window's first pixel and runs to the last, with the app's mark and name heading it; the title bar to its right carries the window controls, the add-a-column plus and an empty slot at its left end where the active screen mounts its own tools (the studio is the one that does — see 4.19), so its hairline begins at the column's edge instead of cutting across the whole window above the sidebar. No horizontal rule runs across the column: the project picker and the screen groups are separated by space, so the sidebar reads as one surface rather than a header block floating above the navigation. Pinned by `tests/windowChrome.test.tsx` (the column owns the brand, the title bar is beside it, and nothing inside carries a `border-t`).
- Everything the app remembers lives in a `data` folder next to the executable; closing the window stops the app.
- Each build carries an id (for example `261015-1430-4ed7`) shown in the sidebar and returned by `GET /api/health`, so "which version is this?" is answerable without reasoning about caches.
- The build also carries a release **version** (`1.4.0`) and the address of its release feed; `BuildBadge` shows both numbers — `v1.4.0 · 261015-1430-4ed7` — because they answer different questions: the version is what a person asks for, and only the id tells two builds of one release apart, which is the failure the badge exists for (its tooltip carries the rest).
- A run started with `--self-test` checks the app from inside its own window and writes a JSON report; the shell tells the page who started it (`--epc-self-test` via `webPreferences.additionalArguments`), so the launch animation is never drawn over the thing being measured. The animation belongs to React, so a check must not take it out of the document by hand: a node React no longer owns is a page that tears itself apart the next time the overlay hides, which is a blank window rather than a failing check.
- A window that cannot be pictured is said out loud: `capturePage()` answers with an empty image on a machine with no screen, and the report records it instead of writing a picture of nothing.
- **The self-test also opens the app without its API (`checkWithoutServer`).** A small loopback server serves the built files and answers every unknown path with `index.html` — the shape of a bare static host, where `/api/*` is a 200 of HTML rather than a 404. The window is then read for the two things this change is about: the title bar must say the app's server is missing, and the screen asked for must not print `Server error` or a transport status. A shell that loads with no API is otherwise indistinguishable from a broken build.
- **Copying goes through the shell, not through the page's permission.** The session answers every permission request with «нет» (a page that has a shell at the end of it does not need the browser's), and the page's own `navigator.clipboard.writeText` was one of the casualties: the write rejected, the copying buttons reported «Скопировано» regardless, and the person pasting pasted whatever had been on the clipboard since. The page now asks the shell (`window.desktopClipboard.write`, `installClipboardBridge`), the main process writes to the system clipboard with no permission involved, and `copyText()` in `src/utils/copyText.ts` prefers that bridge, falls back to the async clipboard in a browser, and to the selection-based `execCommand('copy')` when even that is refused — with the button's state being the *answer*, never the intention (`useCopyFlash`). Reading somebody else's clipboard is still refused, from the page and from the bridge alike.
- The self-test checks the same thing from inside the window: it writes through the bridge and the shell then reads the **operating system's** clipboard, so a shell that cannot copy fails the build instead of shipping quietly.
- **The add-a-column plus lives in this bar, not on the screen.** The app's one non-screen action is a `sm` icon button (32×32, 16 px glyph — the same control the studio's window tools draw) inside the `no-drag` group, 20 px and no hairline away from minimise/maximise/close: far enough that it does not read as a fourth window control, and outside every scrolling area, where it used to sit on the content's scrollbar. It is absent on the studio: there the left end of the bar belongs to the studio's own tools (4.19), and that plus adds a pane, not a column. It stays in place and goes visibly spent at the three-column ceiling instead of disappearing. Pinned by `tests/windowChrome.test.tsx`: the button is inside `app-title-bar`, calls its handler, and is disabled at the cap.

### 4.17 Updating the Desktop Build (`electron/updates.ts`, `updateRules.ts`, `UpdateNotice.tsx`)
- The app updates itself without an installer: it asks `<feed>/version.json` (GitHub `releases/latest/download`), compares the version, offers a download icon beside the version, and — if the offer is ignored — downloads the new `.exe` in the background (up to 20 s later) with `updateRules.ts`'s arithmetic and a SHA-256 check of the result.
- The line itself is one status row, not a card: the version, at most one icon action and a hairline of light running around the row's own edge (`epc-runner` in `index.css`), in the state's colour — indigo when a release is offered, sky while it downloads, emerald when the build is ready. The old version carried a heading, two lines of explanation and a full-width filled button, which made a background download the loudest element in the panel and restated in prose what the controls already said. The light is drawn by a pseudo-element and is not read out — the state is in words beside it — and it goes still under `prefers-reduced-motion`; the downloading row adds its own bar (with a travelling gloss, `epc-bar-sheen`) that is a real `role="progressbar"` with `aria-valuenow`.
- **A restarted build must not inherit the old build's paths.** The shell writes `EPC_DIST_DIR` into its own process before loading `server.cjs`, and the swap helper is spawned from that process. A portable build extracts every start into a new temporary folder, so the inherited path named a folder the predecessor had already deleted: the app answered `GET /` with 500 and opened a black window, while `data/startup.log` showed a normal start. `scheduleUpdateInstall` now launches the helper with `launchEnvironment()` — every `EPC_*` variable plus `NODE_ENV`, `PORT` and `ELECTRON_RUN_AS_NODE` removed — and a packaged shell always serves from its own resources folder and reports a failed load instead of leaving an empty rectangle.
- The downloaded build is put in place **after the app closes**: Windows refuses to rename the running portable `.exe` (`EBUSY`, measured), so `scheduleUpdateInstall` writes a small `.cmd` next to the download and starts it detached; the script waits for the file to be free, moves the new build over the old one, removes itself and the manifest, and restarts the app only when «Перезапустить и обновить» asked for it.
- The manifest names the file **the app calls itself** (`Easy Project Compiler.exe`), while the release keeps it as `Easy.Project.Compiler.exe` — a release host does not preserve spaces in an asset name. Both sides of that gap are answered by the app: the download follows a 404 with one more ask under the stored name (`alternateAssetUrl` in `updateRules.ts`), and the downloaded file is looked for under the name the app is *running as* — the same name the download stages it under and the swap moves.
- **A promise of «готово» is only worth the file it can find.** The staged build used to be searched for under the manifest's name alone, so a build that had downloaded its update reported it ready in the sidebar, did nothing when «Перезапустить и обновить» was pressed, and closed with `nothing newer is staged` in `data/startup.log`: the file was there, the name was not. Released as 1.0.0, that is what every tester's copy did — found by publishing 1.1.0 and watching a real 1.0.0 download it (see the manifest bullet for the half that worked). The publisher now writes the app's own name into `version.json`, which is also what the builds already in someone's hands look for, and `verify` checks the stored URL the bytes really come from.
- The updater is inert in a browser build, in `npm run dev`, and in a checkout with no release configured; the sidebar then shows nothing about updates.
- **A release counts when the feed answers, not when the upload returns 200.** `tools/release/publish-release.mjs` uploads through the REST API rather than through `gh`, using the repository's *current* name (a renamed remote answers with a redirect, and a redirected POST loses its body), and publishes a release that exists as a draft instead of writing files into it: a draft takes uploads happily and is invisible to everybody — which is the state a green publish run once left behind, with a tag page that existed and a `releases/latest/download/version.json` that answered 404. The manifest goes up last, so a feed that names a version is a feed whose file is already there, and the publisher then reads back the two URLs the app itself asks for — the manifest by content, the `.exe` by length — retrying the answers that are late, never the ones that are wrong. A failed check exits non-zero with the URL and its status; the run is green only when a build would find the update.

### 4.18 Auto-Code: the autonomous loop and the pipeline (`PlanContextMenu.tsx`, `AutopilotPlate.tsx`, `server/services/autonomousLoop.ts`, `autonomousEvents.ts`, `server/routes/autonomous.routes.ts`)
The part of the loop nobody has to sit through: the task the card names is written, formatted, checked and — on failure — repaired **without a human in between**. The manual flow (compile → copy → paste → review → write) stays exactly as it was; auto-code is the same machinery driven to the verdict by itself.

- **One task, end to end.** The AI answers with a strict JSON set of file operations (the same schema the reviewable proposals use), every path passes the same workspace guards a manual write does, the batch lands with the same undo backup, the projector's formatter runs *before* the checks (lint sees the code as the user sees it), then the folder's own native checks run (`projectChecks.ts`). A failing verdict becomes a **bounded repair packet** — the task, what was applied, the failing commands and their capped output (never the whole transcript) — sent back for the next attempt. The cap is **4 attempts** (`AUTONOMOUS_MAX_ATTEMPTS`), and a repair attempt replaces the previous batch on disk: the folder never holds two attempts of reality at once. The last failed batch stays written with its undo link — never silently discarded, never silently kept.
- **No checks is not a failed check (`autonomousLoop.ts`, `AutopilotPlate.tsx`).** A folder with nothing to run — no `package.json` scripts, no `tsconfig`, no configured command — had no verdict at all (`verdict: 'none'`), and the loop read every non-pass as a failure: four attempts, each rolling the previous batch back, with the log saying «Проверки не настроены» and then «Проверки не прошли» in turn, the toast claiming the last write could not be undone, and two of the four answers being «Модель не вернула изменений» because the repair prompt carried no code. A run with no checks now ends on its first answer: the batch stays, the run is `completed` with `verdict: 'none'`, the log says the files are written and nothing confirmed them, and the plate shows that line in amber instead of the green “every check passed”. Retries remain reserved for a check that really failed. A failed run's toast no longer invents a reason either: it names the log. Pinned by `tests/autonomousLoop.test.ts` (one attempt, no undo, no `attempt_failed`), `tests/autopilotPlate.test.tsx` (a `run_completed` with `verdict: 'none'` reads “результат не подтверждён”, never “проверки прошли”).
- **A repair attempt sees the code it is repairing (`autonomousLoop.ts`).** The first prompt carried the task's files; the repair packet carried the task and the failing output only, so the model was asked to rewrite files it could not see — the log's «Модель не вернула изменений» twice in a row. The failed batch is undone before the repair prompt is built, so the prompt now appends the same plan context (seed, imports, importers, tests) with the header that says the batch was undone — the state the model must start from. Pinned by `tests/autopilotContext.test.ts`.
- **Where it starts.** The card's right-click menu on the plan board carries «Авто» for a single task — a chip icon whose words live in the tooltip, because that menu is icons from top to bottom (`PlanContextMenu.tsx`); the toolbar's list icon («Авто: весь план по очереди») queues the plan's ready tasks back to back.
- **The pipeline.** `pickNextPipelineTask` walks the queue in plan order and skips every task whose dependency is not `completed` yet. A task that ends `completed` hands over to the next unblocked one; a task that exhausted its attempts **stops the queue** — the plan behind it is not built on top of a failing batch, and the untouched tasks are named as untouched in the log. Each verdict is handed to the client (`onTaskDone`) the moment it happens, and the plan card turns `completed` (or `blocked`, honestly) from the server's checks — not from a guess.
- **What the reader sees.** The `AutopilotPlate` (fixed terminal plate, bottom right) streams every step over SSE: attempt number, files written, formatter, checks, the verdict — with a live counter of attempts (or tasks done for the pipeline) and a pulse of the card being worked on (`data-autocoding`, `animate-pulse`). A page that reconnects mid-run replays the run's whole log first and then follows the tail; the log itself stays readable after the run (`autonomousEvents.ts`). Every line is also published to `services/autopilotFeed.ts`, the store the studio's terminal window reads — the store deduplicates a replayed `runId:seq` and remembers the run's status. In the studio the plate is `docked`: it starts and publishes the run without drawing a floating box over the split, because the terminal pane already shows the same log.
- **One run at a time.** The routes refuse a second `/api/autonomous/start` or `/pipeline` while one is in flight (`409`), and everything is localhost-only like every other mutating endpoint. No folder connected → a plain recusal; no provider key → the same, without pretending an empty answer is a verdict.
- **The folder is checked before the request (`AutopilotPlate.tsx`).** The loop writes into whatever folder the *server* has connected, and the canvas only knows the project's own path — a server that has been running since before the folder was connected, or one restarted without its data file, answers `no_workspace` while the project is perfectly ready. The plate now asks `/api/files/workspace` first: an empty server is re-bound to the project's folder and the run continues, while a server bound to a *different* folder is refused with `autoCodeWrongFolder` — starting there would write another project's code into this one. The refusal is shown as `Авто-режим не запустился.` with the reason, not as the verdict notice: «Проверки не прошли…» was a lie for a run that never reached the model, and it also cleared the reader's idea of what had happened. A `409` is named as the run already in progress, a `400` with no folder the project could name is named as the missing folder (`autoCodeNoFolder`) instead of printing the server's English sentence in a Russian window.
- **The connected folder is read from disk, not remembered forever (`server/store/workspaceStore.ts`).** The desktop window serves the API itself, and the folder is one fact shared by every process of the app: another window, a dev server or an older run of the app writes `data/workspace.json`. The store used to read the file once at boot, so a server that started before the folder was connected kept answering `no_workspace` for the rest of its life — the canvas showed a project with a folder, the server saw none, and «Авто» refused. Every read now compares the file's text; a changed file (a bind or an unbind made elsewhere) replaces the in-memory root, while a folder that was deleted still stops counting as connected. Pinned by `tests/workspaceFiles.test.ts` (a root written by "another process" appears and disappears without a restart).
- **Every screen reads the folder from one place, and the folder follows the project (`services/projectFolder.ts`, `ProjectContext.tsx`).** Files (`ProjectWorkspace.tsx`), Git (`GitPanel.tsx` → `git.controller.ts`), the checks (`ProjectCheckStrip.tsx`, `studio/ChecksPane.tsx` → `projectChecks.ts`), the preview (`studio/PreviewPane.tsx`, `CodePreviewRunner.tsx` → `previewBuilder.ts`), the studio's file and editor windows (`files.controller.ts`) and the Auto run (`autonomous.routes.ts`) all ask the server, and the server asks `data/workspace.json` on every request — no screen and no controller caches a root. What was *not* single was the repair of that file: a project remembers its own folder in `project.workspaceRoot`, the server remembers the connected one, and when the server came up without one (fresh `data`, an update that replaced it, a deleted `workspace.json`) only two screens knew how to act on that: Files offered «Подключить её», «Авто» repaired itself, and Git, checks and preview just said «папка не подключена» and stayed that way — one window disagreeing with the next about the same project. `connectProjectFolder(project, language)` is now that repair, in one module: same folder → nothing; server empty → connect the project's own; server holds another project's folder → connect the project's own (otherwise opening project B would show — and write into — project A's code); a project that never recorded a path leaves the app's one connected folder alone. It runs when a project is opened (selection and the project restored at start-up) and is deduplicated per folder, so two screens opening at once bind once. **The repair starts in the provider's first render, and every folder request waits for it (`services/folderGate.ts`).** React runs a child's effects before its parent's, so a screen mounted in the same commit used to ask first — was told «папка не подключена» for a project that records one — and kept that answer until it remounted. The transport now holds `/api/files/*` and `/api/preview/*` until the restore settles (`bind`/`unbind`/`browse`/`pick-folder` are exempt: they are how a folder gets chosen), the Auto run stays ungated so it still sees the server as it really is, and the repair itself reads through the ungated `readWorkspaceApi` so it can never wait on its own gate. When nothing is being restored the gate is open, so no request that has nothing to wait for is delayed. A folder that is gone or read-only is reported, never invented: the folder the server really has stays on screen. The Auto run passes `bindWhenDifferent: false` — it still refuses a foreign folder with `autoCodeWrongFolder` instead of switching to it. Pinned by `tests/projectFolder.test.tsx` (same folder, empty server, project switch, foreign folder, a vanished folder, two screens at once, start-up restore, and a project without a path) and `tests/folderGate.test.tsx` (a folder request held until the reconnect lands, an open gate when nothing is restoring, a failed restore that does not wedge the gate, and a screen mounted alongside the provider reading the restored folder instead of an empty one).
- **A window open when the folder changes re-reads it (`services/folderFeed.ts`).** Every one of those screens reads the folder once, when it is mounted, because each is a screen of its own — so a folder connected on «Файлы проекта» left a Git list, a checks strip or a running preview drawn a minute earlier showing the *previous* project's code, and the only fix was to leave the window and come back. The announcement is made where the folder really changes: `bindWorkspaceApi` and `unbindWorkspaceApi` in `services/api.ts`, which every path into a folder uses (the Files screen, the guided flow, a project being opened, a folder restored at start-up). The feed is a small store with a React binding (`useFolderRevision`), and the reader decides what to do with it: Git re-reads the branch and the changed files (`GitPanel.tsx`), the checks strip re-asks what the new folder can run and drops the previous folder's verdict (`ProjectCheckStrip.tsx`, `studio/ChecksPane.tsx`), the studio's file list re-reads (`studio/FilePane.tsx`), and both previews build again (`studio/PreviewPane.tsx`, `CodePreviewRunner.tsx`). Two guards keep it cheap: a failed bind announces nothing (no folder changed), and a build already in flight is left alone — it waited on the folder gate (`services/folderGate.ts`), so it is already building the folder that was just connected. Pinned by `tests/folderFeed.test.ts` (a change is counted and delivered, a throwing listener cannot fail the bind, both transport calls announce, a refused bind announces nothing) and `tests/folderRefresh.test.tsx` (Git, the checks window and the preview re-read; a build in flight is not started twice).
- **Binding a folder is recorded on the project (`ProjectWorkspace.tsx`, `ProjectContext.tsx`).** The Files screen binds the server to a path but used to leave `project.workspaceRoot` as it was, so after a restart the canvas could not name the folder to repair and showed the start route's own «No project folder is connected». Reconnecting now writes the root onto the project (`onSetProjectFolder`, no extra toast — the bind already reports itself), and the plate's preflight has three honest outcomes: a project folder missing on the server is bound; a server bound to another folder is refused; a project that never recorded a folder uses the app's one connected folder, and refuses in the window's language only when neither side can name one. `no_workspace` from the routes also carries `details.reason` and a message in the window's language, so a late refusal still reads as a folder problem instead of a crash.
- **A run that never reached the model ends in the log it opened.** The no-key refusal used to be pushed under `runId: 'no-run'` before the client's run id existed, so the stream never received it — the plate stayed on «ИИ пишет код сам · 0/4» forever while the server had already stopped. The refusal now opens the run under its real id, writes `run_failed` there and marks the descriptor failed, so both the single run and the pipeline end honestly. The log's language follows the window (`language` from `useLanguage`), not `project.language`: a TypeScript project used to receive English event texts in a Russian interface because the project's stack was sent where the reader's language belonged.
- **The prompt carries the imports, not just the names (`server/services/codeGraph.ts`, `server/services/contextPlan.ts`).** The context used to be «up to eight files the task named», so a task that forgot `types.ts` never showed the model the type its service returns, and the path list was the first 400 files in alphabetical order. Both prompts (the loop's and the reviewable proposals') now ask `planContext` for their bodies: the seeds first, then what each seed imports, then what imports it, then its tests, then the neighbours in the same folder that name the seed's symbol without importing it — one hop by default, a second only when the character budget is still open. The graph is a scanner, not a parser: ES `import`/`export … from`, `require`, dynamic `import`, `preload`, Python `from … import` and `import`, C# `using` and native `#include`; relative and project-relative specifiers are resolved against the scan's file set (trying the extensions the ecosystem omits, `./x.js` as `./x.ts`, and `index`/`__init__`), while a bare `react` or an `@/` alias is recorded as external and never becomes a path. The budget is the same 60 000 characters, but it is now spent in that order — a seed is never dropped for want of budget, everything the graph brings in has to fit — and the path list leads with the seeds and their edges instead of the alphabet. The folder is read once per task over file heads (8 KB, where imports live) and only the selected files are read in full, so nothing is cached and no stale graph can outlive an edit. Pinned by `tests/codeGraph.test.ts` (the syntaxes, `./x.js` → `./x.ts`, a bare package that must not resolve, a cycle, budget order, an unborn seed, mentions on word boundaries, determinism) and `tests/contextPlan.test.ts` (the imported type reaches the plan, an importer outranks a test, a mention, a budget crop, the seed-led path list, a path outside the folder refused) and `tests/autopilotContext.test.ts` (the loop's real prompt against a real folder: the type and the importer are there, an unrelated file is not).
- **Endpoints:** `POST /api/autonomous/start` (one task — body `taskTitle`, `goal`, `acceptanceCriteria[]`, `targetFiles[]`, `project*` fields; returns `runId`, `maxAttempts`), `POST /api/autonomous/pipeline` (queue of plan tasks, each `id`, `title`, `goal?`, `acceptanceCriteria[]?`, `targetFiles[]?`, `dependencies[]?`; returns `runId`, `queued`), `GET /api/autonomous/stream?runId=…` (SSE: typed events `run_started`/`attempt_started`/`proposal_summary`/`files_written`/`formatting`/`verifying`/`verdict`/`repairing`/`attempt_failed`/`run_completed`/`run_failed`, replay then tail, `stream_end` closes), `GET /api/autonomous/status`, `GET /api/autonomous/pipeline/:runId` (the recorded result: per-task attempts and verdicts, `stoppedBecause`).
- **Pinned by tests:** `tests/autonomousLoop.test.ts` (undo-before-retry, the cap, empty-answer recovery, bounded repair reports), `tests/autonomousPipeline.test.ts` (queue order, dependency gating, stop-on-fail, per-task verdicts), `tests/autonomousEvents.test.ts` (the log's replay, subscribers, run descriptors), `tests/autopilotPlate.test.tsx` (the menu action, the plate's live lines, the re-bind of an empty server, the refusal of a foreign folder, the refusal to start with no folder on either side, the server's late `no_workspace`, a failed re-bind's reason, and an honest `Авто-режим не запустился.` instead of «Проверки не прошли» when the start request itself failed), `tests/folderChoice.test.tsx` (a reconnected folder is recorded on the project).

### 4.19 The Studio: a split workspace (`studio/StudioScreen.tsx`, `SplitLayout.tsx`, `studioLayout.ts`)
The screens of the app are pages: each scrolls, each is a whole destination. The work itself is a loop — change a card, watch the build, read the robot's log, open the file, run the checks — so the studio puts the windows of that loop side by side and never scrolls the page.

- **Six windows, one arrangement.** `plan` (the infinite board), `preview` (the connected folder running, edge to edge), `terminal` (the autopilot's live SSE log), `checks` (the same `ProjectCheckStrip` the guided flow uses, so a run is the same run and shares the verification baseline), `files` (the folder's real files) and `editor` (read/edit/write one file, `Ctrl+S`). The arrangement the screen opens on is the plan on the left, and on the right the running project above a bottom row of checks and the autopilot log: the result and the tests a change is judged by are read at the same time as the card, not on separate screens.
- **The window controls live in the title bar, not in a row of their own.** Adding windows, the three arrangements and the reset are this screen's state, but they are not a strip of its own: they are mounted (`createPortal`) into the empty slot at the left end of `TitleBar` (`TITLE_TOOLS_ID`), aligned with the pane column below, so the top of the window has one header instead of two. Only the studio in front may take the slot — the screen stays mounted behind another one (`visitedPaths`), and a hidden studio would otherwise leave its toolbar over a screen the user is not looking at; rendered with no title bar at all (a test, an older shell) the tools fall back to their own row inside the screen rather than disappearing. Pinned by `tests/studioToolbar.test.tsx`.
- **One header per window, not a titled tab inside a titled tab.** A pane used to open with a header of its own — a small label and three buttons — sitting directly on top of the header the panel inside it already drew (the plan's filter row, the preview's entry and rebuild, the checks strip's title): two rows of chrome over content that was the point of the split, the first of them naming a window the panel already names. The pane draws no header now. Its controls — change what it holds, take the whole area, close it — are handed to the panel through `studio/paneActions.tsx` (a context, so a panel opened outside the studio draws nothing extra) and sit at the end of the panel's own header, behind a hairline that separates "acts on the contents" from "acts on the window". The plan's controls ride at the right end of its toolbar, the preview's beside rebuild and console, the checks pane — whose strip draws its own title — on a single control-height row of its own, and an empty pane keeps just the close control over the chooser. The last box in the box is gone too: as a window of the studio the plan board drops its own rounded border (`fitToPane`) and runs flush to the pane's edges, so the pane — not a card drawn inside it — is the frame; on the plan screen, where there is no pane around it, the card stays. The split has no frame or inset either (`data-testid="studio-split"`): the studio is not a rounded panel drawn inside the screen with a 12 px gutter around it, it is the screen — the title bar is the only chrome above the panes, and the plan's toolbar is the first row under it. Pinned by `tests/studioPaneChrome.test.tsx`.
- **The arrangement is the user's.** `+` — in the window's title bar — adds an **empty window** beside the focused pane (and the arrow-down button adds one underneath); the empty pane's whole body is the choice of what to put there — one icon and one word per window, no captions. A pane is closed from the header it shares with its panel, and the split it leaves behind collapses instead of leaving a gap; the last window cannot be closed. `studio`, `duo`, `quad` and `focus` remain as one-press arrangements, but nothing has to be picked in advance: the tree is edited, not chosen from a list, and at `MAX_PANES` (8) the plus stops rather than squeezing panes.
- **A window exists once.** Choosing a window that is already open elsewhere brings it here. Into an empty pane that is a **move** — the pane it left goes back to asking what goes there next; into an occupied one it **trades places**, so neither window loses what it was showing. Two previews would both claim the build and two editors the picked file. Empty panes are the exception — any number of them may wait for a choice.
- **Every pane fills its box.** Each split level is `absolute inset-0` inside a relative box, so a board, a preview or a terminal always ends flush with the split instead of stopping at an empty half-screen (a percentage height inside a flex item resolves against a height flex has not finished deciding — that is exactly how a board ends up 500 px tall in an 800 px window).
- **Resizing.** Dividers drag with the pointer and move with the arrow keys (2% per press, 10% with Shift); `adjustSizes` moves a pair, never a whole row, and stops each pane at `MIN_PANE_PERCENT` (16%). The whole tree, what each pane holds and the dragged ratios are stored under `easy_project_compiler_studio`; a stored tree is re-read node by node (slots, split ids, sizes, the 8-pane ceiling), a layout saved in the older preset format still opens, and anything undrawable falls back to the default instead of leaving an invisible window (`parseStudioState`).
- **Solo.** The maximize control in a pane's header (or `Escape`) gives it the whole area and returns to the split — a temporary zoom, not a layout change.
- **Openings.** The sidebar's «Студия» entry, and the grid icon on the plan toolbar, which opens the studio with the same board. `#/studio` is a full-bleed screen: no centred reading column, no page scroll, like `#/plan`.
- **Files → editor.** Clicking a file sets the editor's path; if no editor window is showing, an empty pane is filled with it, otherwise the editor opens beside the file list (or beside the focused pane when the list is closed).
- **The terminal is shared, not owned.** `TerminalPane` reads `autopilotFeed` with `useSyncExternalStore`; a run started by the plan's pipeline button or a card's «Авто» chip appears line by line, colour-coded by meaning (written, verifying, repairing, failed), with follow-the-tail and clear. In the studio the plate is docked, so it starts the run and publishes it instead of floating over the panes.
- **Pinned by tests:** `tests/studioLayout.test.ts` (presets as trees, adding and closing panes, split collapse, pair resizing with the floor, window trading, tree storage validation and legacy preset migration), `tests/studioToolbar.test.tsx` (the tools mounted in the bar, exactly one copy, and nothing left behind by a hidden studio), `tests/studioPaneChrome.test.tsx` (one header per pane, the controls inside it, no duplicate label), `tests/autopilotFeed.test.ts` (deduplicated replay, status transitions, counters), `tests/autopilotPlate.test.tsx` (the plate still renders its own log).
- **The shared button.** Every control is drawn from `ui/Button.tsx` — `Button`, `IconButton`, `Segmented` — one height scale (`h-7`/`h-8`/`h-9`), one radius, `font-medium`, a hairline inset ring and one accent; toolbars are icon-only with the label in the tooltip and the accessible name. The main action is a tint of that accent with a thin ring — not a filled slab (`primary` in §4.20).

### 4.20 Any screen beside the current one (`App.tsx`, `workspace/WorkspacePane.tsx`, `workspace/workspaceLayout.ts`, `split/splitSizes.ts`)
The studio is not the only place two windows are useful: while filling a task prompt you want the plan next to it, and while reading a build failure you want the files next to it. So the studio's gesture — a plus, an empty window, a choice — sits above every screen, no tab switching involved.

- **A plus in the window's title bar.** The one ghost icon that is not a screen's own lives in `TitleBar`, left of the window controls and set apart from them by 20 px of empty bar — the same `sm` plus the studio's window tools draw, so the two read as one control from screen to screen: outside every scrolling area, so it never lands on a scrollbar or covers a full-bleed panel, and the bar is already there, so the control costs no height. The studio hides it: the left end of that bar belongs to the studio's own tools (4.19), and the studio's plus adds a pane, not a column. It opens an empty column to the right, and the empty column's whole body is the chooser: one icon and one word per screen, no caption. Up to three extra columns; past that the plus stays in place, spent, and every pane is a sliver.
- **The route is the first column.** The sidebar still navigates the app; extra panes are additional readers opened beside it and never take over the route. A pane is closed from its header, and its name is the way back to the chooser.
- **A screen exists once.** Choosing a screen that another pane already shows moves it there and leaves the pane it left asking what goes there next: two live boards would fight over one selection, two previews over one build. The picker never offers a screen that is already in the row.
- **The row is the studio's divider.** Dragging a divider trades percent with its neighbour (`adjustSizes`, shared with the studio through `split/splitSizes.ts`) and the arrow keys nudge it (2%, 10% with Shift); the shares are stored, so the row opens the way it was left. `easy_project_compiler_workspace` holds the panes and the shares; an unknown screen, a duplicated id or shares that do not match the columns are dropped (`parseWorkspace`).
- **Screens lay themselves out by the column, not the window.** The content wrapper and each pane are `@container`s, and the screens' layout breakpoints are container variants (`@xl`/`@2xl`/`@3xl` instead of `sm`/`md`/`lg`): a screen in a 460 px pane stacks its cards and folds the sandbox's run-source rail behind one toolbar icon (see 4.7), while the same screen at full width keeps its desktop grid and its rail. A viewport breakpoint cannot know that it was moved into a pane — this is what keeps the panes readable.
- **Quiet primary actions.** `ui/Button.tsx` draws `primary` as an indigo tint with a hairline ring and no fill: the main action is findable without competing with the content it acts on, the same way the studio's window tools behave. `success` and `warning` are tints in the same ring; a filled surface is kept for `danger` alone, the one action that should stop the eye. No variant carries a shadow — depth is the hairline ring. Screen toolbars are icon-only — the sandbox's «Пересобрать и запустить» is the rebuild icon in the tooltip. Pinned by `tests/buttonStyles.test.ts`: no shadow or blur on any variant, only `danger` is a solid coloured fill, and every size rises by one step with icon-only controls square to their text sibling.
- **Pinned by tests:** `tests/workspaceLayout.test.ts` (add/close, shares, one screen per pane, storage validation), `tests/workspacePane.test.tsx` (the chooser's DOM: what it offers, what it emits, the header's way back and close), `tests/studioLayout.test.ts` (the shared split arithmetic still holds for the studio).

### 4.21 Notifications (`Toast.tsx`, `ProjectContext.tsx`)
One line under the title bar, for the short time a report needs.

- **It says the sentence, not the occasion.** The toast used to be a green plate with a tick, an emerald border and a shadow — a one-line report dressed as a dialog — and the tick claimed "success" for every message, including the ones that were not one. What is left is the sentence in 11 px, a hairline `slate-800` border, a `slate-900/95` surface, a content-sized width capped at 26 rem and a 24 px close control. It sits 8 px under the 36 px title bar (`top-11`), so it never covers the window's own controls.
- **It arrives and leaves over time.** Both motions are CSS keyframes in `index.css` (`.toast-enter`, `.toast-leave`): an element inserted and given its final class in the same frame never paints the starting value, so a transition has nothing to animate — which is why the old `animate-in fade-in slide-in-from-top-4` classes (they belonged to a plugin this project does not install) left the toast jumping into place. The entrance ramps `opacity` from 0 to 1 in 200 ms; the exit runs 220 ms and the component keeps the last text mounted for that long instead of unmounting on the frame the message becomes `null`. Under `prefers-reduced-motion` both animations are 1 ms.
- **One message at a time.** `ProjectContext` replaces the current message and clears it after 4.5 s; a new message restarts the window. The toast is a report, not a log — the persistent history lives in the terminal, the checklist and the attempt history.
- **Pinned by tests:** `tests/toast.test.tsx` (the enter animation class, the text staying mounted through `toast-leave`, no `emerald` and no second icon, and the close control calling its handler).

### 4.22 The AI is working: one mark, one status card (`AiActivityIndicator.tsx`, `ui/AiMosaic.tsx`, `services/aiActivity.ts`)
A 30–60 second wait with no feedback looks like a freeze, so every AI request reports itself, from every screen.

- **The state is shared, not per screen.** `services/aiActivity.ts` counts the requests in flight and remembers the newest one's kind, start time and outcome; the card reads it through the store and sits fixed in the bottom-right corner as a `role="status"` with `aria-live="polite"`. Screens call `trackAiRequest(kind, …)`, so no screen invents its own spinner or its own wording, and a failed request always decrements the count — a status that sticks is worse than none.
- **The mark is the app's own, not a spinner.** `ui/AiMosaic` draws a square from 25 three-pixel cubes on a 5×5 lattice, one pixel apart, the gaps being part of the drawing. Each cube drifts out along its own radius, turns a full revolution and comes back in sky; the colour is swapped only while a cube is edge-on, so the change hides inside the turn. Drift and turn are two animations on two elements (`epc-mosaic` in `index.css`), so neither timing bends the other, and the scatter is deterministic (`Math.sin`-based) — a re-render never reshuffles the field. The mark is purely decorative (`aria-hidden`), because the card says the work in words.
- **It is never framed.** No plate, border, ring, tinted tile or rounded square goes behind or around the mark: a box turns an indicator into a button, and a square inside a square is exactly the furniture the mark replaces. The card reserves a bare 32×32 slot so swapping the mark for a verdict icon does not move the text, and nothing is drawn in it; the autopilot plate keeps the same rule. Pinned by `tests/aiActivity.test.tsx` and `tests/autopilotPlate.test.tsx`, which fail on `border`/`ring`/`rounded`/`bg`/`shadow` classes on the mark or its slot.
- **The wait gets words when it gets long.** The label names the kind of work («Компилирую промпт», «Проверяю ответ»…), the seconds are counted from the request's real start, and after 15 s the card says how long this usually takes; past 90 s it explains that the local engine will answer if the model stays silent. A request that fails says so instead of claiming «Готово», which is kept for a success and flashes for 1.8 s before the card goes away.
- **Not where a terminal already shows the request.** The step-by-step helper and the prompt compiler show the request as its own terminal (`RunTerminal.tsx`, sections 4.15 and 4.4), so the floating card is hidden on both (`<AiActivityIndicator hidden={activePath === '/simple' || activePath === '/compiler'} />`). Leaving either screen brings it back, so a request started there is still accounted for elsewhere. The card is still the answer everywhere else, where there is nothing else to read.
- **Pinned by tests:** `tests/aiActivity.test.tsx` (one label per kind, the counted seconds, both hints, a failure that clears the state, the 25 cubes with no `.animate-spin`, and the unframed slot).

---

## 5. API Reference & Data Contracts

All server endpoints communicate over HTTP using JSON payloads. Successful responses adhere to the standard envelope format:

```json
{
  "success": true,
  "data": { ... },
  "engine": "gemini" | "local"
}
```

Failures use the same envelope with `success: false`, a machine-readable `error`, a `userMessage` already written in the user's language, and optional `details`:

```json
{
  "success": false,
  "error": "no_workspace",
  "userMessage": "Папка проекта ещё не подключена. Укажите путь к папке с вашим проектом.",
  "details": { "reason": "no_workspace" }
}
```

### 5.1 Endpoints Specification

#### 1. System Health
- **Route:** `GET /api/health`
- **Response:**
  ```json
  {
    "status": "ok",
    "app": "Easy Project Compiler",
    "packaged": false,
    "build": { "id": "dev", "builtAt": "", "mode": "development", "stateDir": null },
    "hasGeminiKey": false,
    "aiProvider": "nvidia",
    "workspaceRoot": "C:\\Users\\you\\Desktop\\my-game"
  }
  ```
  `build` is an object rather than a string: a packaged build reports its stamped id (for example `261015-1430-4ed7`), while a development run reports `id: "dev"`. It also answers "which folder is connected" without a second request.

#### 2. Provider API Status
- **Route:** `GET /api/api-status`
- **Response:**
  ```json
  {
    "gemini": false,
    "openai": false,
    "anthropic": false,
    "nvidia": true,
    "openrouter": false,
    "groq": false,
    "activeProvider": "nvidia",
    "providers": [
      {
        "id": "nvidia",
        "envVar": "NVIDIA_API_KEY",
        "labelRu": "NVIDIA NIM",
        "labelEn": "NVIDIA NIM",
        "keyUrl": "https://build.nvidia.com/settings/api-keys",
        "configured": true,
        "source": "app",
        "masked": "nvap••••••A5YD",
        "prefixWarning": false
      }
    ]
  }
  ```
  Keys are only ever described (present or not, and masked), never returned.

#### 3. Provider Keys
- `GET /api/settings/api-keys` — `{ providers, activeProvider, lastModel }`, where each provider carries `configured`, the `source` of the key (`env` or `app`) and a masked key; the value itself is never returned.
- `PUT /api/settings/api-keys/:provider` — save or replace a key.
- `DELETE /api/settings/api-keys/:provider` — forget a key.
- `POST /api/settings/api-keys/:provider/test` — make one real call; the answer names the model that replied or the reason it failed.

#### 4. Generate Clarification Questions
- **Route:** `POST /api/project/generate-questions`
- **Request Body:**
  ```json
  {
    "idea": "string",
    "platform": "string (optional)",
    "stack": "string (optional)",
    "agent": "string (optional)",
    "skillLevel": "string (optional)",
    "architecturalPattern": "string (optional)",
    "reliabilityGuarantees": ["string"],
    "mvpDepth": "string (optional)"
  }
  ```
- **Response Data:** `{ "questions": [ { "id", "topic", "questionText", "placeholder", "defaultSuggestion" } ], "tradeOffs": [ { "id", "title", "optionA", "optionB", "recommendation" } ] }`

#### 5. Create Project Plan from Idea
- **Route:** `POST /api/project/create-idea`
- **Request Body:** `idea`, `projectName`, `platform`, `stack`, `agent`, `skillLevel`, `architecturalPattern`, `reliabilityGuarantees`, `mvpDepth`, `userAnswers` (map of question IDs to answers), and `tradeOffChoices`.
- **Response Data:** Complete project plan containing `projectName`, `projectType`, `engineOrFramework`, `language`, `tagline`, `targetAudience`, `coreProblem`, `coreValue`, `mvpFeatures`, `futureFeatures`, `nonGoals`, `technicalConstraints`, `successCriteria`, `clarifyingQuestions`, `architecture`, and `phases`.

#### 6. Analyse an Idea / Import a Project
- `POST /api/project/analyze-idea` — classifies the idea and recommends stack, level and MVP depth.
- `POST /api/project/import-workspace` — builds a project plan from an existing folder, file map or JSON.
- `POST /api/project/describe-implemented` — describes what the connected folder already implements.

#### 7. Dynamic Plan Adaptation
- **Route:** `POST /api/project/adapt-plan`
- **Request Body:** `{ "project": { ... }, "userGoal": "string (optional)", "targetPhaseId": "string (optional)" }`
- **Response Data:** `{ "phases": [ ... ] }`

#### 8. Compile Prompt
- **Route:** `POST /api/prompt/compile`
- **Live channel:** `POST /api/prompt/compile?stream=1` (or `Accept: text/event-stream`). The body and the final envelope are unchanged; the response is `text/event-stream` with one JSON frame per `data:` line: `{"type":"attempt","provider","model"}`, `{"type":"delta","text"}`, then `{"type":"result","success":true,"data":CompiledPrompt,"engine"}` or `{"type":"error","error"}`. A plain request never opens the channel.
- **Request Body:** `{ "userRequest", "taskTitle", "projectMap", "brief", "agent", "contextMode" }`
- **Response Data:** `CompiledPrompt` — `taskTitle`, `confidence`, `includedFiles`, `excludedFiles`, `missingContext`, `architectureWarnings`, `promptText`, `acceptanceCriteria`, `tests`, `estimatedTokens`, `nextBestAction`, `securityWarnings`.

#### 9. Session Review
- **Route:** `POST /api/session/review`
- **Request Body:** `{ "agentOutput", "task", "projectMap", "stepNumber", "previousHistory" }`
- **Response Data:** `SessionReview` — `status`, `progressPercent`, `completedCriteria`, `missingCriteria`, `warnings`, `unintendedChanges`, `nextBestAction`, `agentOutputSummary`, `continuationPrompt`.

#### 10. Diagnose Error
- **Route:** `POST /api/error/diagnose`
- **Request Body:** `{ "errorText", "codeContext", "projectCodeDescription", "projectType", "framework" }`
- **Response Data:** `ErrorDiagnosis` — `errorType`, `location`, `whenOccurs`, `explanations` (`verySimple`, `clear`, `technical`), `likelyCauses`, `affectedFeatures`, `visualCauseChain`, `codeDiff`, `repairPrompt`, `verificationSteps`, `confidenceScore`, `missingContextNeeded`.

#### 11. The Connected Folder
Guard: every route below answers only to localhost callers.

| Route | Purpose |
| :--- | :--- |
| `GET /api/files/workspace` | Connection state + a fresh scan + backups, timeline and checkpoints |
| `POST /api/files/bind` / `POST /api/files/unbind` | Connect or forget a folder |
| `GET /api/files/browse` / `POST /api/files/pick-folder` | Server-side listing / native OS folder dialog |
| `POST /api/files/scan` | Re-read the folder |
| `GET /api/files/file` / `PUT /api/files/file` | Read or write one text file |
| `POST /api/files/generate-changes` | Ask the model for reviewable file proposals |
| `POST /api/files/apply` | Write the accepted proposals (one undoable changeset), tidy the written files with the project's own formatter (`format: false` skips that step), and weigh the batch against the undo copies and the folder (`weight`) |
| `POST /api/files/undo` / `GET /api/files/backups` | Restore a changeset / list the copies |

#### 12. Verification
| Route | Purpose |
| :--- | :--- |
| `GET /api/files/checks` | Which checks this folder actually has |
| `POST /api/files/verify` | Run the chosen checks (`ids`, optional `customCommand`, `changesetId`) → `VerificationReport` with a `delta` verdict, plus the measured build output (`build`) when the folder's own build ran |
| `POST /api/files/fix-checks` | Ask the model to repair exactly what the last report failed |
| `GET /api/files/weight/budget` / `POST /api/files/weight/budget` | Read or set the project's ceiling for its build output, judged against the last measurement |

```json
{
  "ranAt": "2026-10-15T18:20:00.000Z",
  "ok": false,
  "passed": 2,
  "failed": 1,
  "skipped": 0,
  "durationMs": 41230,
  "problems": [
    {
      "file": "src/math.js",
      "line": 2,
      "severity": "error",
      "message": "the BROKEN marker is still there.",
      "change": "new"
    }
  ],
  "results": [ { "id": "test:test", "kind": "test", "status": "failed", "exitCode": 1, "output": "…" } ],
  "delta": {
    "compared": true,
    "baselineRanAt": "2026-10-15T18:18:04.000Z",
    "baselineChangesetId": "2026-10-15T18-19-30-123Z-ab12cd",
    "regressedChecks": [ { "id": "test:test", "labelRu": "Тесты", "labelEn": "Tests", "from": "passed", "to": "failed" } ],
    "recoveredChecks": [],
    "newProblems": [ { "checkId": "test:test", "file": "src/math.js", "line": 2, "severity": "error", "message": "the BROKEN marker is still there." } ],
    "fixedProblems": [],
    "persistentProblems": []
  }
}
```

`delta.compared` is `false` on the first run in a folder (and whenever the previous run verified nothing), which is the honest answer: there is nothing to compare with, so nothing can be called new.

#### 13. Git (local only)
| Route | Purpose |
| :--- | :--- |
| `GET /api/files/git/status` | Repository, branch, changed files, `identityMissing`, `sensitive` flags |
| `GET /api/files/git/diff?file=…` | One file's diff (worktree, staged, or synthesised for a new file) |
| `POST /api/files/git/commit` | Save the selected files as one local commit |
| `GET /api/files/git/branches` | The current branch and what it tracks, as last known on this computer (nothing is fetched) |
| `POST /api/files/git/branches` | Start a branch for a piece of work exactly where the current branch points |
| `GET /api/files/git/branch-diff?base=…` | What this branch added compared with `base`: folder-scoped files, line counts, patch |

```json
// GET /api/files/git/status
{
  "available": true,
  "isRepo": true,
  "branch": "master",
  "clean": false,
  "files": [
    { "path": ".env", "state": "untracked", "code": "??", "staged": false, "untracked": true, "sensitive": true },
    { "path": "app.js", "state": "modified", "code": " M", "staged": false, "untracked": false, "sensitive": false }
  ],
  "identityMissing": false,
  "message": null
}
```

```json
// POST /api/files/git/commit   { "files": ["app.js"], "message": "Обновить: app.js" }
{
  "hash": "09e0467",
  "subject": "Обновить: app.js",
  "committed": ["app.js"],
  "remaining": [".env", "extra.txt"]
}
```

#### 14. History
| Route | Purpose |
| :--- | :--- |
| `GET /api/files/checkpoints` | Named moments in the timeline |
| `POST /api/files/checkpoints` | Mark the current moment |
| `DELETE /api/files/checkpoints/:id` | Remove a marker |
| `POST /api/files/rollback` | Return the folder to a checkpoint |

#### 15. Preview
| Route | Purpose |
| :--- | :--- |
| `GET /api/preview/status` | What the folder can be started from, plus the loopback origin info |
| `POST /api/preview/build` | Build the chosen entry → `{ url, origin, port, isolation, liveReload, mode: "origin" }`, or the inline document when the origin cannot start |

#### 16. Desktop Window Controls (desktop build only)
- `POST /api/focus` — raise the existing window.
- `POST /api/quit` — close the app.

#### 17. Auto-Code (autonomous loop and pipeline, localhost only)
| Route | Purpose |
| :--- | :--- |
| `POST /api/autonomous/start` | Run one task to its verdict: proposal → validated write → formatter → checks → bounded repair (max 4 attempts). Returns `{ started, runId, maxAttempts }`. Refuses `409` while a run is in flight |
| `POST /api/autonomous/pipeline` | Run a queue of plan tasks back to back. Each task's body: `id`, `title`, `goal?`, `acceptanceCriteria[]?`, `targetFiles[]?`, `dependencies[]?`. Returns `{ started, runId, queued }` |
| `GET /api/autonomous/stream?runId=…` | SSE for a run or a pipeline: replay first, then the tail; typed events (see 4.18) and `stream_end` when done |
| `GET /api/autonomous/status` | Is a run active, and the attempt cap |
| `GET /api/autonomous/pipeline/:runId` | The recorded result: per-task attempts and verdicts, `stoppedBecause` (`queue_empty` / `task_failed` / `no_workspace` / `no_ai_key`) |

---

## 6. Data Models and TypeScript Definitions

The core domain model is declared in `/src/types/index.ts`; the request/response shapes of the file layer live next to the client that calls them in `src/services/api.ts` and are mirrored by the server services.

### 6.1 Entity Relationship Overview
- **`ProjectState`**: The aggregate root representing a project instance.
  - Contains one `ProjectBrief` (functional specification and boundaries).
  - Contains one `ArchitectureProposal` (technology stack, data flow, folder structure).
  - Contains one `ProjectMap` (virtual filesystem representing project files).
  - Contains an array of `ProjectPhase` instances.
    - Each `ProjectPhase` contains an array of `ProjectTask` items.
      - Each `ProjectTask` maintains discrete `AcceptanceCriterion` records, task status, complexity, and a `ReviewAttempt` audit log.
- **Workspace side:** one `WorkspaceState` (root + scanned files + backups + timeline + checkpoints), `VerificationReport` (checks and problems), `GitStatus` / `GitDiff` / `GitCommit` (version saving).

### 6.2 Key Type Declarations

```typescript
export type ProjectType =
  | 'Unity'
  | 'Phaser.js'
  | 'Godot'
  | 'Three.js'
  | 'Unreal Engine'
  | 'PlayCanvas'
  | 'PixiJS'
  | 'React'
  | 'Next.js'
  | 'Node.js'
  | 'Python'
  | 'Flutter'
  | 'Generic';

export type AgentType =
  | 'Cursor'
  | 'Claude Code'
  | 'Windsurf'
  | 'GitHub Copilot'
  | 'Cline'
  | 'Roo Code'
  | 'Replit'
  | 'Lovable'
  | 'Bolt'
  | 'ChatGPT / API';

export type TechnicalLevel = 'Beginner / Non-coder' | 'Vibe-coder' | 'Intermediate' | 'Advanced';
export type ContextMode = 'Minimal' | 'Balanced' | 'Full';
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'review' | 'partial' | 'blocked' | 'completed';

export interface ProjectTask {
  id: string;
  phaseId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  relevantFiles: string[];
  forbiddenFiles?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  testRequirements: string[];
  estimatedComplexity: 'Small (1 prompt)' | 'Medium (2-3 prompts)' | 'Large (Needs splitting)';
  dependencies: string[];
  progressPercent: number;
  reviewHistory?: ReviewAttempt[];
}

export interface ProjectState {
  id: string;
  name: string;
  projectType: ProjectType;
  engineOrFramework: string;
  language: string;
  selectedAgent: AgentType;
  technicalLevel: TechnicalLevel;
  brief?: ProjectBrief;
  architecture?: ArchitectureProposal;
  phases: ProjectPhase[];
  projectMap: ProjectMap;
  activeTaskId?: string;
  recentErrors: ErrorDiagnosis[];
  nextBestAction: string;
  rulesFilesContent: { agentsMd: string; claudeMd: string; cursorRules: string };
}

/** Verification: what the folder's own commands answered. */
export type CheckKind = 'typecheck' | 'lint' | 'test' | 'build' | 'custom';
export type CheckStatus = 'passed' | 'failed' | 'timeout' | 'unavailable' | 'skipped';

/** Version saving: what Git says about the folder. */
export type GitFileState =
  | 'untracked' | 'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted' | 'typechange';

export interface GitFileStatus {
  path: string;          // relative to the connected folder, forward slashes
  state: GitFileState;
  code: string;          // the raw porcelain code ("M ", " M", "??")
  staged: boolean;
  untracked: boolean;
  sensitive: boolean;    // listed, but its contents are never printed
}
```

---

## 7. State Management and Data Persistence

### 7.1 State Layer (`ProjectContext.tsx`, `LanguageContext.tsx`)
State management is centralized via React Context (`ProjectProvider` / `useProject`, `LanguageProvider` / `useLanguage`), providing global reactivity across all routed views without prop drilling, and one switch for the whole interface language.

### 7.2 Persistence Model
Three separate places, with three different owners:

| What | Where | Owner |
| :--- | :--- | :--- |
| Projects, plans, reviews, project map | browser `localStorage` (`easy_project_compiler_projects`, `easy_project_compiler_current_project`) | the app |
| The studio's arrangement | browser `localStorage` (`easy_project_compiler_studio`: preset, each slot's window, dragged ratios) | the app |
| The extra columns, the folded sidebar and the language | browser `localStorage` (`easy_project_compiler_workspace`, `easy_project_compiler_sidebar_folded`, `easy_project_compiler_lang`) | the app |
| Provider keys, connected folder, undo copies (with the check result, the tidy-up and the weight of each write), checkpoints, last check run, last measurement per folder and the build budget | `data/` next to the app (`api-keys.json`, `workspace.json`, `workspace-backups/…`, `checkpoints.json`, `verification.json`, `weight.json`, `budget.json`) | the app, on this machine only |
| The project itself | the folder the user connected, on the user's disk | the user (and their Git) |

- **Sync Mechanism:** Changes to project state synchronize with `localStorage` through React `useEffect` hooks; file-layer state is re-read from the server, which is the single source of truth for the folder.
- **File Ingestion:** when agent output containing source code is accepted or repaired via the Error Coach, updated file contents are injected into `currentProject.projectMap.files`.
- **Never inside the folder:** undo copies, manifests and checkpoints are kept in `data/`, never written into the user's project.

---

## 8. Build, Execution, and Deployment Workflow

### 8.1 Scripts (`package.json`)
| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `tsx server.ts` | Server + API + front end through Vite middleware on port 3000 |
| `npm run build` | `vite build` + `esbuild server.ts …` | Front end into `dist/`, server bundled into `dist/server.cjs` |
| `npm start` | `node dist/server.cjs` | Serve the built app (API + static files) |
| `npm run lint` | `tsc --noEmit` | Type check the whole project |
| `npm run test` | `vitest run` | Unit and component tests (jsdom + Testing Library) |
| `npm run test:e2e` | `node tools/exe/e2e-verify.mjs` | End-to-end check of the packaged build |
| `npm run eval` | `tsx tools/eval/cli.ts` | Measure the prompt context: six fixtures, `legacy` vs `graph`, recall / `pass@1` / size (`--live`, `--fast`, `--json`) |
| `npm run desktop` | `node tools/desktop/run-desktop.mjs` | Build the web app and open the desktop window from this checkout |
| `npm run build:desktop` | `node tools/desktop/build-desktop.mjs` | Pack the portable `.exe` plus tester instructions |
| `npm run test:desktop` | `node tools/desktop/verify-desktop.mjs` | Start the packed `.exe` and verify window, storage, API and handover |
| `npm run release` | `node tools/release/publish-release.mjs` | Hash the built `.exe`, write `version.json` and publish both as a GitHub release (the app's update feed) |
| `npm run shots` | `node tools/screens/capture-screens.mjs` | Walk every screen in a hidden window and write one PNG per screen plus a contact sheet and a text digest into `build/screenshots/` |
| `npm run build:exe` | `node tools/exe/build-sea.mjs` | Older single-executable build (serves the browser on port 4123) |
| `npm run icons` | `node tools/assets/make-icons.mjs` | Regenerate the app and `.exe` icons |
| `npm run preview` | `node dist/server.cjs` | Serve the built app, same as `npm start` |
| `npm run clean` | `rm -rf dist server.js` | Remove build output |

### 8.2 Environment Configuration
Keys may be supplied through the environment (`.env` / `.env.local`) or pasted into the app (sidebar → «Ключи API»); UI keys take precedence.

| Variable | Meaning |
| :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini (via `@google/genai`), starts with `AIza` |
| `OPENAI_API_KEY` | OpenAI-compatible endpoint, starts with `sk-` |
| `ANTHROPIC_API_KEY` | Anthropic, starts with `sk-ant-` |
| `NVIDIA_API_KEY` | NVIDIA NIM, OpenAI-compatible host, starts with `nvapi-` |
| `OPENROUTER_API_KEY` | OpenRouter, OpenAI-compatible gateway, starts with `sk-or-` |
| `GROQ_API_KEY` | Groq, OpenAI-compatible host, starts with `gsk_` |
| `AI_REQUEST_TIMEOUT_MS` | Time budget for one model before the next candidate is tried |
| `AI_TOTAL_BUDGET_MS` | Time budget shared by every candidate of a provider |
| `AI_MAX_OUTPUT_TOKENS` | The answer ceiling asked of every provider (default 16 000 tokens); a provider that refuses it is asked again without it |
| `PORT` | Overrides the HTTP port (development default 3000, packaged 4123) |
| `EPC_WORKSPACE_FILE` / `EPC_WORKSPACE_BACKUP_DIR` | Redirect the store and the undo copies (used by the tests so they never touch real data) |

### 8.3 Looking at the Screens (`tools/screens/`)

A test can prove that a control exists; it cannot show what a screen looks like, and several of the
rules the interface follows are visual — a screen opens with its work rather than with a title, the
sidebar footer draws no box, a toolbar is a row and not a card. `npm run shots` exists for that:
`capture-screens.mjs` finds the app (or starts `npm run dev`), `capture-main.cjs` drives an Electron
window through every screen with a seeded demo project (wizard and API keys panel included), and one
PNG per screen lands in `build/screenshots/`. An offscreen window is used so nothing flashes over
the desktop; should a system hand back an empty frame, the tool notices and takes the pictures from a
visible window instead.

Two ways of reading the result go with the pictures. `build/screenshots/index.html` is a contact
sheet — every screen on one page, meant for the preview panel or a browser. `build/screenshots/digest/*.txt`
is the same run written as text: the active screen's blocks with their size, position, background,
border and first words, the modal drawn over it (the wizard, the API keys panel) and the sidebar
footer. A person looks at the sheet; an agent checks the digest. `EPC_SHOT_OUTLINE=1 npm run shots`
adds `build/screenshots/outline/*.txt`: the whole tree of every screen and modal, each box with its
padding, corner radius, border, background, type size and words — what a review needs to see that two
cards use different numbers, or that a label repeats the heading under it.

Two details keep the tool from getting in the way. It starts its own app on port 3913 and stops it
again (tree and all) when the run is over, because the demo project has to be written into the
browser storage of some origin and doing that on the developer's own port would replace their saved
projects with the demo one; `EPC_SHOT_URL` overrides the address when a specific app is wanted. And
the window is offscreen, so taking pictures never throws a window over what the person is doing.

The wizard and the API keys panel are photographed as screens of their own: the dialog is closed
after its picture and the run waits until it has really disappeared, because the close button is
looked for inside the overlay that covers the window (an open dialog is recognised by computed
`position: fixed` and by covering the window, not by a class name — the sidebar and the floating
controls are `fixed` too). A dialog left open, or one found over a screen that should have none, is
reported as a failed screen instead of being silently photographed eleven times.

### 8.4 The Surface Rules

The screens follow four rules, and a review of the twelve frames is what keeps them true:

- **A card is one surface.** Sections inside a card are told apart by a quieter background
  (`bg-slate-950/60`), a divider or spacing — not by another frame. A box inside a bordered box
  inside a bordered box reads as a diagram, not as a workspace.
- **Colour is not a border.** Status and type labels are tinted chips (`bg-emerald-500/10`), not a
  tint plus a hairline; an icon never gets a frame of its own. Equal tags in every panel: same
  height, same radius, no halo.
- **Fields keep their frame; decoration does not.** Inputs, selects, segmented switches and buttons
  are things you press, so they may show an edge. Headings, rows and labels are not.
- **An indicator is not a control.** A mark that only says "working" — the AI mosaic, a progress
  light — is never put in a plate, ring or rounded square: a frame around it claims it can be
  pressed, and a square inside a square is the decoration the mark exists to replace. The same rule
  applies to status lights in the sidebar and the title bar.
- **A label that repeats the heading below it is deleted.** "Результат компиляции" over
  "Скомпилированный промпт", "Обзор проекта" over the project's name, "Проект из папки" as a card
  title over a switch that says "Проект из папки" — each cost a line and said nothing.

One radius for panels (16px), a smaller one for things inside them (8–12px), one accent (indigo)
with emerald/amber/rose reserved for state, and the same paddings (16/20/24) across screens.

### 8.5 Testing
`vitest run` executes the suite in `src/tests` (jsdom + Testing Library): 116 files and 962 tests at the time of writing. It covers, among others: the workspace store and file service against a real temporary folder, the check runner and its output parser, the preview builder and its loopback origin, the Git service against a real temporary repository, the Git panel as a component, working modes and levels, both languages of the interface, the words the screens use (`interfaceWords.test.tsx`), the look of the shared button (`buttonStyles.test.ts`: no shadow, only `danger` filled, one height grid), the toast's motion and markup (`toast.test.tsx`), the AI status card and its unframed mark (`aiActivity.test.tsx`), the studio's tools mounted in the title bar (`studioToolbar.test.tsx`) and the title bar's add-a-column plus (`windowChrome.test.tsx`).

The live compile has its own set, because it is the part of the loop that cannot be tested by reading the code: `compileStream.test.ts` (the frame grammar, the step marks, the route's frames, and the responder going quiet when the reader leaves), `aiRouter.test.ts` (a chunked SSE answer parsed and aborted by the timeout; an already-aborted signal starts no request, and a cancel mid-answer does not walk on to the next model), `simpleFlow.test.tsx` and `compilerRun.test.tsx` (the terminal on both screens: the request's facts, the model's own text while the result frame is held open, the stop button aborting the fetch and leaving `Отменено` with `Повторить`, and the answer kept on step 4), and `reviewAbort.test.ts` (a disconnected review aborts its provider call). The server-presence path is pinned by `serverPresence.test.ts`, `serverStatus.test.tsx`, `apiFailure.test.ts` and `filesUnreachable.test.tsx`; the compiler's rules block by `compilerRulesCheck.test.tsx` and `compilerRun.test.tsx`. The folder's own repair and its announcement are pinned by `projectFolder.test.tsx` (the four cases: same folder, empty server, a switched project, a foreign folder), `folderGate.test.tsx` (a request held until the reconnect lands, a failed restore that does not wedge the gate), `folderFeed.test.ts` (a change is counted and delivered, a throwing listener cannot fail the bind, a refused bind announces nothing) and `folderRefresh.test.tsx` (Git, the checks window and the preview re-read). Tests that need a folder or a repository create their own temporary ones and redirect the store with `EPC_WORKSPACE_FILE`, so a test run never touches the developer's own `data/`.

The context plan is pinned by `codeGraph.test.ts` (the import syntaxes, `./x.js` → `./x.ts`, a bare package that must not resolve, a cycle, budget order, an unborn seed, mentions on word boundaries, determinism), `contextPlan.test.ts` (the imported type reaches the plan, an importer outranks a test, a mention, a budget crop, the seed-led path list, a path outside the folder refused) and `autopilotContext.test.ts` (the loop's real prompt against a real folder). It also has a measuring stick of its own: `npm run eval` (`tools/eval/`) runs six fixture projects through the frozen old selection (`legacy`) and the import-graph plan (`graph`) with the same prompt, the same answerer and the same scorer, and reports recall, `pass@1`, files and characters per strategy. The fixtures are built around one failure — the task names one file and the answer needs a second — and the default answerer is an offline stand-in that can only edit what the prompt showed, so its 0/6 → 6/6 is a statement about the mechanism, not about a model. `--live` swaps in the configured provider for that. The harness's own tests (`evalHarness.test.ts`) keep it honest: every fixture compiles before the task, its reference patch passes its checks, and a run leaves the developer's workspace and environment untouched.

---

## 9. Architectural Analysis, Resilience, and Future Scalability

### 9.1 Resilience
- **No key, no problem:** every intelligence endpoint falls back to the local deterministic compiler, and the checks, the preview, the file layer and Git never needed a key in the first place.
- **No network, no problem:** checks run local commands only; Git is local only; the preview serves the folder from loopback.
- **Bounded everything:** AI calls (per model and in total), the answer ceiling asked of each provider, checks (per kind), Git commands and preview builds all have time and size limits, and a stopped process takes its children with it — including the checks still running when the app itself closes.
- **A cut-off answer is a known event, not a mystery:** the provider's finish reason is read, so "the model ran out of room" is never confused with "the model answered badly", and the finished part of such an answer is kept rather than discarded with it.
- **Contracts at the edges:** controllers validate input and answer with a stable envelope, so a malformed model response cannot reach a component as a crash.
- **Review before write, undo after:** proposals are text until accepted, and every accepted write is one click from being reverted.
- **Honest states:** "Git is not installed", "this folder is not a repository", "checks unavailable" and "no key configured" are shown as what they are, with the command or the screen that fixes them, instead of silently doing nothing.
- **A page without the app's own server says so (`src/services/serverPresence.ts`, `serverUnreachable.ts`, `apiFailure.ts`, `uiLanguage.ts`).** The interface can be opened from a bare Vite or static server, where every `/api/*` is answered with the app's own HTML — which reads as `Server error: Not Found` and sends the user looking in the wrong place. `/api/health` is asked once when the window opens (a failure is not retried: a server that is not there will not start by itself), and the title bar keeps a warning until the window is reloaded. The API layer writes its own sentence for a missing answer, in the language stored by `uiLanguage` rather than the React context the API layer cannot read, and the sandbox gets a preview-specific version of it; a real answer from the server keeps the server's own message, because that one knows what went wrong in the folder.
- **Honest numbers:** every measurement says what it measured and what it could not — "nothing to compare with yet", "including changes that were not made here", "at least this much", and no percentage when the size it would divide by is a few dozen bytes.
- **The engine is named.** A compiled prompt and a verdict carry `engine` on the response envelope, and the screen prints "без ИИ" when it is `local` — the offline path answers exactly when the provider is slow or out of key, so it must not arrive looking like a model's answer.
- **The offline prompt is built from facts, not boilerplate.** Its acceptance criteria name the task and the files the prompt really targets, its `tests` are the verification scripts the folder's own `package.json` declares (`npm run build`, `npm run test`, …) or one honest manual check, and its confidence falls when the folder tells it less (`server/utils/localAcceptance.ts`).
- **The next step is computed, not remembered.** The dashboard's recommendation is derived from the plan on every render (`src/utils/nextAction.ts`): a task waiting for a verdict opens the review, a task in progress or half-done compiles its continuation prompt, the first task whose dependencies are finished becomes the starting point, and a plan that is fully done offers the plan instead of a prompt. The stored `nextBestAction` is only the fallback while there is no plan to read, so a sentence written days ago can no longer send a beginner to `npm test` inside a Unity project.
- **The test demand follows the project.** With a test script the prompt still asks for a test on the changed logic and the command that runs it; with no runner it says so and forbids adding one for the task, because the app is the thing that runs the folder's checks — the vibecoder is not asked to stand up test infrastructure nobody chose.

### 9.2 Data Persistence Scalability
- **Current Limitation:** projects live in browser `localStorage`. Large projects with extensive file registries and review histories may approach the ~5MB quota limit.
- **Recommended Evolution:** provision a durable database with user accounts to support multi-device synchronization and persistent collaboration; the folder itself is already durable, since it is the user's own project.

### 9.3 Roadmap: measuring the work, not just doing it
The verification loop answers "does the project still pass its own checks?", and since the delta work it also answers "did *this change* break anything that used to pass?". The four items that section used to list are closed:

1. **Branch awareness — done.** The Git panel shows the branch and what it tracks ("compared with `origin/main` as last known on this computer — nothing is fetched"), including how many commits this branch has that the upstream does not, and the other way round. The user can start a branch for a piece of work with one button (`POST /api/files/git/branches`): it starts exactly where the current branch points, so no saved version can be lost, and it reports how many uncommitted files came along. `GET /api/files/git/branch-diff?base=<branch>` answers "what did this branch add?" with a folder-scoped file list, line counts and the patch. Still no switch, merge or delete, and still no remote — by design.
2. **A lint that fixes itself — done.** Passed runs are parsed too, so a linter that exits 0 while printing a warning no longer has its findings thrown away; the verdict calls them *findings* rather than errors, and the panel offers "AI: clear the findings this change added" — the same repair path a failed test uses, scoped to the new findings only. The npm chatter that echoes the command being run is filtered out so a finding is never counted twice.
3. **A budget instead of a report — done.** A project can write down one ceiling for its build output ("500 KB"; `POST /api/files/weight/budget`, stored in `data/budget.json`, one number per folder). Writing it judges the last measured build immediately, every later run reports the verdict next to the size, and a build over the ceiling is handed to the model as a task of its own instead of being dismissed as "nothing to fix".
4. **Where the weight came from — done.** The bundle the app builds for the sandbox is now accounted for module by module from esbuild's own metafile: `composition` names the heaviest packages and the folder's own files, each with bytes and its share of the output, and lists the imports that are answered from a CDN instead of being bundled. The preview screen draws it as bars, so "1.4 MB" arrives with the name of the thing that made it 1.4 MB.

What is left, honestly:

1. **The folder's own build output still has a size but no attribution.** The module-by-module answer describes the bundle the app builds itself; a `dist/` produced by the project's own build script is measured as a total, because reading its composition would mean running the project's bundler (and installing it) — something this app refuses to do.
2. **The budget judges, it does not refuse.** A heavy batch is still written, then measured, then handed back as a repair task. Refusing a write before it happens would need the number to be known before the write, which only a build can produce.
3. **Branches stop at creation.** Comparing, creating and reading them is all the app does; switching and merging stay in the user's own terminal.

#### Delivered so far
- **Run the real folder** in a sandbox served from its own loopback origin (animations, workers, WASM, byte ranges intact).
- **Run the folder's own checks** (type check, lint, tests, build) with time limits, no installs and no network, and repair exactly what failed.
- **A regression verdict**: which checks that used to pass do not pass now, which problems are new, and which are gone — with the repair request scoped to what the change broke, and a "only new" filter on the screen.
- **Tidying up after a write** with the project's own Prettier, Biome or Ruff: only the files that were just written, recorded on the changeset, and never a reason for a write to fail.
- **Weighing the change**: the exact bytes of the batch, the size of the project compared with the last write, and the size of the build output compared with the last build — each number saying what it can and cannot prove.
- **A weight budget**: one ceiling per project, judged after the project's own build, with the overrun offered back to the model as a task.
- **Where the weight came from**: the preview bundle accounted for module by module from the bundler's own metafile — heaviest packages first, CDN imports listed apart.
- **Version saving with the user's own Git**: status, per-file diff, and a path-limited local commit. No push, pull or fetch exists in the app.
- **Branches**: what the current branch tracks and how far it has drifted, one button to start a branch for a piece of work, and a comparison of what one branch added that another does not have.
- **A context plan instead of "the files the task named"**: both prompts read the folder's import graph and spend the budget in a stated order — seeds, what they import, what imports them, their tests, then neighbours that name the same symbol — so a forgotten type file still reaches the model.
- **A measuring stick for that change**: `npm run eval` runs six fixture projects through the frozen old selection and the graph with one prompt, one answerer and one scorer, and reports recall, `pass@1`, files and characters per strategy. The offline stand-in can only edit what it saw, so its perfect recall is a statement about the mechanism; the honest reading of a live run is that six cases cannot prove a pass-rate difference.

---

## 10. Prompting Research and the Per-Agent Guides (`docs/`)

The compiler writes a prompt *for a named tool*, so the app has to know what that tool reads and how it
wants to be addressed. That knowledge is not folklore here: it was read out of each vendor's own
documentation in October 2026 and written down twice — once as code the compiler obeys, once as prose a
person can check.

- **[src/utils/agentProfiles.ts](src/utils/agentProfiles.ts)** — the authority. Three surfaces
  (`workspace`, `chat`, `builder`), the mention syntax each tool accepts (`@path`, `@/path`, `#file:`, a
  plain path, or the chat's `Target File:` label), and the one rules file that tool actually reads out of
  the ones this app writes. `rulesFileLine` turns that into one sentence inside the compiled prompt, in
  the tool's own syntax.
- **[docs/agent-prompting.md](docs/agent-prompting.md)** — the report behind the table: the shape of a
  task all vendors ask for, the three things that genuinely differ, context budgeting, when planning is
  worth it (and when it is not), the failure modes with the vendors' own wording, and the `AGENTS.md`
  convention with the list of tools that read it.
- **[docs/agents/](docs/agents/README.md)** — one document per agent on the picker, plus Google's family:
  what its documentation says, a prompt ready to paste, what not to do, and the sources.
- **Tests that keep it honest:** `agentProfiles.test.ts` (the table itself, one row per picker entry),
  `agentDocs.test.ts` (every picker entry has a document, the document names the file the way the
  profile says, names the rules file, links from the index, and cites sources), `promptTexts.test.ts`
  (the surface rules inside the compiled prompt).

What the research says in one line: the vendors agree on the *shape* of a task and document no house
style, so per-agent differences are limited to what a tool can actually do with the text — which is
exactly the three surfaces in the profile table.
