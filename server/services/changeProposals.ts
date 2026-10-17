import fs from 'fs';
import { Type } from '../ai/geminiProvider';
import { callAiJson, getEngineLabel } from '../ai/aiProvider';
import { WorkspaceError, getWorkspaceRoot, resolveWorkspacePath, toRelativePath } from '../store/workspaceStore';
import { readWorkspaceTextFile, scanWorkspace } from './workspaceFiles';

/**
 * The one place where "the AI proposes real file content" happens. Both the normal
 * generate-changes flow and the repair flow that follows a failed check run through here, so
 * every proposal is reviewed and applied the same way.
 *
 * Nothing is written to disk in this module — it only reads context and returns proposals.
 */

const fileChangesSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          action: { type: Type.STRING },
          reason: { type: Type.STRING },
          content: { type: Type.STRING }
        },
        required: ['path', 'action', 'reason', 'content']
      }
    }
  },
  required: ['summary', 'changes']
};

export interface ProposedChange {
  path: string;
  action: 'create' | 'update' | 'delete';
  content: string;
  reason: string;
  exists: boolean;
  oldContent?: string;
  oldTruncated?: boolean;
  warnings: string[];
}

export interface ProposalRequest {
  ru: boolean;
  taskTitle: string;
  goal?: string;
  instructions?: string;
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  projectName?: string;
  projectType?: string;
  engineOrFramework?: string;
  language?: string;
  brief?: { tagline?: string; coreValue?: string } | null;
  /** Extra prompt block — used to hand the model the failing checks and their raw output. */
  extraSection?: string;
  /** Extra numbered rules appended to the standard rule list. */
  extraRules?: string[];
}

export interface ProposalOutcome {
  summary: string;
  warnings: string[];
  changes: ProposedChange[];
  root: string;
  engine: string;
}

const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_CHARS = 60_000;
const MAX_CHANGE_CHARS = 200_000;
const MAX_CHANGES = 12;

function readContext(relativePath: string): string {
  try {
    return readWorkspaceTextFile(relativePath, 12_000).content;
  } catch {
    return '';
  }
}

export async function proposeFileChanges(request: ProposalRequest): Promise<ProposalOutcome | null> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new WorkspaceError('no_workspace', 'No workspace');
  }

  const ru = request.ru;
  const goal = String(request.goal || '').trim();
  const instructions = String(request.instructions || '').trim();
  const acceptanceCriteria: string[] = Array.isArray(request.acceptanceCriteria)
    ? request.acceptanceCriteria.filter((c: unknown) => typeof c === 'string').slice(0, 8)
    : [];
  const requestedFiles: string[] = Array.isArray(request.targetFiles)
    ? request.targetFiles.filter((p: unknown) => typeof p === 'string').slice(0, MAX_CONTEXT_FILES)
    : [];

  let contextBudget = MAX_CONTEXT_CHARS;
  const contextBlocks: string[] = [];
  for (const requested of requestedFiles) {
    if (contextBudget <= 0) break;
    let relative: string;
    try {
      relative = toRelativePath(resolveWorkspacePath(requested));
    } catch {
      continue;
    }
    const content = readContext(relative).slice(0, Math.min(12_000, contextBudget));
    if (!content) continue;
    contextBudget -= content.length;
    contextBlocks.push(`### FILE: ${relative}\n\`\`\`\n${content}\n\`\`\``);
  }

  const fileIndex = scanWorkspace()
    .files.slice(0, 400)
    .map((file) => file.path)
    .join('\n');

  const brief = request.brief || {};
  const projectName = String(request.projectName || 'Project');
  const stack = [request.projectType, request.engineOrFramework, request.language]
    .filter(Boolean)
    .join(' / ');

  const rules = [
    '1. Reply only with JSON: { summary, warnings, changes: [{ path, action, reason, content }] }.',
    '2. "path" must be a RELATIVE path inside the project folder, using forward slashes (e.g. "Assets/Scripts/Player/PlayerHealth.cs"). Never absolute paths, never "..", never drive letters.',
    '3. "action" is "create", "update" or "delete". For "delete" set content to an empty string.',
    '4. For every created or updated file return the COMPLETE file content. Never use placeholders such as "// rest of the code unchanged", "..." or "// TODO: keep existing code". The file on disk is replaced byte for byte by what you return.',
    '5. Keep the existing architecture, naming style, namespaces and folder layout. Do not duplicate managers or create parallel systems for something that already exists.',
    `6. Change as few files as possible (${MAX_CHANGES} at most), and never touch .env files, keys, certificates or build output.`,
    `7. Write the summary and every reason in ${ru ? 'Russian' : 'English'}.`,
    `8. If the task cannot be done safely with the information you have, return an empty "changes" array and explain why in "warnings".`,
    ...(request.extraRules || [])
  ].join('\n');

  const prompt = `You are the code engine of Easy Project Compiler. You write real files into the user's project folder.

TASK: ${request.taskTitle}
${goal ? `GOAL: ${goal}` : ''}
${instructions ? `USER INSTRUCTIONS: ${instructions}` : ''}
${acceptanceCriteria.length ? `ACCEPTANCE CRITERIA:\n${acceptanceCriteria.map((c) => `- ${c}`).join('\n')}` : ''}

PROJECT: ${projectName}${stack ? ` (${stack})` : ''}
${brief?.tagline ? `CONCEPT: ${brief.tagline}` : ''}
${brief?.coreValue ? `CORE VALUE: ${brief.coreValue}` : ''}
${request.extraSection ? `\n${request.extraSection}\n` : ''}
EXISTING FILES IN THE PROJECT FOLDER (use these exact relative paths, do not invent folders that do not fit this structure):
${fileIndex || '(the folder is empty — create the files needed for the task)'}

CURRENT CONTENT OF THE FILES THAT MATTER FOR THIS TASK:
${contextBlocks.join('\n\n') || '(none of the selected files exist yet)'}

RULES:
${rules}`;

  const parsed = await callAiJson(prompt, fileChangesSchema);
  if (!parsed || typeof parsed !== 'object') return null;

  const warnings: string[] = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w: unknown) => typeof w === 'string' && w.trim()).slice(0, 6)
    : [];

  const rawChanges: any[] = Array.isArray(parsed.changes) ? parsed.changes.slice(0, MAX_CHANGES) : [];
  const byPath = new Map<string, ProposedChange>();

  for (const raw of rawChanges) {
    let relative: string;
    let absolute: string;
    try {
      absolute = resolveWorkspacePath(raw?.path);
      relative = toRelativePath(absolute);
    } catch (err: any) {
      warnings.push(
        ru
          ? `Пропущено «${raw?.path}»: ${err instanceof WorkspaceError ? err.message : 'недопустимый путь'}`
          : `Skipped "${raw?.path}": ${err instanceof WorkspaceError ? err.message : 'invalid path'}`
      );
      continue;
    }

    const exists = fs.existsSync(absolute);
    const action: ProposedChange['action'] = raw?.action === 'delete' ? 'delete' : exists ? 'update' : 'create';
    const content = action === 'delete' ? '' : typeof raw?.content === 'string' ? raw.content : '';

    if (action !== 'delete' && !content.trim()) {
      warnings.push(
        ru
          ? `Пропущено «${relative}»: модель вернула пустой файл.`
          : `Skipped "${relative}": the model returned an empty file.`
      );
      continue;
    }
    if (content.length > MAX_CHANGE_CHARS) {
      warnings.push(
        ru
          ? `Пропущено «${relative}»: файл слишком большой для одного прохода.`
          : `Skipped "${relative}": the file is too large for a single pass.`
      );
      continue;
    }

    const fileWarnings: string[] = [];
    let oldContent: string | undefined;
    let oldTruncated = false;

    if (exists && action === 'update') {
      try {
        const current = readWorkspaceTextFile(relative);
        oldContent = current.content;
        oldTruncated = current.truncated;
        if (!current.truncated && current.content.trim() === content.trim()) {
          warnings.push(
            ru
              ? `«${relative}» пропущен: содержимое не изменилось.`
              : `"${relative}" was skipped: the content did not change.`
          );
          continue;
        }
        if (!current.truncated) {
          const oldLines = current.content.split('\n').length;
          const newLines = content.split('\n').length;
          if (oldLines > 40 && newLines < oldLines * 0.4) {
            fileWarnings.push(
              ru
                ? 'Новая версия заметно короче старой — проверьте, не потерялся ли код.'
                : 'The new version is much shorter than the old one — check that no code was lost.'
            );
          }
          if (/(rest of (the )?(code|file)|код оста\w* без изменений|unchanged code|\.\.\. *(остальн|rest))/i.test(content)) {
            fileWarnings.push(
              ru
                ? 'В файле есть заглушка вида «остальной код без изменений» — такой файл нельзя записывать целиком.'
                : 'The file contains a placeholder like "rest of the code unchanged" — it must not be written as-is.'
            );
          }
        }
      } catch {
        // Reading the old version is best-effort; the change is still reviewable.
      }
    }

    byPath.set(relative, {
      path: relative,
      action,
      content,
      reason: typeof raw?.reason === 'string' ? raw.reason : '',
      exists,
      oldContent: oldContent ? oldContent.slice(0, 60_000) : undefined,
      oldTruncated,
      warnings: fileWarnings
    });
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    warnings,
    changes: Array.from(byPath.values()),
    root,
    engine: getEngineLabel()
  };
}
