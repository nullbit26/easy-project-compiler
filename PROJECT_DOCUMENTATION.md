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
- **Precision Prompt Compilation:** Automatically compiles context-bounded prompts with targeted file references, strict acceptance criteria, token estimations, and security warnings customized for specific AI agent interfaces.
- **Audited Session Review:** Evaluates AI coding agent outputs against discrete acceptance criteria, computes exact completion percentages, and synthesizes step-by-step continuation prompts for partial completions.
- **Visual Error Coaching:** Parses runtime and compilation errors into a multi-tier explanation hierarchy (Simplified, Clear, and Technical), maps visual cause chains, and generates deterministic code patches with safe repair prompts.
- **Rules File Synthesis:** Automatically generates framework-specific configuration rules (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/project.mdc`) tailored to the project stack and technical depth level.
- **A real workspace, not a screenshot of one:** the connected folder is run in a sandbox served from its own loopback origin, checked by its own commands, written to through reviewable proposals with one-click undo, and versioned with Git — locally, without a network round trip.

### 1.3 Product Principles (what the app refuses to do)

These rules are enforced in code, not just in copy:

| Principle | Where it is enforced |
| :--- | :--- |
| **One folder only** — the app can never read or write outside the folder the user connected | `server/store/workspaceStore.ts` (`resolveWorkspacePath`) |
| **Secrets stay secret** — `.env`, keys, certificates are never read out loud, never sent to a model, and never shown in a diff | `isSensitiveRelativePath`, `gitService.getGitDiff` |
| **No installs, no network for checks** — checks run the project's own scripts and local binaries only | `server/services/projectChecks.ts` |
| **Nothing is written without review** — the model returns text; the user ticks files and presses "write" | `server/services/changeProposals.ts`, `/api/files/apply` |
| **Every write is undoable** — a copy of each touched file is kept next to the app, never inside the folder | `applyFileChanges` / `undoFileChanges`, `data/workspace-backups/` |
| **The change has a weight** — every write reports what it added, what the project weighs now, and how heavy the build became, without pretending to know what it cannot measure | `server/services/changeWeight.ts` |
| **Tidying uses the project's own tool** — only a formatter that already exists inside the folder, only on the files just written, and never at the cost of the write | `server/services/codeFormatter.ts` |
| **Git is local** — there is no push, pull or fetch anywhere in the code | `server/services/gitService.ts` (no such commands exist) |
| **The app is a localhost tool** — every file route answers only to localhost callers | `server/utils/localRequest.ts` |
| **No page titles, no boxes around controls** — a screen opens with its work, not with an eyebrow, a badge and a paragraph repeating what the sidebar entry already says; toolbars (preview, plan, the step line of the loop) are rows of controls, not framed cards | every screen that used to open with such a header: `CodePreviewRunner`, `PlanKanban`, `PromptCompiler`, `SessionReview`, `SimpleFlow`, `BriefView`, `ProjectMap`, `VisualErrorCoach`; the sidebar footer (`Sidebar.tsx`, `BuildBadge.tsx`) is small print without a single pill |

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
|  |   AI Provider Router (Gemini / OpenAI / Anthropic / NVIDIA NIM)         |  |
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
| **AI Integration** | Google GenAI SDK (`@google/genai`) plus OpenAI-compatible HTTP for OpenAI and NVIDIA NIM |
| **Local tooling invoked by the app** | the user's own `npm`/`bun`/`pnpm`/`yarn`, `tsc`, `eslint`, `vitest`, `jest`, `pytest`, and `git` |
| **Desktop shell** | Electron 44 (`electron/main.ts`, `electron-builder` for the portable build) |
| **Development & Build** | Vite 6, Vitest 4 (jsdom + Testing Library), TypeScript Compiler (`tsc`) |
| **Localisation** | Russian / English dictionaries in `src/i18n/translations.ts` behind `LanguageContext` |

### 2.2 AI Provider Layer (multi-provider cascade + deterministic fallback)
To ensure system availability regardless of network status, API key configuration, or upstream quota limits, all intelligence endpoints implement a two-stage execution model (`server/ai/aiProvider.ts`):

1. **Primary Stage (provider cascade):**
   - Tries every provider that has a key, starting with the provider the user configured most recently (`getActiveProvider()` in `server/store/apiKeyStore.ts`).
   - Gemini goes through `@google/genai` with structured JSON schema outputs and a model sequence (`gemini-3.8-flash` &rarr; `3.6-flash` &rarr; `3.5-flash-lite`); OpenAI and NVIDIA NIM are called through their OpenAI-compatible chat endpoints, each with its own ordered model list.
   - A dead or retired model does not abort the chain: the next candidate, then the next provider, is tried.
   - Every answer passes a multi-stage resilient parser (`resilientJsonParse`) that handles raw payloads, markdown code fences, stray text, and trailing commas.
   - **The answer has a stated ceiling, and running out of room is a known event.** Every request asks for one explicitly (`AI_MAX_OUTPUT_TOKENS`, 16 000 — left out, the ceiling is whatever the host defaults to, which is how a change set that carries whole files used to arrive cut in half), and the provider's own finish reason is read in all three dialects (`finish_reason: length`, `stop_reason: max_tokens`, `finishReason: MAX_TOKENS`). A host that refuses the field is asked again once without it, and Anthropic falls back from the large ceiling to the known-good 8 000 — a missing ceiling costs less than a missing provider.
   - **A cut-off answer keeps its finished part.** When the provider itself says the answer hit the output limit, the unfinished tail is dropped and the open containers are closed (`server/ai/jsonRepair.ts` → `repairTruncatedJson`), so the files that *did* arrive whole are used instead of being thrown away with the one still being written. Nothing is invented: no field is guessed, no number whose last digit is also the last character of the answer is completed (a cut `45` may have been `4500`), and nothing that was cut before its first complete value survives. The repair is applied *only* when the provider reported the cut — an answer the model considered finished and that does not parse is a different problem, and returning part of it would hand a caller something that looks whole.
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

---

## 3. Codebase Structure and Module Responsibilities

```
/
├── server.ts                       # Express bootstrap, Vite middleware, health/focus routes
├── electron/                       # Desktop shell (window without a native frame, preload bridge)
├── server/                         # Server-side modules
│   ├── ai/
│   │   ├── aiProvider.ts           # Provider router: Gemini / OpenAI / Anthropic / NVIDIA + fallback
│   │   └── geminiProvider.ts       # Gemini client, resilient JSON parser
│   ├── controllers/
│   │   ├── error.controller.ts     # Error diagnosis and code patch generation
│   │   ├── files.controller.ts     # Workspace, reading/writing, backups, checks, checkpoints
│   │   ├── git.controller.ts       # Git status, one file's diff, local commit (localized messages)
│   │   ├── preview.controller.ts   # Preview status and the build the sandbox embeds
│   │   ├── project.controller.ts   # Question generation, idea decomposition, plan adaptation
│   │   ├── prompt.controller.ts    # Agent-targeted prompt compilation
│   │   └── session.controller.ts   # Output evaluation and continuation prompt synthesis
│   ├── routes/
│   │   ├── error.routes.ts         # /api/error/diagnose
│   │   ├── files.routes.ts         # /api/files/… (workspace, files, checks, git, checkpoints)
│   │   ├── preview.routes.ts       # /api/preview/status, /build
│   │   ├── project.routes.ts       # /api/project/…
│   │   ├── prompt.routes.ts        # /api/prompt/compile
│   │   ├── session.routes.ts       # /api/session/review
│   │   └── settings.routes.ts      # /api/settings/api-keys (list, save, delete, test)
│   ├── services/
│   │   ├── changeProposals.ts      # Turns a task into reviewable file proposals via the model
│   │   ├── folderPicker.ts         # Native folder dialog (Windows/macOS), with a browser fallback
│   │   ├── gitService.ts           # Git status, diff and a path-limited local commit
│   │   ├── previewBuilder.ts       # Builds the folder into something runnable (site or bundle)
│   │   ├── previewServer.ts        # Loopback origin that serves the folder to the sandbox
│   │   ├── projectChecks.ts        # Discovers and runs the project's own type/lint/test/build
│   │   └── workspaceFiles.ts       # Scan, read, write, backups, checkpoints, rollback
│   ├── store/
│   │   ├── apiKeyStore.ts          # Provider keys in data/api-keys.json + preferred provider
│   │   └── workspaceStore.ts       # The single connected folder + path/secret guards
│   └── utils/
│       ├── apiResponse.ts          # Unified JSON envelope response handlers
│       ├── checkOutputParser.ts    # Turns raw tool output into structured problems (file, line, severity)
│       ├── ideaAnalyzer.ts         # Local semantic analyser used by the fallback engine
│       ├── levelGuidance.ts        # Explanations and next steps per technical level
│       ├── localRequest.ts         # Allows file routes from localhost only
│       ├── offlineFirstSteps.ts    # Useful first steps when no model is configured
│       ├── workspaceCode.ts        # Reads the code the AI needs as context
│       └── workspaceDigest.ts      # Compact, token-bounded description of the folder
├── src/                            # Frontend source code
│   ├── App.tsx                     # Top-level application shell and route registry
│   ├── main.tsx                    # React DOM root entry point
│   ├── index.css                   # Global Tailwind CSS imports
│   ├── components/
│   │   ├── AiActivityIndicator.tsx # "The model is working" indicator
│   │   ├── ApiSettingsPanel.tsx    # API key status, saving, testing
│   │   ├── BriefView.tsx           # Product brief and architecture specification view
│   │   ├── BuildBadge.tsx          # Build id shown in the sidebar
│   │   ├── CheckpointTimeline.tsx  # Named checkpoints, changesets and rollback
│   │   ├── CodePreviewRunner.tsx   # Runs the connected folder (site, game, app) in a sandbox
│   │   ├── Dashboard.tsx           # Project overview, phase progress bars, and stats
│   │   ├── ErrorBoundary.tsx       # Catches a render crash instead of showing a blank page
│   │   ├── GitPanel.tsx            # Changed files, diffs and "save this version" (local commit)
│   │   ├── Navbar.tsx              # Top strip: way out of the guided interface and the mobile menu (no project picker)
│   │   ├── PlanCanvas.tsx          # The plan as an infinite board (pan, zoom, minimap, drag)
│   │   ├── PlanKanban.tsx          # The same plan as status columns, kept for list readers
│   │   ├── PlanTaskDialogs.tsx     # Add-task and AI plan-adaptation dialogs, shared by both views
│   │   ├── ProjectMap.tsx          # File tree and architectural entity visualizer
│   │   ├── ProjectSetup.tsx        # Wizard for new project creation (Idea & Questions / Import)
│   │   ├── ProjectWorkspace.tsx    # The folder screen: files, proposals, checks, history, Git
│   │   ├── RulesWatchdog.tsx       # Runs the rules check by itself after every written batch
│   │   ├── PromptCompiler.tsx      # Precision prompt generation interface
│   │   ├── SavedProjectsDrawer.tsx # Slide-out project management drawer
│   │   ├── SessionReview.tsx       # AI audit tool for agent outputs and continuation generation
│   │   ├── Sidebar.tsx             # Collapsible navigation drawer
│   │   ├── SimpleFlow.tsx          # Step-by-step helper for non-coders
│   │   ├── TitleBar.tsx            # App-drawn window header (minimise / maximise / close)
│   │   ├── Toast.tsx               # Non-blocking notification component
│   │   ├── VerificationPanel.tsx   # Runs the project's checks and shows what broke
│   │   └── VisualErrorCoach.tsx    # Interactive error diagnosis and code patch applicator
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
│   │   ├── rulesCheck.ts           # Reads the folder and compares the rules with it, once
│   │   └── rulesWatch.ts           # "A batch was written" — what the automatic check listens to
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces, types, and domain models
│   └── utils/
│       ├── canvasEdges.ts          # Dependency lines: what each link means now, how it is routed, and how several links merge into one input
│       ├── canvasView.ts           # Pan/zoom/fit maths, viewport culling, the lane layout, the crossfaded dot grid
│       ├── fileExtractor.ts        # Finds code blocks in pasted agent output
│       ├── fileFacts.ts            # Language/framework facts derived from file names
│       ├── fileListParser.ts       # Parses a pasted folder listing
│       ├── folderPath.ts           # Path comparison/formatting for the folder field
│       ├── planAdapt.ts            # Maps the AI's re-aligned plan JSON onto project phases
│       ├── rulesAudit.ts           # Reads the rules back against the folder: repeats, dead references, contradictions
│       ├── rulesCheckStamp.ts      # When the rules were last compared, and how that moment is printed
│       ├── rulesFiles.ts           # Where the rule files go, and the document each one gets│       ├── rulesGenerator.ts      # Generator for AGENTS.md, the CLAUDE.md pointer, the .mdc rule
│       ├── updateRules.ts          # Which version is newer, what a manifest must contain, where its file lives
│       ├── sandboxDocument.ts      # Builds the document for a single pasted snippet
│       ├── simpleDiff.ts           # Line diff used by review screens
│       ├── textLocalizer.ts        # Turns engine text into the user's language
│       └── workingMode.ts          # Guided/full interface and autonomy levels
├── tools/
│   ├── desktop/                    # build-desktop.mjs, run-desktop.mjs, verify-desktop.mjs
│   ├── exe/                        # build-sea.mjs (single executable), e2e-verify.mjs
│   └── folder-picker/              # Native dialog helper used by folderPicker.ts
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
- **AI Smart Auto-Select:**
  - `/api/project/analyze-idea` classifies input text to recommend matching engines, architecture patterns, and platforms.

### 4.2 Project Dashboard (`Dashboard.tsx`)
- Displays overall completion percentages, active task cards, phase progression timelines, and reliability guarantees.
- Provides quick-action navigation to the active task in the Prompt Compiler or Error Coach.

### 4.3 Plan Board & Dynamic Adaptation (`PlanCanvas.tsx`, `PlanKanban.tsx`)
- The plan opens as an **infinite board** (`PlanCanvas.tsx`): pan by dragging, zoom at the cursor with the wheel, a minimap that is also a control, zoom/fit buttons and keyboard shortcuts (`+`, `-`, `0`, `F`, arrows).
- **The background never jumps.** The dots are not drawn at the board's own scale — a grid in world units becomes a solid haze a couple of steps below 100% and a sparse scatter above it — and they are not switched off at some threshold either, which is what made the background snap away exactly at the zoom "fit the plan" lands on. `gridLevels` (`utils/canvasView.ts`) instead draws **two levels and crossfades them**: the level that is about to turn too dense fades out while the level twice as coarse fades in, and the two always add up to one grid. The spacings are still powers of two times `GRID_BASE`, so a coarser level sits exactly on every other dot of the finer one and nothing moves while the zoom changes; only a set of dots arrives or leaves. A line drawn at a constant *screen* width is the same mistake in another place, so link thickness, arrowheads, dashes and port dots all follow the zoom between a floor and a ceiling (`linkScale`).
- Cards are ordinary React elements inside one transformed container, so the controls *inside* a card — status dropdown, "Compile Prompt" — keep working on the board. Cards are drawn as real DOM, not painted onto a canvas.
- Four **status lanes** sit on the board as faint bands (`ready`, `active`, `blocked`, `done`), so a free canvas still says what a column says.
- **A card is drawn whole at every zoom.** An earlier version dropped the footer — the status dropdown and the "Compile Prompt" button — below 60% zoom, on the reasoning that the text is unreadable that small anyway. The reasoning was wrong about the user: fit-the-plan lands at 50–85% on a four-lane board, so the button the screen exists for disappeared exactly while the whole plan was being looked at. Below 70% the button now keeps its size and turns into an icon of it (44 world px, with the full label as its `title` and `aria-label`) instead of becoming a four-pixel smudge, and the status dropdown and the card's text stay where they are.
- Cards are placed automatically by `laneLayout` (see `utils/canvasView.ts`) on first open; a dragged position is stored on the task as `canvasPosition` and wins over the layout, so a reload does not scatter the plan. "Arrange into lanes" puts every card back — into each zone *as that zone is drawn*, because the layout is laid out from the placements the user made rather than from an empty map (a card at its lane's resting place while the zone stays where it was dragged is a button that scatters a plan; `tests/planBoard.test.tsx` 13b). The view is fitted to the zones rather than to the cards, so the bottom of every lane stays on the screen as the view lands.
- **A zone carries the cards lying on it.** A zone is picked up anywhere on it — by the handle at its top, or by any empty part of the plate, which is the largest part of it — and moving it moves the zone, not just the band: every card whose **centre** sits inside the lane's rectangle travels with it, by the same distance the zone is stored as having travelled. "Lying on the zone" is read from the card's centre rather than its whole box, so a card leaning over the edge belongs to the place most of it is in and does not change hands halfway through a gesture. The cards the board laid out follow their lane by construction, so only the ones placed by hand are written down — writing a position for a laid-out card would freeze a card the plan is still allowed to rearrange — and the zone and those cards are written as **one** project update (`onUpdateCanvasLanes(lanes, positions)`). That is not a convenience: every writer in `ProjectContext` rebuilds the plan from the copy it read, so a second call would rebuild it from a snapshot without the first change in it and silently drop it, which is what "the cards stayed behind" was. `cardsOnZone` is the rule, tested in `tests/planCanvas.test.ts` (the centre, the edge, the narrowed question), `tests/planBoard.test.tsx` 47 (the same gesture through the DOM: what is drawn while the zone is in the hand, and what is stored in one call when it lands) and `tests/laneCarry.test.tsx` (the one-write contract at the project level).
- **Dragging is the whole card, and it is followed from the window.** A press anywhere on a card that is not one of its controls starts the drag, so nobody has to hunt for a twenty-pixel header strip — which, at 40% zoom, was eight pixels tall. The move and release listeners are attached to `window` *synchronously in the `pointerdown` handler*, not in an effect on the card: an effect runs after the render that follows the press, and a fast flick can deliver its first move before that — the first moves used to be silently dropped, which is what "I had to grab it several times" was. A release writes the position once (`onUpdateTaskPositions`), a press that never moved stays a click, and the drag reads the live plan through refs so a listener registered at the start cannot keep a stale copy.
- Rendering is culled to the viewport and every card is memoized on primitives, so moving one card re-renders that card rather than a plan of twenty; the whole transform maths is pure and tested in `tests/planCanvas.test.ts` (including the grid's spacing, its crossfade and the ink it lays down from one zoom step to the next).
- **Dependency lines** (`utils/canvasEdges.ts`) draw each `task.dependencies` link and colour it by what it means *now*: emerald "ready to start" (the dependency is finished, the task is not), dashed indigo "waiting on a task", dashed amber "started before its dependency" (work is under way while the task it needs is still open), faded slate "both done". Cards carry a `waits N` or "ready to start" badge, a legend explains the four colours, and a reference that points at no task in the plan is reported above the board instead of quietly drawing nothing. The lines follow a card while it is dragged, and the toggle in the board controls hides them.
- **A link is a routed line, not a curve.** It leaves its port square on (26 world px), travels, and turns at a radius that matches the cards' own corners; the route falls back to a curve only where elbows would have to double back through the cards they connect. Each line is drawn twice — a dark, wider copy underneath and the coloured line on top — because that underlay is what keeps a 1px line readable over the dot grid and the lane it crosses. The two ends carry port dots (a line that simply stops at a border reads as clipped), the arrowhead is measured in stroke widths so it grows and shrinks with the line, and the link under the pointer gets a label chip that follows its own midpoint. Hovering a card dims every link that has nothing to do with it: a plan of twenty tasks is a thicket otherwise, and the dependency being asked about is the hardest thing in it to find.
- **Several links into one task share one input.** A task with three dependencies has one input, not three: drawn as three arrows it reads as three places to attach to, and two arrowheads side by side on one border look like a mistake. Links that arrive at the same side are merged into a **trunk** — one stem on the middle of that side, one arrowhead, in the colour of the most alarming thing the group is waiting for (blocked > waiting > ready > done) — and each member turns onto that trunk at its own step out from the card, along the side's axis, so no member puts a corner on the trunk itself. The order follows the sources, so the links never cross on their way in. Links that *leave* one card still get their own share of the side, because three dependencies drawn as one line would be counted as two. Tested in `tests/canvasEdges.test.ts` (states, side choice, ports, elbow routing, merging, and the zoom scaling of a link's width) and `tests/planBoard.test.tsx` (the same board read through the DOM: a drag from the card's body, a click that only selects, lines following a dragged card, a card's controls at every zoom, and one arrowhead into a fan-in).
- **Columns remain available** (`PlanKanban.tsx`) behind the Холст/Канбан switch in the header, for reading a plan as stages.
- **Dynamic AI Task Adaptation:** Invokes `/api/project/adapt-plan` to adapt, expand, or re-order task dependencies in response to shifting requirements or user blockers. The answer is mapped by `utils/planAdapt.ts`; the dialogs live in `PlanTaskDialogs.tsx` and are shared by both views.

### 4.4 Prompt Compiler Engine (`PromptCompiler.tsx`)
- **One action per screen.** The screen used to offer every choice twice: a Start button in the empty result box *and* one under the form, an "open the review" button in the step header *and* one next to the paste box, and an agent picker in the top bar *and* in the step card, the second being a private copy that was never saved (and could therefore disagree with the bar until the project's agent changed and reset it). Now: one Start, at the end of the form; one way into the review, next to the answer it carries; one agent — the project's own setting, and this card is the only control for it (the top bar carries the project and nothing else). The written example sentence that used to sit in the task field is a placeholder again: a project with nothing on the plan shows an empty field and says what is missing instead of compiling a prompt about somebody else's game.
- **The stage is the journey's step 3.** The header reads `Шаг 3: Промпт` — the four steps of the journey (folder, task, prompt, check) are numbered once, in `utils/journeySteps.ts`, so this screen carries the same number the step-by-step helper gives the prompt instead of restarting at 1 (see 4.15).
- **Reading order matches the work:** the task and the files the agent will see on the left, the compiled prompt on the right, and "run it in the agent and check the result" across the full width under both — it is the next thing to do with the output, not a footnote inside the result column.
- Compiles structured prompts with clear execution constraints:
  - **IDE Native Mode (Cursor, Windsurf, Claude Code, GitHub Copilot):** Incorporates `@file` syntax referencing exact project file paths.
  - **Web / Browser Mode (ChatGPT, Replit, Lovable, Bolt):** Formats prompts to request complete, self-contained standalone source files without placeholders.
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
- Keys are written to the gitignored `data/api-keys.json` and are picked up without a restart.

### 4.11 Project Workspace Screen (`ProjectWorkspace.tsx`)
The screen where a project stops being a plan and becomes a folder. It shows the connected folder and its files, opens one file for reading and editing, takes a task description, asks the model for **reviewable file proposals** (`/api/files/generate-changes`), lets the user tick which files to write, and writes them through the guarded file service. Around that core sit the verification panel, the Git panel and the history timeline.

- **Connecting a folder:** pasted path, browsing, or the OS folder dialog (`/api/files/pick-folder`, implemented in `server/services/folderPicker.ts` with a helper in `tools/folder-picker/`).
- **Context control:** the user ticks which files the AI may see; `server/utils/workspaceDigest.ts` keeps the description of the folder inside a token budget instead of mailing the whole project to the provider.
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
- **Closing the loop:** after files are written, the checks that were run before are run again automatically (`autoVerify`, on by default), and `/api/files/fix-checks` sends exactly what failed back to the model as a repair task — narrowed to the new problems and the regressed checks when a verdict exists, so a repair request does not become a rewrite of the folder's whole backlog. The repair is reviewed, applied and re-checked the same way.

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
- **Git is separate on purpose:** checkpoints and backups protect work done through the app; Git records the versions the user decides to keep. Neither replaces the other.

### 4.15 Step-by-Step Helper, Working Modes and Language (`SimpleFlow.tsx`, `workingMode.ts`, `levelGuidance.ts`, `i18n/`)
- **Step-by-step helper:** the same machinery presented one step at a time — the folder, the task, the prompt, the answer — with one action per screen.
- **Working modes:** the guided interface and the full workspace are two parts of one project state (`src/utils/workingMode.ts`), together with how much the app may do on its own (autonomy level).
  - **The helper is the default for every preset but the most technical one.** Picking a preset is the user saying how technical they are, and the answer for Beginner, Vibe-coder and Intermediate is the four steps; handing someone a ten-section workspace because they chose "Intermediate" put the screens in the way of the work. `Advanced` still opens the workspace.
  - **A preset's interface is not the user's choice.** The wizard writes the preset's interface into the project, so `interfaceModeChosen` records whether the value was picked by a person: a stored interface counts only when it was, and otherwise the preset decides. That flag is also what lets the default change reach projects saved under the old one, and what keeps a deliberate choice from being undone by an unrelated preset change.
  - **The top bar carries the project, not the settings.** The agent, the interface and the autonomy are project settings, chosen in the creation wizard and stored on the project; a row of pickers above every screen read as chrome and made the app look like a settings panel. What is left in the bar is the project selector.
  - **The helper has a door.** While the guided interface is on, the bar offers one control — `Полный экран` — that opens the full workspace and records it as the user's own choice. Without it, revealing the sections in the sidebar shows screens but never a way out of the helper.
  - **Tests:** `tests/modeParts.test.tsx` (the derivation, the defaults, the preset-write-versus-choice rule and the door) and `tests/projectMode.test.tsx` (the wizard's four cards).
- **One journey, one count (`src/utils/journeySteps.ts`).** The helper and the workspace loop teach the same four things — connect the folder, choose the task, build the prompt, check the answer — and they used to number them apart: the helper called the folder step 1 and the prompt step 3, while the compiler called that same prompt `Шаг 1: Компиляция промпта` and the review `Шаг 2`. Switching interfaces therefore restarted the count, and the same act wore two numbers. The four steps and their numbers now live in one module: the helper spells each step out on its own screen, the workspace shows the last two in depth (`Шаг 3: Промпт` on the compiler, `Шаг 4: Проверка` on the review), and both read the number from the same place — so a switch between the two interfaces carries on from where the reader was. The dictionaries hold the words (`Папка`, `Задача`, `Промпт`, `Проверка`) and no screen holds a step number of its own.
- **One word per thing.** `Шаг`/"Step" names a step of that journey and is not reused for a pass of the loop (see 4.5); the stage badge says `Текущий шаг`/"Current step", because `Этап`/"Phase" is the plan's word for a stage. The three panels inside the compiler stage carry names (`Что нужно сделать`, `Что увидит агент`, `Запустить в агенте и проверить`) instead of their own 1, 2 and 3, so no screen shows two numbering systems at once. The task card prints its state in the reader's language (`Готово`, `Частично`) and leaves the percentage to its bar, which is the only place that number appears in the card.
- **The workspace list is grouped.** Ten sections in one flat column made a dashboard, a file browser and the four steps of the AI loop look like the same kind of place; they now sit under `Начало`/`Start`, `Цикл с ИИ`/`AI loop` and `Проект`/`Project`, with the headers drawn only while the list is unfolded. The dashboard tab is called `Обзор проекта`/"Project overview" — it is an overview, and "control panel" next to an API-keys button read like settings.
- **The words on screen are pinned:** `tests/interfaceWords.test.tsx` (the attempt wording, the translated state without its repeated number, the folded first prompt, the three groups and their order, and the panel titles of the compiler stage) and `tests/journeyNumbering.test.tsx` (the one count: the four steps' numbers, both headings — `Шаг 3: Промпт`, `Шаг 4: Проверка` — the loop showing step 3 instead of restarting at 1, and the helper's first screen using the same four names).
- **Level guidance:** `server/utils/levelGuidance.ts` explains the next action per technical level, and `offlineFirstSteps.ts` supplies useful first steps when no model is configured.
- **Bilingual throughout:** Russian and English dictionaries in `src/i18n/translations.ts`; server messages are localized per request, so an error reaches the user in the language the screen is in.

### 4.16 Desktop Window and Build Identity (`electron/`, `TitleBar.tsx`, `BuildBadge.tsx`)
- The desktop build opens its own window with no native title bar: the app draws the header and the window buttons, and `electron/preload.ts` is the entire bridge (the page never receives Node, the file system or a shell).
- Everything the app remembers lives in a `data` folder next to the executable; closing the window stops the app.
- Each build carries an id (for example `261015-1430-4ed7`) shown in the sidebar and returned by `GET /api/health`, so "which version is this?" is answerable without reasoning about caches.
- The build also carries a release **version** (`1.0.0`) and the address of its release feed; `BuildBadge` shows the version and keeps the build id in its tooltip.

### 4.17 Updating the Desktop Build (`electron/updates.ts`, `updateRules.ts`, `UpdateNotice.tsx`)
- The app updates itself without an installer: it asks `<feed>/version.json` (GitHub `releases/latest/download`), compares the version, offers a «Скачать» button, and — if the offer is ignored — downloads the new `.exe` in the background (up to 20 s later) with `updateRules.ts`'s arithmetic and a SHA-256 check of the result.
- The downloaded build is put in place **after the app closes**: Windows refuses to rename the running portable `.exe` (`EBUSY`, measured), so `scheduleUpdateInstall` writes a small `.cmd` next to the download and starts it detached; the script waits for the file to be free, moves the new build over the old one, removes itself and the manifest, and restarts the app only when «Перезапустить и обновить» asked for it.
- `data` is never touched by an update: projects, keys and backups stay where they were.
- The updater is inert in a browser build, in `npm run dev`, and in a checkout with no release configured; the sidebar then shows nothing about updates.

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
| Provider keys, connected folder, undo copies (with the check result, the tidy-up and the weight of each write), checkpoints, last check run and last measurement per folder | `data/` next to the app (`api-keys.json`, `workspace.json`, `workspace-backups/…`, `checkpoints.json`, `verification.json`, `weight.json`) | the app, on this machine only |
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
| `npm run desktop` | `node tools/desktop/run-desktop.mjs` | Build the web app and open the desktop window from this checkout |
| `npm run build:desktop` | `node tools/desktop/build-desktop.mjs` | Pack the portable `.exe` plus tester instructions |
| `npm run test:desktop` | `node tools/desktop/verify-desktop.mjs` | Start the packed `.exe` and verify window, storage, API and handover |
| `npm run release` | `node tools/release/publish-release.mjs` | Hash the built `.exe`, write `version.json` and publish both as a GitHub release (the app's update feed) |
| `npm run shots` | `node tools/screens/capture-screens.mjs` | Walk every screen in a hidden window and write one PNG per screen plus a contact sheet and a text digest into `build/screenshots/` |
| `npm run build:exe` | `node tools/exe/build-sea.mjs` | Older single-executable build (serves the browser on port 4123) |
| `npm run clean` | `rm -rf dist server.js` | Remove build output |

### 8.2 Environment Configuration
Keys may be supplied through the environment (`.env` / `.env.local`) or pasted into the app (sidebar → «Ключи API»); UI keys take precedence.

| Variable | Meaning |
| :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini (via `@google/genai`), starts with `AIza` |
| `OPENAI_API_KEY` | OpenAI-compatible endpoint, starts with `sk-` |
| `ANTHROPIC_API_KEY` | Anthropic, starts with `sk-ant-` |
| `NVIDIA_API_KEY` | NVIDIA NIM, OpenAI-compatible host, starts with `nvapi-` |
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
- **A label that repeats the heading below it is deleted.** "Результат компиляции" over
  "Скомпилированный промпт", "Обзор проекта" over the project's name, "Проект из папки" as a card
  title over a switch that says "Проект из папки" — each cost a line and said nothing.

One radius for panels (16px), a smaller one for things inside them (8–12px), one accent (indigo)
with emerald/amber/rose reserved for state, and the same paddings (16/20/24) across screens.

### 8.5 Testing
`vitest run` executes the suite in `src/tests` (jsdom + Testing Library). It covers, among others: the workspace store and file service against a real temporary folder, the check runner and its output parser, the preview builder and its loopback origin, the Git service against a real temporary repository, the Git panel as a component, working modes and levels, both languages of the interface, and the words the screens use (`interfaceWords.test.tsx`). Tests that need a folder or a repository create their own temporary ones and redirect the store with `EPC_WORKSPACE_FILE`, so a test run never touches the developer's own `data/`.

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
- **Honest numbers:** every measurement says what it measured and what it could not — "nothing to compare with yet", "including changes that were not made here", "at least this much", and no percentage when the size it would divide by is a few dozen bytes.

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
