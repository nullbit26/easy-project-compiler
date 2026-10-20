/**
 * What the compiler model is doing, read from its own answer.
 *
 * The compiler is asked for one JSON object, and the keys it writes in order are the steps it is
 * taking: it names the task, picks the files, writes the prompt, then the criteria and the checks.
 * A live view of that answer would otherwise be thirty seconds of punctuation; these marks are the
 * same stream, said in words, and they appear only once the model has actually written the key —
 * nothing here predicts a step the answer has not reached.
 *
 * The keys are matched with their quotes so a word inside the prompt text ("tests" in a sentence)
 * cannot trigger a step. Pure on purpose: `tests/compileStream.test.ts` pins the reading without a
 * network call or a provider.
 */

export interface CompileMark {
  /** The JSON key, quotes included, as it appears in the stream. */
  key: string;
  ru: string;
  en: string;
}

export const COMPILE_MARKS: CompileMark[] = [
  { key: '"taskTitle"', ru: 'называет задачу', en: 'naming the task' },
  { key: '"confidence"', ru: 'оценивает уверенность', en: 'weighing confidence' },
  { key: '"includedFiles"', ru: 'выбирает файлы для контекста', en: 'picking files for context' },
  { key: '"excludedFiles"', ru: 'отсеивает лишние файлы', en: 'leaving files out' },
  { key: '"missingContext"', ru: 'проверяет, чего не хватает', en: 'checking missing context' },
  { key: '"architectureWarnings"', ru: 'проверяет архитектуру', en: 'checking architecture' },
  { key: '"promptText"', ru: 'пишет промпт', en: 'writing the prompt' },
  { key: '"acceptanceCriteria"', ru: 'формулирует критерии приёмки', en: 'writing acceptance criteria' },
  { key: '"tests"', ru: 'называет проверки', en: 'naming the checks' },
  { key: '"estimatedTokens"', ru: 'считает объём контекста', en: 'sizing the context' },
  { key: '"nextBestAction"', ru: 'называет следующий шаг', en: 'naming the next step' },
  { key: '"securityWarnings"', ru: 'проверяет секреты в коде', en: 'checking for secrets' }
];

/**
 * The marks present in `trace` that are not in `seen` yet, in the order the model writes them.
 *
 * The caller adds what it gets back to `seen`; the same key is then never reported twice, even
 * while the stream keeps repeating the text around it.
 */
export function newCompileMarks(trace: string, seen: ReadonlySet<string>): CompileMark[] {
  if (!trace) return [];
  return COMPILE_MARKS.filter((mark) => !seen.has(mark.key) && trace.includes(mark.key));
}

/**
 * The prompt text the model is writing right now, read out of the half-finished JSON.
 *
 * The raw stream is JSON syntax — quotes, escapes, keys the reader did not ask to see. The one
 * value that actually matters while the compiler works is `promptText`, and it is already there in
 * the answer as plain prose, escaped. This returns it unescaped and stops at the closing quote the
 * model has not written yet, so the screen can show the prompt growing instead of a wall of JSON.
 *
 * `null` until the key appears; an empty string once the key is there but its value has not started.
 * Both mean "nothing to read yet", and the caller falls back to the raw tail.
 */
export function partialPromptText(trace: string): string | null {
  const key = '"promptText"';
  let index = trace.indexOf(key);
  if (index === -1) return null;
  index += key.length;

  while (index < trace.length && /\s/.test(trace[index])) index++;
  if (trace[index] !== ':') return null;
  index++;
  while (index < trace.length && /\s/.test(trace[index])) index++;
  if (trace[index] !== '"') return null;
  index++;

  let text = '';
  for (; index < trace.length; index++) {
    const character = trace[index];
    if (character === '"') break;
    if (character !== '\\') {
      text += character;
      continue;
    }

    const escaped = trace[index + 1];
    if (escaped === undefined) break;
    if (escaped === 'n') text += '\n';
    else if (escaped === 't') text += '  ';
    else if (escaped === 'r') text += '';
    else if (escaped === 'u') {
      const hex = trace.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        text += String.fromCharCode(parseInt(hex, 16));
        index += 4;
      }
    } else text += escaped;
    index++;
  }

  return text;
}
