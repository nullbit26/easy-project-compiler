import type { FileFacts, ProjectFile, ProjectMap, WorkspaceFacts } from '../types';

/**
 * The map may only claim what the files themselves prove, so the facts the server read are attached
 * to the real paths here. Anything the scan did not read keeps whatever the import already knew.
 */

function pathKey(filePath: string): string {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

export function factsByPath(facts?: WorkspaceFacts | null): Map<string, FileFacts> {
  const index = new Map<string, FileFacts>();
  (facts?.files || []).forEach((file) => {
    const key = pathKey(file.path);
    if (key && !index.has(key)) index.set(key, file);
  });
  return index;
}

export function itemFactsFor(file: ProjectFile, facts?: WorkspaceFacts | null): FileFacts | null {
  return factsByPath(facts).get(pathKey(file.path)) || null;
}

/** Puts the declared symbols and the how-finished-it-is status onto the project map's files. */
export function attachFactsToFiles(files: ProjectFile[], facts?: WorkspaceFacts | null): ProjectFile[] {
  const index = factsByPath(facts);
  if (index.size === 0) return files;

  return files.map((file) => {
    const fact = index.get(pathKey(file.path));
    if (!fact) return file;
    return {
      ...file,
      symbols: fact.symbols.length > 0 ? fact.symbols : file.symbols,
      imports: fact.imports.length > 0 ? fact.imports : file.imports,
      codeLines: fact.codeLines,
      status: fact.status,
      type: fact.isTest ? 'test' : file.type
    };
  });
}

/** The architecture the files prove — only for the files that were really read. */
export function detectedArchitectureFromFacts(
  facts?: WorkspaceFacts | null
): ProjectMap['detectedArchitecture'] | undefined {
  if (!facts || facts.analyzedFiles === 0) return undefined;
  const arch = facts.detectedArchitecture;
  return {
    componentsOrScriptsCount: arch.componentsOrScriptsCount,
    hasTests: arch.hasTests,
    mainEntry: arch.mainEntry,
    fileCount: facts.analyzedFiles,
    implementedFiles: arch.implementedFiles,
    stubFiles: arch.stubFiles,
    emptyFiles: arch.emptyFiles
  };
}

export function countFilesByStatus(files: ProjectFile[]): Record<'implemented' | 'partial' | 'stub' | 'empty', number> {
  const counts = { implemented: 0, partial: 0, stub: 0, empty: 0 };
  files.forEach((file) => {
    if (file.status) counts[file.status] += 1;
  });
  return counts;
}
