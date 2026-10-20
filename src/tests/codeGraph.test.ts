import { describe, it, expect } from 'vitest';

import {
  buildGraph,
  findMentionPaths,
  normalizeGraphPath,
  parseImports,
  planContext,
  resolveImport,
  symbolFromPath,
  type GraphFile
} from '../../server/services/codeGraph';

/**
 * The graph's promises, pinned where the code lives:
 *   - it reads the import syntax this app's users actually write, and invents no edges;
 *   - a bare package name never turns into a file path inside the folder;
 *   - the plan orders seed, import, importer, test, mention — not the alphabet;
 *   - the budget cuts the tail, keeps the seeds, and the same input gives the same plan.
 */

const files: GraphFile[] = [
  { path: 'src/types.ts', text: 'export interface User { id: string }\n' },
  { path: 'src/api.ts', text: "import { User } from './types';\nexport function getUser(): User { return { id: '1' }; }\n" },
  { path: 'src/App.tsx', text: "import { getUser } from './api';\nimport React from 'react';\n" },
  { path: 'src/index.ts', text: "export * from './App';\n" },
  { path: 'src/api.test.ts', text: "import { getUser } from './api';\n" },
  { path: 'src/legacy.js', text: "const api = require('./api');\n" },
  { path: 'src/util/index.ts', text: 'export const noop = () => {};\n' },
  { path: 'src/other.ts', text: "import { noop } from './util';\n" }
];

const graph = buildGraph(files);

describe('parseImports', () => {
  it('reads ES imports, side effects, requires, dynamic imports and re-exports', () => {
    const refs = parseImports(`
      import React from 'react';
      import type { User } from './types';
      import './styles.css';
      export * from './index';
      const lazy = import('./lazy');
      const api = require('./api');
    `);
    const specs = refs.map((ref) => ref.specifier);

    expect(specs).toContain('react');
    expect(specs).toContain('./types');
    expect(specs).toContain('./styles.css');
    expect(specs).toContain('./index');
    expect(specs).toContain('./lazy');
    expect(specs).toContain('./api');
  });

  it('reads Python, C# and native includes without a parser', () => {
    const refs = parseImports(`
      from .models import Player
      from app.config import settings
      import os
      using MyGame.Core;
      #include "engine.h"
    `);
    const specs = refs.map((ref) => ref.specifier);

    expect(specs).toContain('.models');
    expect(specs).toContain('app.config');
    expect(specs).toContain('MyGame.Core');
    expect(specs).toContain('engine.h');
    // The standard library is not a file in the folder, and `os` is a bare name.
    expect(refs.find((ref) => ref.specifier === 'os')?.kind).toBe('bare');
  });

  it('never repeats a specifier it already saw', () => {
    const refs = parseImports("import a from './x';\nimport b from './x';\nrequire('./x');");
    expect(refs.filter((ref) => ref.specifier === './x')).toHaveLength(1);
  });
});

describe('resolveImport', () => {
  const fileSet = new Set(files.map((file) => file.path));

  it('adds the extension a relative import omits', () => {
    expect(resolveImport('src/api.ts', { specifier: './types', kind: 'relative' }, fileSet)).toBe('src/types.ts');
    expect(resolveImport('src/other.ts', { specifier: './util', kind: 'relative' }, fileSet)).toBe('src/util/index.ts');
  });

  it('reads ./x.js as ./x.ts, the way ESM TypeScript means it', () => {
    expect(resolveImport('src/App.tsx', { specifier: './api.js', kind: 'relative' }, fileSet)).toBe('src/api.ts');
  });

  it('resolves a Python relative import and a project namespace', () => {
    const python = new Set(['pkg/app.py', 'pkg/models.py', 'pkg/sub/__init__.py']);
    expect(resolveImport('pkg/app.py', { specifier: '.models', kind: 'python' }, python)).toBe('pkg/models.py');
    expect(resolveImport('pkg/app.py', { specifier: '.sub', kind: 'python' }, python)).toBe('pkg/sub/__init__.py');
  });

  it('leaves bare packages and aliases alone, even when a file shares the name', () => {
    const withNoise = new Set(['react.ts', 'src/app.ts']);
    expect(resolveImport('src/app.ts', { specifier: 'react', kind: 'bare' }, withNoise)).toBeNull();
    expect(resolveImport('src/app.ts', { specifier: '@/lib/db', kind: 'bare' }, withNoise)).toBeNull();
  });

  it('never escapes the folder through ..', () => {
    expect(resolveImport('src/api.ts', { specifier: '../../secrets', kind: 'relative' }, fileSet)).toBeNull();
  });
});

describe('buildGraph', () => {
  it('knows both directions of every edge it can resolve', () => {
    expect(graph.nodes.get('src/api.ts')?.imports).toEqual(['src/types.ts']);
    expect(graph.importers.get('src/api.ts')?.sort()).toEqual(['src/App.tsx', 'src/api.test.ts', 'src/legacy.js']);
  });

  it('keeps external packages out of the file graph and names them separately', () => {
    expect(graph.nodes.get('src/App.tsx')?.external).toContain('react');
    expect(graph.packages).toContain('react');
    expect([...graph.nodes.keys()]).not.toContain('react');
  });

  it('marks the tests it can see', () => {
    expect(graph.nodes.get('src/api.test.ts')?.isTest).toBe(true);
    expect(graph.nodes.get('src/api.ts')?.isTest).toBe(false);
  });
});

describe('planContext', () => {
  it('orders the context seed, import, importer, test — the way the change propagates', () => {
    // `src/index.ts` re-exports App, not api: one hop, so it is honestly absent.
    const entries = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 60_000, maxFiles: 12 });

    expect(entries[0]).toMatchObject({ path: 'src/api.ts', reason: 'seed', hop: 1 });
    expect(entries.map((entry) => `${entry.path}:${entry.reason}`)).toEqual([
      'src/api.ts:seed',
      'src/types.ts:import',
      'src/App.tsx:importer',
      'src/legacy.js:importer',
      'src/api.test.ts:test'
    ]);
  });

  it('puts an importer above a test, because a broken signature breaks code before it breaks a check', () => {
    const entries = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 60_000, maxFiles: 12 });
    const importer = entries.findIndex((entry) => entry.reason === 'importer');
    const test = entries.findIndex((entry) => entry.reason === 'test');
    expect(importer).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(importer);
  });

  it('keeps the seeds and cuts the tail of the budget, not the head of the alphabet', () => {
    const entries = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 10, maxFiles: 12 });

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('src/api.ts');
  });

  it('never spends more than the budget on anything the graph brought in', () => {
    const entries = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 80, maxFiles: 12 });
    const spent = entries.reduce((sum, entry) => sum + entry.chars, 0);
    expect(entries[0].reason).toBe('seed');
    // The seed may overshoot a tiny budget; nothing after it may.
    expect(spent - entries[0].chars).toBeLessThanOrEqual(80);
  });

  it('honours maxFiles even when the budget is wide open', () => {
    const entries = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 60_000, maxFiles: 3 });
    expect(entries).toHaveLength(3);
  });

  it('walks a second hop only when asked to', () => {
    const oneHop = planContext({ seeds: ['src/App.tsx'], graph, budgetChars: 60_000, maxFiles: 12 });
    const twoHops = planContext({ seeds: ['src/App.tsx'], graph, budgetChars: 60_000, maxFiles: 12, secondHop: true });

    expect(oneHop.some((entry) => entry.hop === 2)).toBe(false);
    expect(twoHops.some((entry) => entry.hop === 2)).toBe(true);
  });

  it('does not loop on a cycle', () => {
    const cyclic = buildGraph([
      { path: 'a.ts', text: "import './b';" },
      { path: 'b.ts', text: "import './a';" }
    ]);
    const entries = planContext({ seeds: ['a.ts'], graph: cyclic, budgetChars: 60_000, maxFiles: 12, secondHop: true });

    expect(entries.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps a seed that does not exist yet, at no cost', () => {
    const entries = planContext({ seeds: ['src/new.ts'], graph, budgetChars: 60_000, maxFiles: 12 });
    expect(entries).toEqual([{ path: 'src/new.ts', reason: 'seed', hop: 1, chars: 0 }]);
  });

  it('gives the same plan for the same graph', () => {
    const once = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 60_000, maxFiles: 12 });
    const twice = planContext({ seeds: ['src/api.ts'], graph, budgetChars: 60_000, maxFiles: 12 });
    expect(once).toEqual(twice);
  });
});

describe('findMentionPaths', () => {
  it('finds a symbol used without an import, on word boundaries only', () => {
    const hits = findMentionPaths(
      [
        { path: 'src/Hud.ts', text: 'const hp = PlayerHealth.Instance;' },
        { path: 'src/PlayerHealthBar.ts', text: 'export const PlayerHealthBar = 1;' },
        { path: 'src/Empty.ts', text: 'export const nothing = 1;' }
      ],
      ['PlayerHealth']
    );

    expect(hits).toEqual(['src/Hud.ts']);
  });

  it('ignores symbols too short to be meaningful', () => {
    expect(findMentionPaths([{ path: 'a.ts', text: 'id' }], ['id'])).toEqual([]);
  });
});

describe('path helpers', () => {
  it('normalizes separators and a leading ./', () => {
    expect(normalizeGraphPath('.\\src\\App.tsx')).toBe('src/App.tsx');
  });

  it('names a file by its symbol', () => {
    expect(symbolFromPath('Assets/Scripts/PlayerHealth.cs')).toBe('PlayerHealth');
    expect(symbolFromPath('src/index.ts')).toBe('index');
  });
});
