import { describe, it, expect } from 'vitest';
import type { ProjectFile, WorkspaceFacts } from '../types';
import {
  attachFactsToFiles,
  countFilesByStatus,
  detectedArchitectureFromFacts,
  factsByPath
} from '../utils/fileFacts';

/**
 * The project map is built from two sources: the folder scan (paths, sizes) and the reading of the
 * files themselves. These tests keep that merge honest — a file the reading never saw must not
 * gain a status out of nowhere.
 */

const facts: WorkspaceFacts = {
  analyzedFiles: 2,
  scannedFiles: 5,
  detectedArchitecture: {
    mainEntry: 'src/main.tsx',
    componentsOrScriptsCount: 2,
    hasTests: false,
    implementedFiles: 1,
    stubFiles: 1,
    emptyFiles: 0
  },
  files: [
    {
      path: 'src/App.tsx',
      symbols: ['App', 'useTasks'],
      imports: ['react'],
      codeLines: 120,
      totalLines: 150,
      status: 'implemented',
      isEntryPoint: false,
      isTest: false
    },
    {
      path: 'src/services/api.ts',
      symbols: [],
      imports: [],
      codeLines: 4,
      totalLines: 6,
      status: 'stub',
      isEntryPoint: false,
      isTest: false
    }
  ]
};

const scanned: ProjectFile[] = [
  { path: 'src/App.tsx', type: 'code', description: 'src • 2400 B', sizeBytes: 2400 },
  { path: 'src/services/api.ts', type: 'code', description: 'src/services • 90 B', sizeBytes: 90 },
  { path: 'src/main.tsx', type: 'code', description: 'src • 300 B', sizeBytes: 300 }
];

describe('file facts on the project map', () => {
  it('attaches what the reading found and leaves the rest of the scan alone', () => {
    const merged = attachFactsToFiles(scanned, facts);

    const app = merged.find((file) => file.path === 'src/App.tsx')!;
    expect(app.symbols).toEqual(['App', 'useTasks']);
    expect(app.imports).toEqual(['react']);
    expect(app.status).toBe('implemented');
    expect(app.codeLines).toBe(120);
    // The size line the scan reported is how the user finds the file, so it stays.
    expect(app.description).toBe('src • 2400 B');
    expect(app.sizeBytes).toBe(2400);

    const api = merged.find((file) => file.path === 'src/services/api.ts')!;
    expect(api.status).toBe('stub');

    // A file nobody read keeps no status at all — the map never guesses.
    const main = merged.find((file) => file.path === 'src/main.tsx')!;
    expect(main.status).toBeUndefined();
    expect(main.symbols).toBeUndefined();
  });

  it('matches paths whatever slashes or case the tools used', () => {
    const merged = attachFactsToFiles(
      [{ path: '.\\src\\app.tsx', type: 'code' }],
      { ...facts, files: [{ ...facts.files[0], path: 'src/App.tsx' }] }
    );

    expect(merged[0].status).toBe('implemented');
    expect(merged[0].symbols).toEqual(['App', 'useTasks']);
  });

  it('keeps symbols the import already knew when the reading found none', () => {
    const merged = attachFactsToFiles(
      [{ path: 'src/services/api.ts', type: 'code', symbols: ['fetchTasks'] }],
      facts
    );

    expect(merged[0].status).toBe('stub');
    expect(merged[0].symbols).toEqual(['fetchTasks']);
  });

  it('leaves the files untouched when nothing was read', () => {
    expect(attachFactsToFiles(scanned, null)).toBe(scanned);
    expect(attachFactsToFiles(scanned, undefined)).toBe(scanned);
  });

  it('describes the architecture only from files that were really read', () => {
    const arch = detectedArchitectureFromFacts(facts);

    expect(arch).toEqual({
      mainEntry: 'src/main.tsx',
      componentsOrScriptsCount: 2,
      hasTests: false,
      fileCount: 2,
      implementedFiles: 1,
      stubFiles: 1,
      emptyFiles: 0
    });

    expect(detectedArchitectureFromFacts(null)).toBeUndefined();
    expect(detectedArchitectureFromFacts({ ...facts, analyzedFiles: 0, files: [] })).toBeUndefined();
  });

  it('counts the statuses the map shows', () => {
    expect(countFilesByStatus(attachFactsToFiles(scanned, facts))).toEqual({
      implemented: 1,
      partial: 0,
      stub: 1,
      empty: 0
    });
  });

  it('indexes facts by a canonical path', () => {
    const index = factsByPath(facts);

    expect(index.get('src/app.tsx')?.status).toBe('implemented');
    expect(factsByPath(null).size).toBe(0);
  });
});
