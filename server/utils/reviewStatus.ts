/**
 * The verdict status is one enum, and the screen compares against it:
 * `SessionReview.tsx` asks `status === 'Completed'` and `status === 'Partially Completed'` to pick
 * the verdict's heading. A model that answers in Russian — which the reviewer is explicitly allowed
 * to do for every other field — would otherwise produce a status the screen does not recognise, and
 * a partial result rendered as a failure.
 *
 * The prompt asks for the English values in both languages; this is the belt to that pair of braces,
 * because the field decides what the human is told about their own work.
 */
export type ReviewStatus = 'Completed' | 'Partially Completed' | 'Blocked' | 'Failed';

const ALIASES: Record<string, ReviewStatus> = {
  completed: 'Completed',
  complete: 'Completed',
  done: 'Completed',
  'завершено': 'Completed',
  'выполнено': 'Completed',
  'готово': 'Completed',
  'partially completed': 'Partially Completed',
  partial: 'Partially Completed',
  'частично выполнено': 'Partially Completed',
  'частично завершено': 'Partially Completed',
  blocked: 'Blocked',
  'заблокировано': 'Blocked',
  failed: 'Failed',
  failure: 'Failed',
  'требуются исправления': 'Failed',
  'провалено': 'Failed',
  'не выполнено': 'Failed'
};

/**
 * Whatever the reviewer wrote, reduced to the enum the screen knows.
 *
 * An unrecognised word is decided by the percentage rather than dropped: 100% is a completion, and
 * anything else is partial, which is the reading that never tells a user their unfinished work is
 * finished.
 */
export function normalizeReviewStatus(raw: unknown, progressPercent: number): ReviewStatus {
  const key = String(raw ?? '').trim().toLowerCase();
  const mapped = ALIASES[key];
  if (mapped) return mapped;
  if (progressPercent >= 100) return 'Completed';
  return key === '' ? (progressPercent >= 100 ? 'Completed' : 'Partially Completed') : 'Partially Completed';
}
