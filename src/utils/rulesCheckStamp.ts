import type { RuleAuditResult } from './rulesAudit';

/**
 * What a rules check leaves behind: when the project's rules were last compared with the folder, and
 * what that comparison found.
 *
 * It lives on the project rather than on a screen because the check runs by itself after every
 * accepted batch of changes — including the batches applied from a screen the reader is not looking
 * at. A date kept in a component would be thrown away by the next navigation, which is exactly the
 * moment the answer is worth having.
 *
 * Only a real comparison is stamped: a project with no folder has nothing to compare against, so
 * nothing is recorded and the screen says "not checked yet" instead of showing a date that would
 * imply somebody looked at the rules.
 */
export interface RulesCheckStamp {
  /** ISO time of the comparison. */
  at: string;
  problems: number;
  notes: number;
  compared: { files: boolean; commands: boolean };
}

export function stampFromAudit(audit: RuleAuditResult, at: Date = new Date()): RulesCheckStamp {
  return {
    at: at.toISOString(),
    problems: audit.problems,
    notes: audit.notes,
    compared: { files: audit.compared.files, commands: audit.compared.commands }
  };
}

/**
 * Whether two stamps describe the same reading of the rules, whatever the time. Used to stay quiet:
 * a check that comes back with exactly what the last one found is worth recording, not announcing.
 */
export function sameCheckReading(a: RulesCheckStamp | null | undefined, b: RulesCheckStamp): boolean {
  if (!a) return false;
  return a.problems === b.problems && a.notes === b.notes;
}

/**
 * `16.10.2026, 14:32`. The same shape in both languages on purpose: a timestamp is not a sentence,
 * and a check time that is only understandable inside one locale is a small way of being unclear.
 */
export function formatRulesCheckTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
