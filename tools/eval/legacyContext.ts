import { readWorkspaceTextFile, scanWorkspace } from '../../server/services/workspaceFiles';
import { resolveWorkspacePath, toRelativePath } from '../../server/store/workspaceStore';

/**
 * The context selection exactly as it was before the import graph: up to eight files the task
 * named, 12 000 characters each inside a 60 000 budget, and the path list as the first 400 files
 * in alphabetical order.
 *
 * Frozen on purpose. An eval that compares "new" against a re-implementation of "new" measures
 * nothing, so this copy is not refactored when the real plan changes.
 */

const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_CHARS = 60_000;
const PER_FILE_CHARS = 12_000;

export interface SectionPlan {
  blocks: string;
  indexPath: string;
  /** The paths whose bodies made it into `blocks`, in order. */
  paths: string[];
  chars: number;
}

export function legacySections(requested: string[]): SectionPlan {
  let budget = MAX_CONTEXT_CHARS;
  const blocks: string[] = [];
  const paths: string[] = [];

  for (const requestedPath of requested.slice(0, MAX_CONTEXT_FILES)) {
    if (budget <= 0) break;
    let relative: string;
    try {
      relative = toRelativePath(resolveWorkspacePath(requestedPath));
    } catch {
      continue;
    }
    let content = '';
    try {
      content = readWorkspaceTextFile(relative, PER_FILE_CHARS).content;
    } catch {
      continue;
    }
    if (!content) continue;
    const cropped = content.slice(0, Math.min(PER_FILE_CHARS, budget));
    budget -= cropped.length;
    paths.push(relative);
    blocks.push(`### FILE: ${relative}\n\`\`\`\n${cropped}\n\`\`\``);
  }

  return {
    blocks: blocks.join('\n\n'),
    indexPath: scanWorkspace().files.slice(0, 400).map((file) => file.path).join('\n'),
    paths,
    chars: blocks.join('\n\n').length
  };
}
