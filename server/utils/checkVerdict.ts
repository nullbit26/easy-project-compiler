import { checkEvidenceHeadline, failedCheckLines, type CheckEvidence } from '../../src/utils/checkEvidence';

/**
 * What a real check run does to a verdict it disagrees with.
 *
 * A reviewer that read prose could call a task finished while the folder does not compile — that is
 * exactly what the beginner loop kept doing: "0%" from the model, and a task marked done next to a
 * failing type check. The facts here come from commands the app ran in the folder, so they outrank
 * the model's opinion: a failed check cannot be 100% and cannot be "Completed", whatever the answer
 * said.
 *
 * The correction is written into the same fields the screen already shows — a warning naming the
 * failed command, and, if the model left the missing list empty, what has to be fixed — so nothing
 * has to know this exists to display it.
 */
export interface GuardableReview {
  status: string;
  progressPercent: number;
  warnings: string[];
  missingCriteria: string[];
  continuationPrompt: string;
}

export function guardReviewAgainstChecks<T extends GuardableReview>(
  review: T,
  evidence: CheckEvidence | null | undefined,
  isRu: boolean
): T {
  const failed = failedCheckLines(evidence);
  if (failed.length === 0) return review;

  const headline = checkEvidenceHeadline(evidence, isRu);
  const warnings = review.warnings.includes(headline) ? [...review.warnings] : [headline, ...review.warnings];

  const missingCriteria = [...review.missingCriteria];
  if (missingCriteria.length === 0) {
    for (const line of failed) {
      missingCriteria.push(
        isRu
          ? `Исправить то, что нашла проверка «${line.label}»: ${line.problems[0] || 'см. вывод команды'}`
          : `Fix what the check "${line.label}" reported: ${line.problems[0] || 'see the command output'}`
      );
    }
  }

  const cappedPercent = Math.min(Math.max(0, Math.round(review.progressPercent) || 0), 90);

  return {
    ...review,
    status: review.status === 'Completed' ? 'Partially Completed' : review.status,
    progressPercent: cappedPercent,
    warnings,
    missingCriteria
  };
}
