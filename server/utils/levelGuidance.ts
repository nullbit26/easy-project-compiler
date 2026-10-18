/**
 * The working mode ("Новичок" / "Вайб-кодер" / "Средний" / "Продвинутый") is about how much work the
 * agent does on its own and how much the user has to read — it never decides how good the code has to
 * be. Quality lives in QUALITY_REQUIREMENTS and is handed to every request at every level, so a
 * beginner gets exactly the same typing, tests and edge-case demands as an advanced user.
 *
 * Everything that shapes a request out of a level goes through levelInstructionBlock(), levelWork(),
 * questionLimit() or levelVoice() — one place, so the four levels cannot drift apart or silently
 * weaken anything. The fixed content the offline engine writes for each voice lives in
 * offlineFirstSteps.ts and reads its counts and its voice from here.
 */

export type LevelKey = 'beginner' | 'vibecoder' | 'intermediate' | 'advanced';

/** Maps whatever the client sends (ru/en label or raw key) onto one of the four levels. */
export function levelKey(raw: string | undefined | null): LevelKey {
  const value = String(raw || '').toLowerCase();
  if (value.includes('beginner') || value.includes('нович')) return 'beginner';
  if (value.includes('vibe') || value.includes('вайб')) return 'vibecoder';
  if (value.includes('intermediate') || value.includes('средн')) return 'intermediate';
  return 'advanced';
}

/**
 * What every request has to demand, whoever is at the keyboard. This list is deliberately not
 * level-aware: dropping a requirement for a beginner would hand the least experienced user the
 * weakest code.
 */
export const QUALITY_REQUIREMENTS: { ru: string[]; en: string[] } = {
  ru: [
    'Строгая типизация и обработка ошибок: никаких `any`, заглушек и «остальное без изменений».',
    'Полный, готовый к вставке код для каждого затронутого файла.',
    'Автотесты на изменённую логику и точная команда, которой их запускают.',
    'Граничные случаи и неудачные сценарии, а не только happy path.',
    'Никаких выдуманных путей, API и зависимостей, которых в проекте нет.'
  ],
  en: [
    'Strict typing and error handling: no `any`, no placeholders, no “rest of the code unchanged”.',
    'Complete, copy-pasteable code for every touched file.',
    'Automated tests for the changed logic plus the exact command that runs them.',
    'Edge cases and failure paths, not only the happy path.',
    'No invented paths, APIs or dependencies that do not exist in the project.'
  ]
};

/** What the level changes: who does the work, and how much the user has to read. */
const LEVEL_WORK: Record<LevelKey, { ru: Autonomy; en: Autonomy }> = {
  beginner: {
    ru: {
      autonomy:
        'Делайте работу целиком сами: не задавайте уточняющих вопросов, выбирайте разумные значения по умолчанию и заканчивайте задачу в одном ответе.',
      explanation:
        'Объясняйте шаг за шагом и простыми словами, без жаргона: что нажать, куда вставить, как проверить результат.',
      detail: 'Никаких требований, которые человеку нужно выполнить в терминале, если этого можно избежать.'
    },
    en: {
      autonomy:
        'Do the whole job yourself: ask no clarifying questions, pick sensible defaults and finish the task in one answer.',
      explanation:
        'Explain step by step in plain words, no jargon: what to press, where to paste, how to check the result.',
      detail: 'Avoid asking the user to run anything in a terminal when it can be avoided.'
    }
  },
  vibecoder: {
    ru: {
      autonomy:
        'Основную работу делайте сами; спрашивайте только там, где выбор меняет продукт, а не код.',
      explanation:
        'Коротко и по-простому: что изменилось и что проверить. Технические термины — сразу с расшифровкой.',
      detail: 'Человек не читает код: важное должно быть сказано текстом.'
    },
    en: {
      autonomy:
        'Do the main work yourself; ask only where the choice changes the product rather than the code.',
      explanation:
        'Short and plain: what changed and what to check. Expand any technical term on the spot.',
      detail: 'Assume the user does not read code: anything important must be said in words.'
    }
  },
  intermediate: {
    ru: {
      autonomy: 'Предложите решение и одно короткое обоснование; детали реализации выбирайте сами.',
      explanation: 'Подробно — про архитектуру, файлы и тесты; остальное сжато.',
      detail: 'Можно ссылаться на типы, модули и тесты без разжёвывания.'
    },
    en: {
      autonomy: 'Propose the solution with one short justification; pick implementation details yourself.',
      explanation: 'Detail the architecture, files and tests; keep the rest brief.',
      detail: 'Type, module and test references need no explanation.'
    }
  },
  advanced: {
    ru: {
      autonomy: 'Работайте полностью самостоятельно, без пересказа очевидного.',
      explanation: 'Минимум прозы: изменения, риски, граничные случаи и тесты. Без вводных абзацев.',
      detail: 'Только суть и diff: затронутые файлы, сигнатуры, влияние на существующий код.'
    },
    en: {
      autonomy: 'Work fully on your own, with no restating of the obvious.',
      explanation: 'Minimum prose: changes, risks, edge cases and tests. No introductory paragraphs.',
      detail: 'Essentials and diff only: touched files, signatures, impact on existing code.'
    }
  }
};

interface Autonomy {
  autonomy: string;
  explanation: string;
  detail: string;
}

/** How many clarification questions each level is worth asking — lower levels are not bothered. */
const QUESTION_RANGE: Record<LevelKey, { min: number; max: number }> = {
  beginner: { min: 2, max: 2 },
  vibecoder: { min: 2, max: 3 },
  intermediate: { min: 3, max: 4 },
  advanced: { min: 4, max: 4 }
};

/**
 * What the offline first steps actually ask when there is no model to size it up: never more than the
 * cap promised above, and fewer where the level prefers to be left alone. It lives next to the range
 * so the number in the prompt and the number of questions the user really sees cannot drift apart.
 */
const QUESTION_TARGET: Record<LevelKey, number> = {
  beginner: 2,
  vibecoder: 3,
  intermediate: 3,
  advanced: 4
};

function questionRangeLabel(key: LevelKey): string {
  const range = QUESTION_RANGE[key];
  return range.min === range.max ? String(range.max) : `${range.min}-${range.max}`;
}

/** The offline engine's question count for this level — the same number the prompt promises. */
export function questionLimit(raw: string | undefined | null): number {
  return QUESTION_TARGET[levelKey(raw)];
}

/**
 * The two voices of the offline engine. Новичок and Вайб-кодер get plain words, Средний and
 * Продвинутый get the technical ones — exactly the split LEVEL_WORK describes, so the fixed content
 * the app falls back on speaks the way the model would have.
 */
export type LevelVoice = 'plain' | 'technical';

export function levelVoice(raw: string | undefined | null): LevelVoice {
  const key = levelKey(raw);
  return key === 'beginner' || key === 'vibecoder' ? 'plain' : 'technical';
}

export function levelWork(raw: string | undefined | null, isRu: boolean): Autonomy & { key: LevelKey; questions: string } {
  const key = levelKey(raw);
  return { key, questions: questionRangeLabel(key), ...(isRu ? LEVEL_WORK[key].ru : LEVEL_WORK[key].en) };
}

/**
 * What the test demand becomes when the project has no test runner at all.
 *
 * Asking every project for automated tests plus the command that runs them is how a beginner ends up
 * with an agent that installs a framework nobody asked for, or with a failing check on infrastructure
 * they never chose. The demand itself is not dropped — it is pointed at the checks that really exist.
 */
const NO_RUNNER_TEST_DEMAND: { ru: string; en: string } = {
  ru: 'Проверки, которые может выполнить проект, и честный отчёт о них: тестового фреймворка в проекте нет — не добавляй его в рамках этой задачи, назови, что проверено вручную.',
  en: 'The checks this project can actually run, and an honest report of them: the project has no test framework — do not add one for this task, and name what was checked by hand.'
};

/**
 * The same quality demands, as a prompt block. Identical for every level.
 *
 * `testRunner` only decides how the test demand is worded: `false` means the project declares no
 * test script, `null`/`true` keep the original line. A project that has a runner is asked for a test
 * exactly as before, so nothing is weakened where tests really run.
 */
export function qualityBlock(isRu: boolean, testRunner: boolean | null = null): string {
  const lines = [...(isRu ? QUALITY_REQUIREMENTS.ru : QUALITY_REQUIREMENTS.en)];
  if (testRunner === false) lines[2] = isRu ? NO_RUNNER_TEST_DEMAND.ru : NO_RUNNER_TEST_DEMAND.en;
  return lines.map((line) => `- ${line}`).join('\n');
}

/**
 * The level part of a prompt: who does the work and how much explaining is expected. The quality
 * block is appended next to it (never inside it), so it is visually impossible to "tune" quality by
 * level.
 */
export function levelInstructionBlock(
  raw: string | undefined | null,
  isRu: boolean,
  testRunner: boolean | null = null
): string {
  const work = levelWork(raw, isRu);
  if (isRu) {
    return `Уровень пользователя: "${raw || 'Beginner / Non-coder'}" (${work.key}).
Кто делает работу: ${work.autonomy}
Как объяснять: ${work.explanation}
Детализация: ${work.detail}
Уточняющих вопросов задавать не больше: ${work.questions}.

Требования к качеству кода — одинаковые на всех уровнях, ослаблять их нельзя:
${qualityBlock(isRu, testRunner)}`;
  }
  return `User level: "${raw || 'Beginner / Non-coder'}" (${work.key}).
Who does the work: ${work.autonomy}
How to explain: ${work.explanation}
Level of detail: ${work.detail}
Clarifying questions allowed: ${work.questions} at most.

Code quality requirements — identical at every level, never weaken them:
${qualityBlock(isRu, testRunner)}`;
}
