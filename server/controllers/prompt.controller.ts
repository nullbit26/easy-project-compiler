import { Request, Response } from 'express';
import { Type } from '../ai/geminiProvider';
import { callAiJson, hasAiProvider, getEngineLabel } from '../ai/aiProvider';
import { levelWork, qualityBlock } from '../utils/levelGuidance';
import {
  checkRulesAgainstFolder,
  folderFactsForRules,
  renderRulesSection,
  rulesSectionTitle,
  type RulesCheckOutcome
} from '../utils/rulesStaleness';
import { buildCompilePromptText, ensureCompiledSections } from '../utils/promptTexts';
import { hasTestRunner, localAcceptance } from '../utils/localAcceptance';
import { agentProfileFor, referenceFor, rulesFileLine, surfaceDescription } from '../../src/utils/agentProfiles';

const compilePromptSchema = {
  type: Type.OBJECT,
  properties: {
    taskTitle: { type: Type.STRING },
    confidence: { type: Type.INTEGER },
    includedFiles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          reason: { type: Type.STRING },
          tokensEstimate: { type: Type.INTEGER }
        },
        required: ["path", "reason", "tokensEstimate"]
      }
    },
    excludedFiles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["path", "reason"]
      }
    },
    missingContext: { type: Type.ARRAY, items: { type: Type.STRING } },
    architectureWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    promptText: { type: Type.STRING },
    acceptanceCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    tests: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimatedTokens: { type: Type.INTEGER },
    nextBestAction: { type: Type.STRING },
    securityWarnings: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: [
    "taskTitle", "confidence", "includedFiles", "excludedFiles", "missingContext",
    "architectureWarnings", "promptText", "acceptanceCriteria", "tests",
    "estimatedTokens", "nextBestAction", "securityWarnings"
  ]
};

export async function compilePrompt(req: Request, res: Response) {
  try {
    const { userRequest, projectMap, agent, contextMode, taskTitle, brief, language, skillLevel, rules, projectName } = req.body;
    const ai = hasAiProvider();
    const isRu = language === 'ru' || !language;

    /*
     * The agent's own profile, not a guess from its name.
     *
     * The substring check that used to live here answered one question — "does the name sound like a
     * browser chat?" — and that one bit decided everything: which output shape the prompt asked for,
     * which files could be referenced and how, and whether the agent was expected to read the project
     * itself. Cursor and Claude Code answer "no" to it and were treated as editor agents; Lovable and
     * Bolt also answer "no" and were treated as editor agents too, which they are not. The profile
     * carries the three surfaces and the tool's own mention syntax (see `agentProfiles.ts`).
     */
    const profile = agentProfileFor(agent || 'DeepSeek / Web Chat');

    const projName = projectName || projectMap?.projectName || 'Project';
    const projType = projectMap?.projectType || 'Generic';
    const framework = projectMap?.engineOrFramework || 'Standard';
    const lang = projectMap?.language || 'TypeScript';
    const briefTagline = brief?.tagline || brief?.coreProblem || '';

    /*
     * The rules of the project are read against the folder before anything is written, because the
     * compiled prompt is built on top of them: a rule that points at a file the folder no longer
     * has would send the agent to write code for a path that does not exist. The check runs once
     * and its result travels with the answer, so the screen and the prompt say the same thing.
     */
    const rulesCheck: RulesCheckOutcome | null = checkRulesAgainstFolder(rules, projName);
    const rulesSection = rulesCheck ? renderRulesSection(rulesCheck, isRu) : null;

    /*
     * The commands the finished prompt may name.
     *
     * The prompt has always been told to list the project's real verification commands and never to
     * invent one, but the facts it was given named no commands at all — so the section either came
     * back empty or carried a command the project does not have, and a command the project does not
     * have sends the agent off to build a test runner that was never there. The names come off the
     * same folder read the rules check uses; with no rules to check, the folder is read for this
     * alone.
     */
    const folderFacts = rulesCheck ? rulesCheck.facts : folderFactsForRules();
    const declaredCommands = folderFacts.scripts || null;
    const testRunner = hasTestRunner(declaredCommands);

    if (ai) {
      /*
       * The instructions sent to the compiler live in `utils/promptTexts.ts`, where they are
       * asserted rather than merely written: the sections the prompt has to contain, the ban on
       * invented facts, and the rule that the rules check is attached by this server instead of
       * being reproduced by the model (which is what used to put the same block in twice, once in
       * the model's own words).
       */
      const prompt = buildCompilePromptText({
        userRequest,
        taskTitle: taskTitle || userRequest,          agent: profile,
          contextMode: contextMode || 'Balanced',
        isRu,
        skillLevel,
        projectName: projName,
        projectType: projType,
        framework,
        language: lang,
        briefTagline,
        files: projectMap?.files || [],
        rulesSection,
        verificationCommands: declaredCommands,
        testRunner
      });
      const parsed = await callAiJson(prompt, compilePromptSchema);
      if (parsed && parsed.promptText) {
        /*
         * The six sections are a promise the screen makes when it shows a finished prompt, and the
         * model keeps it most of the time — not always. A live run came back with three of the six,
         * and nothing about that half-prompt looked wrong on screen: the criteria, the requirements
         * and the return format were simply gone, and the user was one copy away from handing an
         * agent a task with no definition of done. What is missing is filled from the same texts the
         * brief asked for, and what the model wrote is kept as it wrote it.
         */
        const completed = ensureCompiledSections({
          promptText: parsed.promptText,
          isRu,
          agent: profile,
          paths: (projectMap?.files || []).map((f: any) => f.path),
          taskTitle: taskTitle || userRequest,
          taskGoal: userRequest,
          projectName: projName,
          projectType: projType,
          framework,
          language: lang,
          criteria: Array.isArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria : [],
          verificationCommands: declaredCommands,
          fileReasons: Object.fromEntries(
            (projectMap?.files || [])
              .filter((f: any) => f?.path && f?.description)
              .map((f: any) => [f.path, f.description])
          )
        });
        if (completed.added.length) {
          console.info(`[Compiler] The answer was missing ${completed.added.length} section(s); filled: ${completed.added.join(', ')}`);
        }
        if (completed.addedReferences.length) {
          console.info(
            `[Compiler] Target files the answer did not reference as ${profile.referenceStyle}: ${completed.addedReferences.join(', ')}`
          );
        }
        parsed.promptText = completed.promptText;

        // The model was told not to reproduce the check, and this is what makes it certain: a
        // warning dropped on the way to the agent would leave it following a rule that is no longer
        // true, which is the one outcome this whole section exists to prevent.
        if (rulesSection && !parsed.promptText.includes(rulesSectionTitle(isRu))) {
          parsed.promptText = `${rulesSection}\n\n${parsed.promptText}`;
        }
        return res.json({ success: true, data: { ...parsed, rulesCheck }, engine: getEngineLabel() });
      }
    }

    // Fallback if no key or quota exceeded
    const filesList = projectMap?.files || [];
    const maxFiles = contextMode === 'Minimal' ? 1 : contextMode === 'Full' ? Math.max(filesList.length, 5) : 3;
    const estimatedTokens = contextMode === 'Minimal' ? 420 : contextMode === 'Full' ? 2400 : 950;

    const relFiles = filesList.slice(0, maxFiles).map((f: any) => ({
      path: f.path,
      reason: f.description || (isRu ? 'Ключевой файл задачи' : 'Core task reference'),
      tokensEstimate: contextMode === 'Minimal' ? 300 : 350
    }));

    let fileSection = '';
    let environmentHeader = '';

    if (profile.surface === 'chat') {
      const isDeepSeek = profile.name.toLowerCase().includes('deepseek');
      environmentHeader = `## Режим выполнения: ${profile.name}
Вы работаете как ведущий разработчик в веб-чате (${isDeepSeek ? 'DeepSeek / Веб-чат' : 'Браузерный чат / Web LLM'} без прямого доступа к файловой системе).
- Предоставьте ПОЛНЫЙ, рабочий и самодостаточный код для каждого целевого файла.
- Не используйте сокращения вида "// код остается без изменений" или "// остальной код здесь".
- Четко укажите путь к каждому файлу (например, Target File: src/App.tsx) и инструкцию, куда скопировать код.
- Все импорты, типы и экспорты должны быть полностью определены.

## Контекст проекта
- **Проект:** ${projName} (${projType} / ${framework})
- **Стек:** ${lang} (${framework})
- **Концепция:** ${briefTagline || taskTitle || userRequest}
- **Режим контекста:** ${contextMode || 'Balanced'}`;
      if (!isRu) {
        environmentHeader = `## Execution Mode: ${profile.name}
You are acting as a senior developer inside a web chat (${isDeepSeek ? 'DeepSeek / Web Chat' : 'Browser chat / Web LLM'}) without direct file-system access.
- Provide COMPLETE, working, self-contained code for every target file.
- Never use placeholders like "// rest of the code unchanged" or "// code here".
- Clearly label each file path (e.g. Target File: src/App.tsx) and explain where to paste the code.
- All imports, types, and exports must be fully defined.

## Project Context
- **Project:** ${projName} (${projType} / ${framework})
- **Stack:** ${lang} (${framework})
- **Concept:** ${briefTagline || taskTitle || userRequest}
- **Context Mode:** ${contextMode || 'Balanced'}`;
      }

      fileSection = `## Целевые файлы\n${relFiles.map((f: any) => `- \`${f.path}\`: Предоставьте полный рабочий код для этого файла.`).join('\n') || '- `src/App.tsx`: Предоставьте полный рабочий код главной точки входа.'}`;
      if (!isRu) {
        fileSection = '## Target Files\n' +
          (relFiles.map((f: any) => '- `' + f.path + '`: Provide the complete working code for this file.').join('\n') ||
            '- `src/App.tsx`: Provide the complete working code for the main entry point.');
      }
    } else {
      environmentHeader = isRu
        ? `## Среда и контекст проекта\nВы работаете над проектом ${projType} на ${lang} (${framework}). Целевой агент: ${profile.name} — ${surfaceDescription(profile, true)}. Режим: ${contextMode || 'Balanced'}.`
        : `You are working on an existing ${projType} project using ${lang} (${framework}). Target Agent: ${profile.name} — ${surfaceDescription(profile, false)}. Mode: ${contextMode || 'Balanced'}.`;
      // The mention syntax belongs to the tool: `@path`, `@/path` from the workspace root, or
      // `#file:` in VS Code Copilot. An offline prompt that names the wrong one is worse than one
      // that names none, because the tool then attaches nothing while the text reads as if it had.
      const refs = relFiles.map((f: any) => `- ${referenceFor(profile, f.path)}`).join('\n');
      const fallbackRef = `- ${referenceFor(profile, 'src/App.tsx')}`;
      fileSection = isRu
        ? `## Файлы проекта\n${refs || fallbackRef}`
        : `## Relevant Project Files\n${refs || fallbackRef}`;
    }

    /*
     * Where the project keeps its conventions, in the syntax this agent can open them with.
     *
     * Empty for a chat (it cannot open a file) and for Replit (it reads `replit.md`, which this app
     * does not write), so the line appears exactly when there is a file to point at. The model path
     * carries the same line through `surfaceRule`, which is what keeps the two paths telling the
     * user the same thing when the provider is slow and this engine answers instead.
     */
    environmentHeader += rulesFileLine(profile, isRu);

    const excludedList = filesList.slice(maxFiles).map((f: any) => ({
      path: f.path,
      reason: f.description || (isRu ? 'Вне рамок задачи' : 'Out of scope')
    }));

    // The level decides the wording of the result, never its quality: the quality block below is the
    // same list for all four levels, and it also carries the demands the offline engine can promise.
    const work = levelWork(skillLevel, isRu);
    const levelSection = isRu
      ? `## Кто делает работу\n${work.autonomy}\n\n## Как объяснять результат\n${work.explanation}\n${work.detail}`
      : `## Who does the work\n${work.autonomy}\n\n## How to explain the result\n${work.explanation}\n${work.detail}`;
    const qualitySection = isRu
      ? `## Требования к качеству кода (одинаковые для всех уровней)\n${qualityBlock(true, testRunner)}`
      : `## Code quality requirements (identical at every level)\n${qualityBlock(false, testRunner)}`;

    // The check comes before the task on purpose: what the agent must not do is read before what it
    // is asked to do.
    const rulesBlock = rulesSection ? `${rulesSection}\n\n` : '';

    /*
     * The offline engine follows the same three surfaces as the model path.
     *
     * It used to write one text for everyone except the chats, and a live run showed what that costs:
     * the provider timed out on a builder, the request fell through to here, and the user was handed a
     * prompt telling a tool that never prints files to return every touched file in full. The fallback
     * is not a rare path — it is exactly what runs when the provider is slow or out of key, which is
     * when the user is least able to check what they were given.
     */
    const deliverable = {
      chat: isRu
        ? 'Не сокращать код: каждый затронутый файл возвращается целиком, без «остальное без изменений».'
        : 'Do not shorten code: every touched file is returned in full, with no "rest of the code unchanged".',
      workspace: isRu
        ? 'Правь файлы проекта напрямую: полные файлы в ответе не нужны — перечисли изменённые пути и что в них изменилось.'
        : 'Edit the project files directly: complete files are not needed — name the changed paths and what changed in each.',
      builder: isRu
        ? 'Одно изменение за раз, с явными границами: перечисли, что должно остаться нетронутым.'
        : 'One change at a time, with explicit boundaries: say what must be left untouched.'
    }[profile.surface];
    /*
     * The criteria and the checks of a prompt written without a model.
     *
     * They used to be three fixed sentences under every task in every project, and `tests` said
     * "Запустить проверку измененных модулей" — a description, not a command. A beginner had no way
     * to tell such a prompt from a compiled one. Everything here comes from the task title, the real
     * file list and the real script names; what is unknown is said to be unknown.
     */
    const acceptance = localAcceptance({
      isRu,
      taskTitle: taskTitle || userRequest,
      files: relFiles.map((f: any) => String(f.path)),
      commands: declaredCommands,
      folderConnected: folderFacts.connected
    });
    const criteriaLines = acceptance.criteria.map((line) => `- ${line}`).join('\n');

    const returnFormat = {
      chat: isRu
        ? 'Полный, готовый к копированию код для измененных и созданных файлов.'
        : 'Complete, copy-pasteable code for the changed and created files.',
      workspace: isRu
        ? 'Список изменённых файлов и что в каждом изменилось.'
        : 'The list of changed files and what changed in each.',
      builder: isRu
        ? 'Что изменено, какие файлы затронуты и что осталось нетронутым.'
        : 'What changed, which files were touched, and what was left alone.'
    }[profile.surface];

    const promptText = isRu
      ? `${environmentHeader}\n\n${rulesBlock}## Задача
${userRequest}

${fileSection}

${levelSection}

## Архитектурные правила
- Не создавать дублирующих менеджеров и избыточных глобальных хранилищ.
- Убедиться, что события корректно обновляют состояние.
- Сохранять изменения точечными и сфокусированными на задаче.

## Требования
1. Реализовать "${userRequest}" без нарушения структуры.
2. Проверить все ссылки на компоненты и импорты.
3. Обеспечить строгую проверку типов.
4. ${deliverable}
5. Не ссылаться на файлы, скрипты и библиотеки, которых в проекте нет, и не заявлять о проверках, которые не выполнялись.

${qualitySection}

## Критерии приемки
${criteriaLines}

## Формат вывода
1. Краткий обзор внесенных изменений.
2. ${returnFormat}
3. Инструкция по проверке.`
      : `${environmentHeader}\n\n${rulesBlock}## Task
${userRequest}

${fileSection}

${levelSection}

## Existing Architecture & Rules
- Do not create secondary duplicate manager classes or redundant state stores.
- Ensure all event hooks update UI state cleanly.
- Keep changes minimal and focused purely on this task.

## Requirements
1. Implement ${userRequest} cleanly.
2. Verify all references and component bindings.
3. Ensure code is complete and free of missing import errors.
4. ${deliverable}
5. Do not reference files, scripts or libraries the project does not have, and do not claim checks that were not performed.

${qualitySection}

## Acceptance Criteria
${criteriaLines}

## Output Requested
1. Brief overview of changes.
2. ${returnFormat}
3. Verification instructions.`;

    return res.json({
      success: true,
      data: {
        taskTitle: taskTitle || userRequest,
        /*
         * Built from facts, not fixed. A prompt written without a model is still a promise about a
         * real folder, so its confidence has to fall when the folder tells it less.
         */
        confidence: acceptance.confidence,
        includedFiles: relFiles,
        excludedFiles: excludedList,
        missingContext: [],
        architectureWarnings: acceptance.warnings,
        promptText,
        acceptanceCriteria: acceptance.criteria,
        tests: acceptance.tests,
        estimatedTokens: estimatedTokens,
        nextBestAction: isRu
          ? `Скопируйте этот скомпилированный промпт в ${profile.name} и выполните.`
          : `Copy this compiled prompt into ${profile.name} and execute.`,
        securityWarnings: isRu ? ['Никогда не публикуйте секретные API-ключи'] : ['Never commit raw API keys'],
        // The same check the prompt was built on, so the screen can show what the agent was told.
        rulesCheck
      },
      /*
       * Which engine wrote this prompt. Without it the screen cannot tell a model's prompt from this
       * one, and the fallback is exactly what runs when the provider is slow or out of key.
       */
      engine: 'local'
    });
  } catch (err: any) {
    console.error('Error in /api/prompt/compile:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to compile prompt' });
  }


}
