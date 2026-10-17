import { auditRules, scriptsFromManifest, type RuleAuditResult } from '../utils/rulesAudit';
import { ruleFilesToWrite, type RuleFileToWrite, type RulesContent } from '../utils/rulesFiles';
import { stampFromAudit, type RulesCheckStamp } from '../utils/rulesCheckStamp';
import { fetchWorkspaceApi, readWorkspaceFileApi } from './api';

/**
 * One reading of the connected folder, in the shape the rules check needs: every project-relative
 * path, and the scripts the folder's package.json declares.
 *
 * Both are read together because they answer the same question — is what the rules describe still
 * there? — and both have an honest "there is nothing to read" answer: no folder at all, or a folder
 * without a package.json. The two are not the same claim, and neither is an error.
 */
export interface FolderFacts {
  root: string | null;
  /** Project-relative paths, or null when there is no folder to compare with. */
  workspacePaths: string[] | null;
  packageScripts: string[] | null;
}

export async function readFolderFacts(language?: string): Promise<FolderFacts> {
  const state = await fetchWorkspaceApi(language);
  if (!state.root) return { root: null, workspacePaths: null, packageScripts: null };

  let packageScripts: string[] | null = null;
  try {
    const manifest = await readWorkspaceFileApi('package.json');
    packageScripts = scriptsFromManifest(manifest.content);
  } catch {
    // A folder without a package.json is an answer, not a failure: no scripts are declared there.
    packageScripts = null;
  }

  return { root: state.root, workspacePaths: state.files.map((file) => file.path), packageScripts };
}

/** The comparison itself, against facts that were already read — no second walk of the folder. */
export function auditRulesWithFacts(
  documents: RuleFileToWrite[],
  facts: Pick<FolderFacts, 'workspacePaths' | 'packageScripts'>
): RuleAuditResult {
  return auditRules({
    documents,
    workspacePaths: facts.workspacePaths,
    packageScripts: facts.packageScripts
  });
}

export interface ProjectRulesCheck {
  audit: RuleAuditResult;
  /** What to keep on the project, so the screen can say when the rules were last compared. */
  stamp: RulesCheckStamp;
  facts: FolderFacts;
}

/**
 * Reads the folder and compares the documents that would be written with it. This is the whole check
 * in one call, shared by the panel and by the automatic pass that follows a written batch, so the
 * two can never end up saying different things about the same folder.
 */
export async function checkProjectRules(
  rules: RulesContent,
  projectName: string,
  language?: string,
  at: Date = new Date()
): Promise<ProjectRulesCheck> {
  const facts = await readFolderFacts(language);
  const audit = auditRulesWithFacts(ruleFilesToWrite(rules, projectName), facts);
  return { audit, stamp: stampFromAudit(audit, at), facts };
}
