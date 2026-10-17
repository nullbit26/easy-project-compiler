import type { Translations } from '../i18n/translations';
import type { RuleFindingKind } from './rulesAudit';

/**
 * One name per kind of finding. The rules panel and the compiled-prompt screen show the same
 * findings from the same checker, so they have to name them the same way — a screen that invents
 * its own wording for "the file is not in the folder" reads like a different problem.
 */
export function ruleKindLabel(kind: RuleFindingKind, t: Translations): string {
  switch (kind) {
    case 'duplicate-line':
      return t.map.rulesAuditKindDuplicateLine;
    case 'duplicate-across-files':
      return t.map.rulesAuditKindDuplicateAcrossFiles;
    case 'contradiction':
      return t.map.rulesAuditKindContradiction;
    case 'missing-file':
      return t.map.rulesAuditKindMissingFile;
    case 'missing-command':
      return t.map.rulesAuditKindMissingCommand;
    case 'missing-frontmatter':
      return t.map.rulesAuditKindMissingFrontmatter;
    case 'inactive-frontmatter':
      return t.map.rulesAuditKindInactiveFrontmatter;
    case 'empty-document':
      return t.map.rulesAuditKindEmptyDocument;
  }
}
