import { describe, it, expect } from 'vitest';
import {
  analyzeSourceFile,
  buildLocalInsights,
  buildWorkspaceFacts,
  countCodeLines,
  isAnalyzablePath,
  judgeImplementation,
  pickFactCandidates
} from '../../server/utils/workspaceCode';

/**
 * The project map must be able to say what an imported project already contains. This is the
 * reading it is built from, and it has to stay honest: only real declarations, real imports, and a
 * status decided by the text itself.
 */

describe('workspace code facts', () => {
  it('finds the declarations and imports of a TypeScript file', () => {
    const file = [
      "import { useState } from 'react';",
      "import phaser from 'phaser';",
      '',
      'export interface PlayerState {',
      '  health: number;',
      '}',
      '',
      'export class Player {',
      '  move() {}',
      '}',
      '',
      'export function startGame() {}',
      'export const updateHud = () => {};'
    ].join('\n');

    const facts = analyzeSourceFile('src/game/Player.ts', file);

    expect(facts).not.toBeNull();
    expect(facts!.path).toBe('src/game/Player.ts');
    // In the order the file writes them, not in the order the rules were tried.
    expect(facts!.symbols).toEqual(['PlayerState', 'Player', 'startGame', 'updateHud']);
    expect(facts!.imports).toEqual(['react', 'phaser']);
    expect(facts!.status).toBe('implemented');
    // Every code line counted once: imports, declarations and their braces.
    expect(facts!.codeLines).toBe(10);
    expect(facts!.isEntryPoint).toBe(false);
  });

  it('reads a plain CommonJS file, not only one that uses export', () => {
    const file = [
      "const express = require('express');",
      '',
      'async function main() {',
      '  await serve();',
      '}',
      '',
      'exports.start = main;',
      'exports.stop = () => process.exit(0);'
    ].join('\n');

    const facts = analyzeSourceFile('src/server/start.js', file);

    expect(facts!.symbols).toEqual(['main', 'start', 'stop']);
    expect(facts!.imports).toEqual(['express']);
    expect(facts!.status).toBe('implemented');
    // A file that only boots the process is an entry point, not an empty module.
    expect(analyzeSourceFile('src/index.js', file)!.isEntryPoint).toBe(true);
  });

  it('reads a Unity script the same way C# is written', () => {
    const file = [
      'using UnityEngine;',
      'using UnityEngine.InputSystem;',
      '',
      'public class PlayerController : MonoBehaviour',
      '{',
      '    private float speed = 5f;',
      '',
      '    private void HandleMovement()',
      '    {',
      '        transform.Translate(Vector3.forward * speed * Time.deltaTime);',
      '    }',
      '',
      '    public void OnJump()',
      '    {',
      '        // jump',
      '    }',
      '}'
    ].join('\n');

    const facts = analyzeSourceFile('Assets/Scripts/PlayerController.cs', file);

    expect(facts!.symbols).toContain('PlayerController');
    expect(facts!.symbols).toContain('HandleMovement');
    expect(facts!.symbols).toContain('OnJump');
    expect(facts!.imports).toEqual(['UnityEngine', 'UnityEngine.InputSystem']);
    expect(facts!.status).toBe('implemented');
  });

  it('reads GDScript functions, signals and preloads', () => {
    const file = [
      'extends CharacterBody2D',
      'class_name Player',
      '',
      'signal died',
      'const Bullet = preload("res://scenes/Bullet.tscn")',
      '',
      'func _physics_process(delta):',
      '\tvelocity.y += 980 * delta',
      '\tmove_and_slide()',
      '',
      'func jump():',
      '\tvelocity.y = -400'
    ].join('\n');

    const facts = analyzeSourceFile('scripts/player/Player.gd', file);

    expect(facts!.symbols).toContain('_physics_process');
    expect(facts!.symbols).toContain('jump');
    expect(facts!.symbols).toContain('Player');
    expect(facts!.symbols).toContain('died');
    expect(facts!.imports).toContain('CharacterBody2D');
    expect(facts!.imports).toContain('res://scenes/Bullet.tscn');
  });

  it('tells an unwritten file from a written one', () => {
    // A file that only holds a comment is empty, no matter how long it is.
    const empty = analyzeSourceFile(
      'src/Empty.ts',
      ['// TODO: implement the inventory', '', '/* nothing here yet', '   still nothing */'].join('\n')
    );
    expect(empty!.codeLines).toBe(0);
    expect(empty!.status).toBe('empty');

    // An explicit "not implemented" body is a stub, not a finished module.
    const stub = analyzeSourceFile('src/Shop.ts', ['export function buyItem() {', "  throw new Error('Not implemented');", '}'].join('\n'));
    expect(stub!.status).toBe('stub');

    // A real file with one leftover TODO is still mostly written.
    const marked = analyzeSourceFile(
      'src/Cart.ts',
      [
        '// TODO: extract pricing',
        'export class Cart {',
        ...Array.from({ length: 34 }, (_, i) => `  method${i}() { return ${i}; }`),
        '}'
      ].join('\n')
    );
    expect(marked!.codeLines).toBeGreaterThan(30);
    expect(marked!.status).toBe('partial');
  });

  it('counts only real code lines', () => {
    const { totalLines, codeLines } = countCodeLines(
      ['// comment', '', 'const a = 1;', '   ', '# another comment', 'return a;'].join('\n')
    );

    expect(totalLines).toBe(6);
    expect(codeLines).toBe(2);
  });

  it('never invents a status for text that is not source code', () => {
    expect(analyzeSourceFile('README.md', '# Project')).toBeNull();
    expect(analyzeSourceFile('package.json', '{}')).toBeNull();
    expect(isAnalyzablePath('src/App.tsx')).toBe(true);
    expect(isAnalyzablePath('assets/logo.png')).toBe(false);
  });

  it('builds the project-wide picture from the files that were read', () => {
    const facts = buildWorkspaceFacts([
      {
        path: 'src/main.tsx',
        content: [
          "import { createRoot } from 'react-dom/client';",
          "import { App } from './App';",
          '',
          "const root = createRoot(document.getElementById('root')!);",
          'root.render(<App />);'
        ].join('\n')
      },
      {
        path: 'src/App.tsx',
        content: 'export function App() { return null; }\nexport const ready = true;'
      },
      { path: 'src/services/api.ts', content: 'export function fetchTasks() { return []; }' },
      { path: 'src/tests/api.test.ts', content: "describe('api', () => { it('works', () => {}); });" },
      { path: 'src/utils/helpers.ts', content: 'export function todo() {\n  // TODO\n}' },
      // Read but not analysed: a file the app cannot make facts from
      { path: 'package.json' }
    ]);

    expect(facts.scannedFiles).toBe(6);
    expect(facts.analyzedFiles).toBe(5);
    // The bootstrap file wins over App.tsx: it is the one that starts the app.
    expect(facts.detectedArchitecture.mainEntry).toBe('src/main.tsx');
    expect(facts.detectedArchitecture.hasTests).toBe(true);
    expect(facts.detectedArchitecture.componentsOrScriptsCount).toBe(3);
    // Two-line modules count as partial: a single short function is not a finished file.
    expect(facts.detectedArchitecture.implementedFiles).toBe(0);
    expect(facts.detectedArchitecture.stubFiles).toBe(2);
    expect(facts.detectedArchitecture.emptyFiles).toBe(0);
    expect(facts.files.find((file) => file.path === 'src/main.tsx')!.status).toBe('partial');
  });

  it('skips files it cannot read or should not: non-code, huge, and beyond the cap', () => {
    const candidates = pickFactCandidates(
      [
        { path: 'README.md', sizeBytes: 100 },
        { path: 'assets/hero.png', sizeBytes: 900 },
        { path: 'src/generated/bundle.ts', sizeBytes: 900_000 },
        { path: 'src/deep/nested/thing.ts', sizeBytes: 100 },
        { path: 'src/App.tsx', sizeBytes: 100 }
      ],
      { maxFiles: 1 }
    );

    expect(candidates).toEqual(['src/App.tsx']);
  });

  it('answers without an AI provider from the measured facts alone', () => {
    const facts = buildWorkspaceFacts([
      { path: 'src/main.ts', content: "import { app } from './app';\napp();\napp();" },
      { path: 'src/app.ts', content: 'export function app() {\n  // TODO: wire the UI\n}' }
    ]);

    const insights = buildLocalInsights(facts, true);

    expect(insights.engine).toBeUndefined();
    expect(insights.overall).toContain('Реализовано');
    expect(insights.overall).toContain('src/main.ts');
    expect(insights.files.map((file) => file.path)).toContain('src/main.ts');
    expect(insights.nextSteps.join(' ')).toContain('нет тестов');
    expect(insights.generatedAt).toBeTruthy();
  });
});

describe('implementation status', () => {
  it('is decided by the text, not by the extension', () => {
    expect(judgeImplementation('', 0, 0)).toBe('empty');
    expect(judgeImplementation('export function a() {}', 1, 1)).toBe('partial');
    expect(judgeImplementation('class A {}\nclass B {}', 40, 6)).toBe('implemented');
    expect(judgeImplementation('// TODO\npass', 1, 0)).toBe('stub');
  });
});
