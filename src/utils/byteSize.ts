import type { BuildBudgetVerdict, BuildWeight, WriteWeight } from '../services/api';

/**
 * How the app talks about sizes.
 *
 * One place for the numbers and the sentences that go with them, because the same measurement is
 * shown after a write, on the row of the history and next to the checks — and three slightly
 * different ways of saying "12 KB" is how a number stops being trustworthy.
 */

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Same size, with the sign in front — the difference between "12 KB" and "12 KB heavier". */
export function formatSignedBytes(bytes: number): string {
  if (!bytes) return '0 B';
  return `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`;
}

export function formatSignedPct(pct: number): string {
  if (!pct) return '0%';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/** Below this, a percentage is noise: 41 bytes growing to 60 KB is +146341%. */
const MEANINGFUL_PCT_BASE = 1024;

/**
 * The percentage, or nothing at all when the size it would divide by is not worth dividing by.
 * A number nobody can use is worse than no number, and the byte difference is right there anyway.
 */
function pctPart(before: number, pct: number | null, ru: boolean): string {
  if (pct === null || before < MEANINGFUL_PCT_BASE) return '';
  return `, ${formatSignedPct(pct)}`;
}

/** Files the app did not write can move the total too, so they are named instead of blamed. */
function otherChanges(weight: WriteWeight, ru: boolean): string {
  if (weight.otherBytes === null || Math.abs(weight.otherBytes) < 1024) return '';
  return ru
    ? ` Прочие изменения: ${formatSignedBytes(weight.otherBytes)}.`
    : ` Other changes: ${formatSignedBytes(weight.otherBytes)}.`;
}

/** One line for the screen that just wrote the files. */
export function weightLine(weight: WriteWeight | null | undefined, ru: boolean): string {
  if (!weight) return '';
  if (weight.projectDeltaBytes === null) return firstWeightLine(weight, ru);

  const batch = formatSignedBytes(weight.netBytes);
  const now = formatBytes(weight.projectBytes);

  const before = weight.projectBytes - weight.projectDeltaBytes;
  const delta = formatSignedBytes(weight.projectDeltaBytes);
  const pct = pctPart(before, weight.projectDeltaPct, ru);
  const head = weight.heavy ? (ru ? 'Проект стал заметно тяжелее. ' : 'The project got noticeably heavier. ') : '';

  return ru
    ? `${head}Проект теперь ${now} (было ${formatBytes(before)}, ${delta}${pct}). Эта запись: ${batch}.${otherChanges(weight, ru)}`
    : `${head}The project is now ${now} (was ${formatBytes(before)}, ${delta}${pct}). This write: ${batch}.${otherChanges(weight, ru)}`;
}

/**
 * The same measurements with no previous write to compare against.
 *
 * A first write can still be heavy — but then only the batch is known, so the sentence is about
 * the batch, and the project size is reported without a claim that it changed.
 */
export function firstWeightLine(weight: WriteWeight, ru: boolean): string {
  const batch = formatSignedBytes(weight.netBytes);
  const now = formatBytes(weight.projectBytes);
  const head = weight.heavy ? (ru ? 'Эта запись тяжёлая. ' : 'This write is heavy. ') : '';
  return ru
    ? `${head}Проект теперь ${now}. Эта запись: ${batch} — сравнивать пока не с чем.`
    : `${head}The project is now ${now}. This write: ${batch} — nothing to compare with yet.`;
}

/** The one file responsible for most of the growth, when there is one. */
export function weightDetailLine(weight: WriteWeight | null | undefined, ru: boolean): string {
  const heaviest = weight?.heaviest;
  if (!heaviest) return '';
  return ru
    ? `Больше всего вырос ${heaviest.path}: +${formatBytes(heaviest.deltaBytes)}`
    : `The biggest growth is ${heaviest.path}: +${formatBytes(heaviest.deltaBytes)}`;
}

/** Everything about one write, for a tooltip on the history row. */
export function weightTitle(weight: WriteWeight | null | undefined, ru: boolean): string {
  if (!weight) return '';
  const parts: string[] = [
    ru
      ? `Эта запись: ${formatSignedBytes(weight.netBytes)} в ${weight.files} файл(ах)`
      : `This write: ${formatSignedBytes(weight.netBytes)} across ${weight.files} file(s)`,
    ru
      ? `Проект: ${formatBytes(weight.projectBytes)} (${weight.projectFileCount} файлов)`
      : `Project: ${formatBytes(weight.projectBytes)} (${weight.projectFileCount} files)`
  ];
  if (weight.projectDeltaBytes !== null) {
    const pct = pctPart(weight.projectBytes - weight.projectDeltaBytes, weight.projectDeltaPct, ru);
    parts.push(
      ru
        ? `С прошлой записи: ${formatSignedBytes(weight.projectDeltaBytes)}${pct}`
        : `Since the previous write: ${formatSignedBytes(weight.projectDeltaBytes)}${pct}`
    );
  }
  const detail = weightDetailLine(weight, ru);
  if (detail) parts.push(detail);
  if (weight.projectTruncated) {
    parts.push(ru ? 'Файлов больше, чем просматривается: размер — оценка снизу' : 'More files than are walked: the size is a floor');
  }
  return parts.join(' • ');
}

/**
 * The built output in front of the ceiling the project set for itself.
 *
 * Nothing at all is printed when there is no ceiling: a size with no budget is the ordinary
 * report, and repeating "no budget" next to every number would be noise.
 */
export function budgetLine(budget: BuildBudgetVerdict | null | undefined, ru: boolean): string {
  // No ceiling, or a ceiling that nothing has been measured against yet: both are silence here,
  // and the screen says the second one in its own words.
  if (!budget || budget.bytes === null || budget.over === null) return '';
  const actual = formatBytes(budget.actual);
  const ceiling = formatBytes(budget.bytes);
  const over = formatBytes(Math.abs(budget.deltaBytes || 0));
  const used = budget.usedPct === null ? '' : `, ${ru ? 'использовано' : 'used'} ${budget.usedPct}%`;

  if (budget.over) {
    return ru
      ? `Бюджет превышен: сборка ${actual} при пределе ${ceiling} (перебор ${over}${used}).`
      : `Over budget: the build is ${actual} against a ${ceiling} ceiling (over by ${over}${used}).`;
  }
  return ru
    ? `Бюджет соблюдён: сборка ${actual} при пределе ${ceiling}${used}.`
    : `Within budget: the build is ${actual} against a ${ceiling} ceiling${used}.`;
}

/** How heavy the build output became, when the folder's own build really ran. */
export function buildWeightLine(build: BuildWeight | null | undefined, ru: boolean): string {
  if (!build) return '';
  const now = formatBytes(build.bytes);
  const size = ru ? `Сборка (${build.dir}): ${now}` : `Build (${build.dir}): ${now}`;
  const floor = build.truncated
    ? ru
      ? ' (не меньше — файлов больше, чем просматривается)'
      : ' (at least — more files than are walked)'
    : '';

  if (build.deltaBytes === null) {
    return `${size} — ${ru ? 'первое измерение' : 'first measurement'}${floor}`;
  }

  const before = build.bytes - build.deltaBytes;
  const pct = pctPart(before, build.deltaPct, ru);
  const head = build.heavy ? (ru ? 'Сборка заметно потяжелела. ' : 'The build got noticeably heavier. ') : '';

  return ru
    ? `${head}${size} (было ${formatBytes(before)}, ${formatSignedBytes(build.deltaBytes)}${pct})${floor}`
    : `${head}${size} (was ${formatBytes(before)}, ${formatSignedBytes(build.deltaBytes)}${pct})${floor}`;
}
