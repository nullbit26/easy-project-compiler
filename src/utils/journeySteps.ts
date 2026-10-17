import { Translations } from '../i18n/translations';

/**
 * One journey, one count.
 *
 * The app teaches the same four things in two places, and they used to be numbered apart. The
 * step-by-step helper called the folder step 1 and the finished prompt step 3, while the workspace
 * loop called that same prompt "Шаг 1: Компиляция промпта" and the check "Шаг 2". Switching
 * interfaces therefore restarted the count: one act wore two numbers, and the reader dropped from
 * 4 back to 1 on the way.
 *
 * There is one journey — connect the folder, choose the task, build the prompt, check the answer —
 * and this module is the only place its numbers live. The helper spells each step out on its own
 * screen; the full workspace shows the last two in depth. Both read the number from here, so they
 * cannot disagree, and a switch between the two interfaces carries on from where the reader was.
 *
 * The word for a screen of the journey stays `Шаг`/"Step"; a pass of the loop inside a screen stays
 * `Попытка`/"attempt" (see the review screen). One word per thing.
 */
export type JourneyStep = 'folder' | 'task' | 'prompt' | 'check';

/** The steps in the order they happen; the position in this list is the number on screen. */
export const JOURNEY_STEPS: JourneyStep[] = ['folder', 'task', 'prompt', 'check'];

/** Where a step sits in the journey — the number printed next to it. */
export function journeyNumber(step: JourneyStep): number {
  return JOURNEY_STEPS.indexOf(step) + 1;
}

/** The step's own name, from the dictionaries, so both interfaces name it with the same word. */
export function journeyName(step: JourneyStep, t: Translations): string {
  return t.journey[step];
}

/** A numbered heading: "Шаг 3: Промпт" / "Step 3: Prompt". */
export function journeyHeading(step: JourneyStep, t: Translations): string {
  return `${t.journey.stepWord} ${journeyNumber(step)}: ${journeyName(step, t)}`;
}

/** A numbered sentence for a screen that keeps its own wording: "Шаг 1. Где лежат файлы…". */
export function journeySentence(step: JourneyStep, t: Translations, text: string): string {
  return `${t.journey.stepWord} ${journeyNumber(step)}. ${text}`;
}
