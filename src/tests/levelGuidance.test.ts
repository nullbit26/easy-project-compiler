import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { resetApiKeyStoreForTests } from '../../server/store/apiKeyStore';
import {
  QUALITY_REQUIREMENTS,
  levelInstructionBlock,
  levelVoice,
  levelWork,
  questionLimit,
  qualityBlock
} from '../../server/utils/levelGuidance';
import { buildOfflineFirstSteps, offlinePlanVoice } from '../../server/utils/offlineFirstSteps';
import { hasAiProvider } from '../../server/ai/aiProvider';
import { compilePrompt } from '../../server/controllers/prompt.controller';
import { reviewSession } from '../../server/controllers/session.controller';
import { diagnoseError } from '../../server/controllers/error.controller';
import { createIdea, generateQuestions } from '../../server/controllers/project.controller';

/**
 * The working mode decides how much the agent does by itself and how much it explains. It must never
 * decide how good the code has to be — a beginner would otherwise get the weakest result of all,
 * from the least experienced user. These tests pin that split, and they pin it on the artifact the
 * user really pastes into their agent (the compiled prompt), including the offline engine that runs
 * when no API key is configured.
 */

const LEVELS = ['Beginner / Non-coder', 'Vibe-coder', 'Intermediate', 'Advanced'] as const;
const ENV_VARS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NVIDIA_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

/** Removes every provider key, so what answers is the offline engine and not a model. */
function hideProviderKeys() {
  for (const name of ENV_VARS) {
    originalEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.EPC_API_KEYS_FILE = path.join(os.tmpdir(), 'epc-level-guidance-keys.json');
  resetApiKeyStoreForTests();
}

function restoreProviderKeys() {
  for (const name of ENV_VARS) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  delete process.env.EPC_API_KEYS_FILE;
}

/** Calls a controller straight, so the offline branch is what answers. */
async function callOffline(controller: any, body: Record<string, unknown>) {
  let payload: any = null;
  const res: any = {
    json: (data: any) => {
      payload = data;
      return res;
    },
    status: () => res
  };
  await controller({ body: { language: 'ru', ...body } } as any, res);
  return payload?.data;
}

/** The questions a level is allowed per its own prompt block, read back out of that block. */
function promisedQuestionRange(level: string): [number, number] {
  const match = levelInstructionBlock(level, true).match(/Уточняющих вопросов задавать не больше: ([\d-]+)\./);
  expect(match, `в блоке уровня ${level} есть ограничение на вопросы`).toBeTruthy();
  const label = (match as RegExpMatchArray)[1];
  const [min, max] = label.includes('-') ? label.split('-').map(Number) : [Number(label), Number(label)];
  return [min, max];
}

/** Every text field of a question, joined — handy for "no jargon in here" checks. */
function questionText(question: { topic: string; questionText: string; placeholder: string; defaultSuggestion: string }) {
  return `${question.topic} ${question.questionText} ${question.placeholder} ${question.defaultSuggestion}`;
}

/** Runs a compile with no provider available, so the offline template is what gets returned. */
async function compileOffline(level: string, language: 'ru' | 'en' = 'ru') {
  let payload: any = null;
  const res: any = {
    json: (data: any) => {
      payload = data;
      return res;
    },
    status: () => res
  };
  const req: any = {
    body: {
      userRequest: 'Добавить кнопку сохранения на главный экран',
      taskTitle: 'Кнопка сохранения',
      projectMap: {
        projectName: 'Демо',
        projectType: 'React',
        engineOrFramework: 'React 19 + Vite',
        language: 'TypeScript',
        files: [{ path: 'src/App.tsx', type: 'code', description: 'Главный экран' }]
      },
      brief: { tagline: 'Демо-проект' },
      agent: 'Cursor',
      contextMode: 'Balanced',
      skillLevel: level,
      language
    }
  };

  await compilePrompt(req, res);
  return payload?.data?.promptText as string;
}

/** Cuts one markdown section out of the compiled prompt, up to the next heading. */
function sectionOf(promptText: string, heading: string, until: string): string {
  const start = promptText.indexOf(heading);
  const end = promptText.indexOf(until);
  expect(start, `Раздел "${heading}" есть в промпте`).toBeGreaterThan(-1);
  expect(end, `Раздел "${heading}" заканчивается перед "${until}"`).toBeGreaterThan(start);
  return promptText.slice(start, end).trim();
}

describe('Working mode: autonomy, never quality', () => {
  beforeEach(hideProviderKeys);

  afterEach(() => {
    restoreProviderKeys();
    vi.unstubAllGlobals();
  });

  it('hands every level the same, complete set of quality demands', () => {
    for (const level of LEVELS) {
      const block = levelInstructionBlock(level, true);
      // The quality list is passed through verbatim — it cannot be trimmed or reworded per level.
      expect(block).toContain(qualityBlock(true));
      for (const line of QUALITY_REQUIREMENTS.ru) expect(block).toContain(line);
      expect(block).toContain('Строгая типизация');
      expect(block).toContain('Автотесты');

      const enBlock = levelInstructionBlock(level, false);
      expect(enBlock).toContain(qualityBlock(false));
      expect(enBlock).toContain('Strict typing');
      expect(enBlock).toContain('Automated tests');
    }
  });

  it('makes the four levels genuinely different — and leaves the lower ones less to do', () => {
    const blocks = LEVELS.map((level) => levelInstructionBlock(level, true));
    expect(new Set(blocks).size).toBe(LEVELS.length);

    const beginner = levelInstructionBlock('Beginner / Non-coder', true);
    const vibecoder = levelInstructionBlock('Vibe-coder', true);
    const advanced = levelInstructionBlock('Advanced', true);

    // A beginner is not asked anything and is walked through the result.
    expect(beginner).toContain('не задавайте уточняющих вопросов');
    expect(beginner).toContain('шаг за шагом');
    // A vibe-coder is asked only when the product itself is at stake.
    expect(vibecoder).toContain('меняет продукт');
    // An advanced user gets the diff and no prose.
    expect(advanced).toContain('без пересказа очевидного');
    expect(advanced).toContain('Минимум прозы');

    // The amount of bother, spelled out: fewer questions the lower the level.
    expect(levelWork('Beginner / Non-coder', true).questions).toBe('2');
    expect(levelWork('Advanced', true).questions).toBe('4');
  });

  it('carries both parts into the offline compiled prompt — the one used without an API key', async () => {
    // Guards the meaning of this test: with a key configured the compile would call a real model
    // instead of the offline engine, and these assertions would be measuring something else.
    expect(hasAiProvider()).toBe(false);

    const prompts = new Map<string, string>();
    for (const level of LEVELS) {
      const promptText = await compileOffline(level);
      expect(typeof promptText).toBe('string');
      prompts.set(level, promptText);
    }

    const qualitySections = new Set<string>();
    for (const level of LEVELS) {
      const promptText = prompts.get(level) as string;
      // The level's own wording is there…
      expect(promptText).toContain('## Кто делает работу');
      expect(promptText).toContain(levelInstructionBlock(level, true).split('\n')[1].replace('Кто делает работу: ', ''));
      // …and so is the level-independent quality list, line for line.
      for (const line of QUALITY_REQUIREMENTS.ru) expect(promptText).toContain(line);
      qualitySections.add(sectionOf(promptText, '## Требования к качеству кода', '## Критерии приемки'));
    }

    // One identical quality section for all four levels.
    expect(qualitySections.size).toBe(1);

    // The autonomy sections, however, differ from level to level.
    const workSections = new Set(
      LEVELS.map((level) => sectionOf(prompts.get(level) as string, '## Кто делает работу', '## Архитектурные правила'))
    );
    expect(workSections.size).toBe(LEVELS.length);
    expect(prompts.get('Beginner / Non-coder')).toContain('не задавайте уточняющих вопросов');
    expect(prompts.get('Advanced')).not.toContain('не задавайте уточняющих вопросов');
  });

  it('puts the same quality list into the review and the diagnosis prompts', async () => {
    // A provider key is set on purpose: these two screens only reach a model when one is configured,
    // and the prompt they send is exactly what has to carry both parts. The call itself is stubbed.
    process.env.OPENAI_API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
    const sentBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: any, init: any) => {
        sentBodies.push(String(init?.body || ''));
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ choices: [{ message: { content: '{}' } }] })
        } as any;
      })
    );

    const answer = () => {
      const res: any = { json: () => res, status: () => res };
      return res;
    };

    const reviewFor = async (skillLevel: string) => {
      sentBodies.length = 0;
      await reviewSession(
        {
          body: {
            agentOutput: 'Готово: добавил кнопку сохранения в src/App.tsx',
            task: { title: 'Кнопка сохранения', goal: 'Сохранение работает', acceptanceCriteria: [{ description: 'Кнопка есть' }] },
            projectMap: { projectName: 'Демо', projectType: 'React', language: 'TypeScript', files: [] },
            stepNumber: 1,
            previousHistory: [],
            language: 'ru',
            skillLevel
          }
        } as any,
        answer()
      );
      return sentBodies.join('\n');
    };

    const beginnerPrompt = await reviewFor('Beginner / Non-coder');
    const advancedPrompt = await reviewFor('Advanced');

    for (const line of QUALITY_REQUIREMENTS.ru) {
      expect(beginnerPrompt).toContain(line);
      expect(advancedPrompt).toContain(line);
    }
    // The wording around the verdict follows the level…
    expect(beginnerPrompt).toContain('не задавайте уточняющих вопросов');
    expect(advancedPrompt).not.toContain('не задавайте уточняющих вопросов');
    // …while the quality demands are the same text in both. The section is cut at the response
    // contract, which is what follows the level block in the rewritten reviewer prompt.
    expect(sectionOf(beginnerPrompt, 'Требования к качеству кода', '## Что вернуть')).toBe(
      sectionOf(advancedPrompt, 'Требования к качеству кода', '## Что вернуть')
    );

    // The error coach sends the same pair.
    sentBodies.length = 0;
    await diagnoseError(
      {
        body: {
          errorText: 'TypeError: Cannot read properties of undefined',
          projectType: 'React',
          framework: 'React 19 + Vite',
          language: 'ru',
          skillLevel: 'Advanced'
        }
      } as any,
      answer()
    );
    const coachPrompt = sentBodies.join('\n');
    expect(coachPrompt).toContain('Минимум прозы');
    for (const line of QUALITY_REQUIREMENTS.ru) expect(coachPrompt).toContain(line);
  });

  it('phrases the offline verdict and the offline repair by level, without changing the substance', async () => {
    expect(hasAiProvider()).toBe(false);

    const answer = () => {
      const res: any = { json: () => res, status: () => res };
      return res;
    };
    const call = async (controller: any, body: any) => {
      let payload: any = null;
      const res: any = {
        json: (data: any) => {
          payload = data;
          return res;
        },
        status: () => res
      };
      await controller({ body } as any, res);
      return payload?.data;
    };

    // An answer long enough for the criteria check to run, with no criterion keywords in it.
    const reviewBody = (skillLevel: string) => ({
      agentOutput: 'zqx '.repeat(90),
      task: { title: 'Кнопка', goal: 'Сохранять', acceptanceCriteria: [{ description: 'AABBCC' }, { description: 'DDEEFF' }, { description: 'GGHHII' }] },
      projectMap: { projectName: 'Демо', projectType: 'React', language: 'TypeScript', files: [] },
      stepNumber: 1,
      previousHistory: [],
      language: 'ru',
      skillLevel
    });

    const beginnerReview = await call(reviewSession, reviewBody('Beginner / Non-coder'));
    const advancedReview = await call(reviewSession, reviewBody('Advanced'));

    // Same judgement on the same answer…
    expect(beginnerReview.status).toBe(advancedReview.status);
    expect(beginnerReview.progressPercent).toBe(advancedReview.progressPercent);
    expect(beginnerReview.completedCriteria).toEqual(advancedReview.completedCriteria);
    expect(beginnerReview.missingCriteria).toEqual(advancedReview.missingCriteria);
    // …and the continuation prompt carries the same quality demands for both.
    for (const line of QUALITY_REQUIREMENTS.ru) {
      expect(beginnerReview.continuationPrompt).toContain(line);
      expect(advancedReview.continuationPrompt).toContain(line);
    }
    // The instruction to the user, however, is written for the level: a beginner is told which
    // button to press, on the screen they are already on.
    expect(beginnerReview.nextBestAction).toContain('Копировать промпт продолжения');
    expect(beginnerReview.nextBestAction).not.toBe(advancedReview.nextBestAction);

    const coachBody = (skillLevel: string) => ({
      errorText: 'TypeError: Cannot read properties of undefined (reading items)',
      projectType: 'React',
      framework: 'React 19 + Vite',
      language: 'ru',
      skillLevel
    });

    const beginnerFix = await call(diagnoseError, coachBody('Beginner / Non-coder'));
    const advancedFix = await call(diagnoseError, coachBody('Advanced'));

    // A beginner is told the agent does the fixing; an advanced user just gets the fix.
    expect(beginnerFix.repairPrompt).toContain('Скопируйте этот текст целиком в ИИ-агента');
    expect(advancedFix.repairPrompt).not.toContain('Скопируйте этот текст целиком');
    expect(beginnerFix.repairPrompt).toContain('src/App.tsx');
    expect(advancedFix.repairPrompt).toContain('src/App.tsx');
    // The verification steps — the part that has to stay equally strict — are identical.
    expect(beginnerFix.verificationSteps).toEqual(advancedFix.verificationSteps);
    expect(beginnerFix.explanations).toEqual(advancedFix.explanations);
  });

  it('carries the level into the English offline prompt as well', async () => {
    const promptText = await compileOffline('Advanced', 'en');
    expect(promptText).toContain('## Who does the work');
    expect(promptText).toContain('## Code quality requirements (identical at every level)');
    for (const line of QUALITY_REQUIREMENTS.en) expect(promptText).toContain(line);
  });
});

/**
 * Without an API key there is no model to write for the level, so the app has to do it itself. These
 * tests pin the offline first steps — the clarifying questions, the trade-offs and the local plan —
 * to the same level decisions the prompts carry, and pin the plan's substance as level-independent.
 */
describe('Without a key: the same mode, the same quality', () => {
  beforeEach(hideProviderKeys);

  afterEach(() => {
    restoreProviderKeys();
    vi.unstubAllGlobals();
  });

  it('asks each level no more questions than its own prompt block promises', () => {
    const counts = LEVELS.map((level) => {
      const [min, max] = promisedQuestionRange(level);
      const limit = questionLimit(level);
      expect(limit, `offline count for ${level} stays inside ${min}-${max}`).toBeGreaterThanOrEqual(min);
      expect(limit).toBeLessThanOrEqual(max);
      return limit;
    });

    // A beginner is bothered by fewer questions than an advanced user — not by the same list.
    expect(counts[0]).toBeLessThan(counts[3]);
    expect(LEVELS.map((level) => levelVoice(level))).toEqual(['plain', 'plain', 'technical', 'technical']);
  });

  it('writes the offline questions and trade-offs in the level voice, without dropping a decision', () => {
    const beginner = buildOfflineFirstSteps({ level: 'Beginner / Non-coder', isRu: true, isGame: false });
    const vibecoder = buildOfflineFirstSteps({ level: 'Vibe-coder', isRu: true, isGame: false });
    const intermediate = buildOfflineFirstSteps({ level: 'Intermediate', isRu: true, isGame: false });
    const advanced = buildOfflineFirstSteps({ level: 'Advanced', isRu: true, isGame: false });

    expect(beginner.questions).toHaveLength(2);
    expect(vibecoder.questions).toHaveLength(3);
    expect(intermediate.questions).toHaveLength(3);
    expect(advanced.questions).toHaveLength(4);

    // The shorter plain list keeps the questions that matter, in the same order.
    expect(beginner.questions.map(questionText)).toEqual(vibecoder.questions.slice(0, 2).map(questionText));

    // Plain words for the two lower levels, storage engines and patterns for the two upper ones.
    const plainText = beginner.questions.map(questionText).join(' ');
    const technicalText = advanced.questions.map(questionText).join(' ');
    for (const jargon of ['LocalStorage', 'FSM', 'REST', 'API', 'ECS', 'автотест', 'стейт']) {
      expect(plainText, `«${jargon}» не попадает в вопросы новичка`).not.toContain(jargon);
    }
    expect(technicalText).toContain('LocalStorage');
    expect(technicalText).toContain('автотест');

    // Whatever the level, both product decisions are still offered, filled in and answerable.
    for (const steps of [beginner, vibecoder, intermediate, advanced]) {
      expect(steps.tradeOffs.map((t) => t.id)).toEqual(['t1', 't2']);
      for (const tradeOff of steps.tradeOffs) {
        expect(tradeOff.title.length).toBeGreaterThan(0);
        expect(tradeOff.optionA.length).toBeGreaterThan(0);
        expect(tradeOff.optionB.length).toBeGreaterThan(0);
        expect(tradeOff.recommendation.length).toBeGreaterThan(0);
        expect(tradeOff.optionA).not.toBe(tradeOff.optionB);
      }
    }
    expect(beginner.tradeOffs[0].optionA).not.toBe(advanced.tradeOffs[0].optionA);
  });

  it('speaks the level in the offline question generator itself, not only in the helper', async () => {
    expect(hasAiProvider()).toBe(false);

    const idea = 'Приложение для заметок на React';
    const beginner = await callOffline(generateQuestions, { idea, stack: 'React 19 + Vite', skillLevel: 'Beginner / Non-coder' });
    const advanced = await callOffline(generateQuestions, { idea, stack: 'React 19 + Vite', skillLevel: 'Advanced' });

    expect(beginner.questions).toHaveLength(2);
    expect(advanced.questions).toHaveLength(4);
    expect(beginner.questions.map(questionText)).not.toEqual(advanced.questions.slice(0, 2).map(questionText));
    expect(beginner.questions.map(questionText).join(' ')).not.toContain('LocalStorage');
    expect(advanced.questions.map(questionText).join(' ')).toContain('LocalStorage');
    expect(beginner.tradeOffs).toHaveLength(2);
    expect(advanced.tradeOffs).toHaveLength(2);
  });

  it('keeps the offline plan identical in substance and only changes how it is told', async () => {
    expect(hasAiProvider()).toBe(false);

    const body = {
      idea: 'Приложение для заметок',
      projectName: 'Заметки',
      platform: 'Web Application',
      stack: 'React 19 + Vite',
      agent: 'Cursor',
      mvpDepth: 'Production MVP'
    };
    const beginner = await callOffline(createIdea, { ...body, skillLevel: 'Beginner / Non-coder' });
    const advanced = await callOffline(createIdea, { ...body, skillLevel: 'Advanced' });

    const planShape = (plan: any) => ({
      phases: plan.phases.map((phase: any) => ({
        title: phase.title,
        purpose: phase.purpose,
        deliverable: phase.deliverable,
        tasks: phase.tasks.map((task: any) => ({
          title: task.title,
          goal: task.goal,
          acceptanceCriteria: task.acceptanceCriteria,
          relevantFiles: task.relevantFiles,
          estimatedComplexity: task.estimatedComplexity,
          dependencies: task.dependencies
        }))
      }))
    });

    // Same project: the level neither adds nor removes a phase, a task or an acceptance criterion.
    expect(planShape(beginner)).toEqual(planShape(advanced));
    expect(beginner.phases.length).toBeGreaterThan(0);

    // The only difference in the plan's demands: the plain voice adds a no-terminal check, never less.
    const taskRequirements = (plan: any) => plan.phases.flatMap((phase: any) => phase.tasks.map((task: any) => task.testRequirements));
    const beginnerRequirements = taskRequirements(beginner);
    const advancedRequirements = taskRequirements(advanced);
    const firstCriteria = beginner.phases.flatMap((phase: any) => phase.tasks.map((task: any) => task.acceptanceCriteria[0]));
    expect(beginnerRequirements).toHaveLength(advancedRequirements.length);

    beginnerRequirements.forEach((requirements: string[], index: number) => {
      const added = requirements[requirements.length - 1];
      expect(requirements.slice(0, -1)).toEqual(advancedRequirements[index]);
      expect(added).toContain('Как проверить без терминала');
      // The manual check names the criterion of its own task, so it is a check and not filler.
      expect(added).toContain(firstCriteria[index]);
    });
    expect(advancedRequirements.flat().join(' ')).not.toContain('Как проверить без терминала');

    // The plan itself is told for the level: who does the work, how it is tested, what to clarify.
    expect(beginner.coreValue).toContain('ИИ-агент');
    expect(advanced.coreValue).not.toBe(beginner.coreValue);
    expect(beginner.architecture.testingStrategy).toContain('в терминале вам ничего вводить не нужно');
    expect(advanced.architecture.testingStrategy).toContain('Модульное тестирование');
    expect(beginner.clarifyingQuestions).not.toEqual(advanced.clarifyingQuestions);
  });

  it('has both voices in English too, and keeps them apart', () => {
    const plain = buildOfflineFirstSteps({ level: 'Beginner / Non-coder', isRu: false, isGame: true });
    const technical = buildOfflineFirstSteps({ level: 'Advanced', isRu: false, isGame: true });

    expect(plain.questions).toHaveLength(2);
    expect(technical.questions).toHaveLength(4);
    expect(plain.questions.map(questionText).join(' ')).not.toMatch(/State Machine|ECS|LocalStorage|unit test/i);
    expect(technical.questions.map(questionText).join(' ')).toMatch(/unit tests/i);
    expect(offlinePlanVoice('Advanced', false).plain).toBe(false);
    expect(offlinePlanVoice('Beginner / Non-coder', false).manualCheck('the list does not disappear')).toBe(
      'How to check without a terminal: open the project and confirm that the list does not disappear'
    );
  });
});
