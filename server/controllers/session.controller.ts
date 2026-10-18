import { Request, Response } from 'express';
import { Type } from '../ai/geminiProvider';
import { callAiJson, hasAiProvider, getEngineLabel } from '../ai/aiProvider';
import { levelWork } from '../utils/levelGuidance';
import { normalizeReviewStatus } from '../utils/reviewStatus';
import { guardReviewAgainstChecks } from '../utils/checkVerdict';
import {
  checkEvidenceHeadline,
  failedCheckLines,
  type CheckEvidence,
  type CheckEvidenceLine
} from '../../src/utils/checkEvidence';
import {
  AGENT_OUTPUT_LIMIT,
  buildContinuationPromptText,
  buildReviewPromptText,
  type ReviewPreviousAttempt
} from '../utils/promptTexts';

const reviewSessionSchema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, description: "Exactly one of: Completed | Partially Completed | Blocked | Failed" },
    progressPercent: { type: Type.INTEGER, description: "Exact progress percentage from 0 to 100" },
    completedCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    missingCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    unintendedChanges: { type: Type.ARRAY, items: { type: Type.STRING } },
    nextBestAction: { type: Type.STRING },
    agentOutputSummary: { type: Type.STRING },
    continuationPrompt: { type: Type.STRING }
  },
  required: [
    "status", "progressPercent", "completedCriteria", "missingCriteria",
    "warnings", "unintendedChanges", "nextBestAction", "agentOutputSummary", "continuationPrompt"
  ]
};

/**
 * The check facts the client sends, taken apart field by field.
 *
 * Everything that arrives from the screen is treated as prose until proven otherwise: this feeds a
 * prompt, and a shape that is trusted because "our own client sends it" is how a body grows a stray
 * object that later reads as an instruction.
 */
function normalizeCheckEvidence(raw: any): CheckEvidence | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines) || raw.lines.length === 0) return null;

  const lines: CheckEvidenceLine[] = raw.lines
    .filter((line: any) => line && typeof line === 'object')
    .slice(0, 12)
    .map((line: any) => ({
      id: String(line.id || ''),
      label: String(line.label || line.commandLine || ''),
      status: ['passed', 'failed', 'timeout', 'unavailable', 'skipped'].includes(line.status)
        ? line.status
        : 'unavailable',
      commandLine: String(line.commandLine || ''),
      durationMs: Number(line.durationMs) || 0,
      problems: Array.isArray(line.problems) ? line.problems.slice(0, 5).map((item: any) => String(item)) : [],
      problemCount: Number(line.problemCount) || 0
    }));

  if (lines.length === 0) return null;
  return {
    ranAt: String(raw.ranAt || ''),
    ok: !!raw.ok,
    passed: Number(raw.passed) || 0,
    failed: Number(raw.failed) || 0,
    lines
  };
}

/** The shape the reviewer needs about an earlier pass; everything else in it is the screen's business. */
function previousAttemptsOf(history: any[]): ReviewPreviousAttempt[] {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry: any, index: number) => {
      const review = entry?.review || {};
      const missing = Array.isArray(review.missingCriteria) ? review.missingCriteria : [];
      return {
        attemptNumber: Number(entry?.attemptNumber) || index + 1,
        status: String(review.status || ''),
        progressPercent: Number(review.progressPercent) || 0,
        missingCriteria: missing.map((item: any) => String(item))
      };
    })
    .filter((entry) => entry.status !== '' || entry.missingCriteria.length > 0);
}

export async function reviewSession(req: Request, res: Response) {
  try {
    const { agentOutput, task, projectMap, stepNumber = 1, previousHistory = [], language, skillLevel } = req.body;
    const ai = hasAiProvider();
    const isRu = language === 'ru' || !language;
    // The commands the app itself ran in the folder before the review — the facts the verdict has to
    // agree with, whichever engine answers.
    const checkEvidence = normalizeCheckEvidence(req.body?.checkEvidence);

    const currentStep = Number(stepNumber) || 1;
    const nextStep = currentStep + 1;

    const criteriaList: string[] = (task?.acceptanceCriteria || []).map((ac: any) =>
      typeof ac === 'string' ? ac : ac.description
    );
    if (criteriaList.length === 0) {
      criteriaList.push(
        isRu ? 'Код реализует основной функционал задачи без ошибок' : 'Code implements core task functionality without errors',
        isRu ? 'Экспорты и импорты корректно подключены' : 'Proper exports and imports connected cleanly',
        isRu ? 'Взаимодействия и обновления состояния работают' : 'User interactions and state updates functional'
      );
    }

    const rawOutput = String(agentOutput ?? '');
    // A long answer is cut, and the reviewer is told it was cut: a criterion that cannot be seen in
    // the excerpt must be reported as unverifiable, never as missing because the text stopped. The
    // old limit (4000 characters) was small enough to hit on ordinary answers, and it was silent.
    const truncated = rawOutput.length > AGENT_OUTPUT_LIMIT;
    const excerpt = truncated ? rawOutput.slice(0, AGENT_OUTPUT_LIMIT) : rawOutput;

    if (ai) {
      const prompt = buildReviewPromptText({
        isRu,
        skillLevel,
        taskTitle: task?.title || (isRu ? 'Текущая задача' : 'Current task'),
        taskGoal: task?.goal || '',
        criteria: criteriaList,
        attemptNumber: currentStep,
        previousAttempts: previousAttemptsOf(previousHistory),
        agentOutput: excerpt,
        truncated,
        checkEvidence
      });
      const parsed = await callAiJson(prompt, reviewSessionSchema);
      if (parsed && parsed.status && typeof parsed.progressPercent === 'number') {
        // A model can still answer "Completed" over a folder that does not compile; the checks are
        // the part of this verdict that was measured rather than read, so they win.
        const guarded = guardReviewAgainstChecks(
          {
            status: String(parsed.status),
            progressPercent: Number(parsed.progressPercent),
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item: any) => String(item)) : [],
            missingCriteria: Array.isArray(parsed.missingCriteria)
              ? parsed.missingCriteria.map((item: any) => String(item))
              : [],
            continuationPrompt: String(parsed.continuationPrompt || '')
          },
          checkEvidence,
          isRu
        );
        return res.json({
          success: true,
          data: {
            ...parsed,
            status: normalizeReviewStatus(guarded.status, guarded.progressPercent),
            progressPercent: guarded.progressPercent,
            warnings: guarded.warnings,
            missingCriteria: guarded.missingCriteria,
            continuationPrompt: guarded.continuationPrompt
          },
          engine: getEngineLabel()
        });
      }
    }

    // Fallback evaluation if no AI key or quota exceeded
    const outputLower = excerpt.toLowerCase();
    const completed: string[] = [];
    const missing: string[] = [];

    // Analyze each criterion against output text
    criteriaList.forEach((crit, idx) => {
      const keywords = crit.toLowerCase().split(' ').filter(w => w.length > 4);
      const matchesKeyword = keywords.some(kw => outputLower.includes(kw));
      const looksSubstantial = excerpt.length > 250 + idx * 100;

      if ((matchesKeyword || looksSubstantial) && !outputLower.includes('error:') && !outputLower.includes('exception')) {
        completed.push(crit);
      } else {
        missing.push(crit);
      }
    });

    // If everything or nothing matched by keywords, calculate proportionally based on text length and structure
    if (completed.length === 0 && excerpt.length > 200) {
      completed.push(criteriaList[0]);
      for (let i = 1; i < criteriaList.length; i++) {
        if (excerpt.length > 200 + i * 300) {
          completed.push(criteriaList[i]);
        } else {
          missing.push(criteriaList[i]);
        }
      }
    }

    const totalCount = criteriaList.length;
    const completedCount = completed.length;
    let computedPercent = Math.min(100, Math.round((completedCount / totalCount) * 100));

    if (excerpt.length < 150 || outputLower.includes('truncated') || outputLower.includes('cut off')) {
      computedPercent = Math.min(computedPercent, 40);
    }

    /*
     * The checks the app itself ran can veto a "done".
     *
     * The keyword pass above reads the answer's text; a folder that does not compile is not a
     * finished task, and the messages of the failed command are the most concrete thing this
     * offline engine can put in front of the user — far more useful than "run npm install", which
     * was what the loop kept asking for while nothing on disk had ever been run.
     */
    const failedChecks = failedCheckLines(checkEvidence);
    const is100Percent = failedChecks.length === 0 && (computedPercent >= 95 || missing.length === 0);
    const finalPercent = is100Percent ? 100 : failedChecks.length ? Math.min(computedPercent, 90) : computedPercent;

    const checkWarning = checkEvidence ? checkEvidenceHeadline(checkEvidence, isRu) : '';
    const missingAll = [
      ...missing,
      ...failedChecks.map((line) =>
        isRu
          ? `Исправить то, что нашла проверка «${line.label}»: ${line.problems[0] || 'см. вывод команды'}`
          : `Fix what the check "${line.label}" reported: ${line.problems[0] || 'see the command output'}`
      )
    ];

    /*
     * A pass of the loop is an attempt ("Попытка"), never a step ("Шаг") — the step is the screen.
     * The check line is first on purpose: it is the only sentence in this list that comes from a
     * command that really ran, and it is what tells "0%" apart from "0% and the project still does
     * not build".
     */
    const warningLines: string[] = [];
    if (checkWarning) warningLines.push(checkWarning);
    if (failedChecks.length > 0) {
      warningLines.push(
        isRu
          ? 'Пока проверка не проходит, задача не считается готовой: исправьте то, что она нашла.'
          : 'While a check fails the task is not finished: fix what it reported.'
      );
    }
    if (!is100Percent) {
      warningLines.push(
        isRu
          ? `Попытка ${currentStep} закрыта на ${finalPercent}%. Запустите промпт попытки ${nextStep}, чтобы дойти до 100%.`
          : `Attempt ${currentStep} is ${finalPercent}% complete. Run the attempt ${nextStep} prompt to reach 100%.`
      );
    }
    if (truncated) {
      warningLines.push(
        isRu
          ? `Ответ агента был длиннее, чем помещается в разбор: проверены только первые ${AGENT_OUTPUT_LIMIT} символов.`
          : `The agent answer was longer than the review can read: only the first ${AGENT_OUTPUT_LIMIT} characters were checked.`
      );
    }
    /*
     * The status is the same English enum the model is asked for, in both languages. It used to be
     * written in Russian here (`Завершено` / `Частично выполнено`), and the verdict card compares it
     * against `Completed` / `Partially Completed` — so the local engine, which is the one most users
     * ever see, reported every partial result as a failure.
     */
    const status = is100Percent ? 'Completed' : 'Partially Completed';

    // The offline verdict is the one most users ever see (no API key configured), so its wording
    // follows the level as well — while the criteria checking above stays exactly the same for all
    // four levels.
    const work = levelWork(skillLevel, isRu);

    let continuationPromptText = '';
    if (!is100Percent) {
      continuationPromptText = buildContinuationPromptText({
        isRu,
        taskTitle: task?.title || (isRu ? 'Текущая задача' : 'Current task'),
        attemptNumber: currentStep,
        nextAttemptNumber: nextStep,
        progressPercent: finalPercent,
        completed,
        missing: missingAll,
        skillLevel
      });
    }

    return res.json({
      success: true,
      data: {
        status,
        progressPercent: finalPercent,
        completedCriteria: completed.length > 0 ? completed : [criteriaList[0]],
        missingCriteria: is100Percent
          ? []
          : missingAll.length > 0
          ? missingAll
          : [criteriaList[criteriaList.length - 1]],
        warnings: warningLines,
        unintendedChanges: [],
        nextBestAction: is100Percent
          ? isRu
            ? work.key === 'beginner'
              ? 'Всё готово: отметьте задачу выполненной, и приложение предложит следующую.'
              : 'Задача полностью проверена. Отметьте ее завершенной и перейдите к следующей задаче.'
            : 'Task 100% verified! Mark task as completed and proceed to the next task.'
          : isRu
          ? work.key === 'beginner'
            ? 'Промпт продолжения уже готов ниже: нажмите «Копировать промпт продолжения» и вставьте его в ИИ-агента — настраивать больше ничего не нужно.'
            : work.key === 'vibecoder'
            ? `Скопируйте промпт продолжения в ИИ-агента: он закроет оставшиеся пункты.`
            : `Скопируйте промпт продолжения попытки ${nextStep} в ИИ-агента для выполнения оставшихся критериев.`
          : `Copy the attempt ${nextStep} continuation prompt into your AI agent to implement the missing criteria.`,
        agentOutputSummary: isRu
          ? `Анализ попытки ${currentStep}: проверено ${completedCount} из ${totalCount} критериев (${finalPercent}% завершено).`
          : `Attempt ${currentStep} analysis: verified ${completedCount} of ${totalCount} criteria (${finalPercent}% complete).`,
        continuationPrompt: continuationPromptText
      },
      /*
       * Which engine judged the answer. The offline verdict counts keywords in the pasted text and
       * reads the app's own checks; it is the one most users ever see (no API key), so the screen has
       * to be able to say that no model read the answer instead of showing the same card as always.
       */
      engine: 'local'
    });
  } catch (err: any) {
    console.error('Error in /api/session/review:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to review session' });
  }


}
