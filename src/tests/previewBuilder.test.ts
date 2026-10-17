// @vitest-environment node
// The builder is real file-system work driven by esbuild, and esbuild refuses to run under jsdom:
// jsdom ships its own TextEncoder/Uint8Array realm, which breaks the invariant esbuild checks.
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import { buildPreview, buildPreviewPlan, listPreviewCandidates } from '../../server/services/previewBuilder';

/**
 * The preview builder is what makes the sandbox screen show a real project instead of nothing, so
 * these tests run it against real folders on disk: a small site, a game-shaped page, a script entry
 * that has to be bundled, and a broken file that has to come back as a readable diagnostic.
 *
 * A temporary folder stands in for the user's project and the store path is redirected, so the
 * developer's own workspace.json is never touched.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-preview-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Buffer): void {
  const absolute = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

describe('Preview builder', () => {
  it('1. serves a plain HTML site as one self-contained document', async () => {
    write('index.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Сайт</title><link rel="stylesheet" href="style.css"></head>',
      '<body><h1 id="title">Привет</h1><img src="logo.png"><script src="app.js"></script></body>',
      '</html>'
    ].join('\n'));
    write('style.css', 'body { background: url("bg.png"); }\n');
    write('app.js', 'document.getElementById("title").textContent = "Собрано";\n');
    write('logo.png', Buffer.from('89504e470d0a1a0a', 'hex'));
    write('bg.png', Buffer.from('89504e470d0a1a0a', 'hex'));

    const result = await buildPreview();

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('static');
    expect(result.entry).toBe('index.html');
    const html = result.html || '';
    // The page still is itself, but nothing points at the folder any more.
    expect(html).toContain('Привет');
    expect(html).not.toContain('href="style.css"');
    expect(html).not.toContain('src="app.js"');
    expect(html).toContain('data-epc-from="style.css"');
    expect(html).toContain('data-epc-from="app.js"');
    expect(html).toContain('Собрано');
    expect(html).toContain('data:image/png;base64');
    // Every build reports back to the parent window, which is what fills the console panel.
    expect(html).toContain('PREVIEW_CONSOLE_LOG');
    // A page that needed no bundling has no bundle to account for.
    expect(result.composition ?? null).toBeNull();
  });

  it('1b. names what the bundle is made of, package by package', async () => {
    // A dependency the folder really has installed: this is where bundle weight usually comes from.
    write('node_modules/heavy-dep/package.json', JSON.stringify({ name: 'heavy-dep', main: 'index.js' }));
    write('node_modules/heavy-dep/index.js', `export const heavy = ${JSON.stringify('x'.repeat(20_000))};\n`);
    write(
      'src/main.js',
      [
        'import { heavy } from "heavy-dep";',
        'import { greet } from "./greet.js";',
        // Not installed here, so it never enters the bundle — it is answered from a CDN instead.
        'import "vue";',
        'console.log(heavy.length, greet("мир"));'
      ].join('\n')
    );
    write('src/greet.js', 'export const greet = (who) => `Привет, ${who}`;\n');

    const result = await buildPreview();

    expect(result.kind).toBe('bundle');
    const composition = result.composition!;
    expect(composition).toBeTruthy();
    // The total is what the bundle really produced, so the shares below can be trusted.
    expect(composition.bytes).toBeGreaterThan(20_000);

    const heaviest = composition.parts[0];
    expect(heaviest.name).toBe('heavy-dep');
    expect(heaviest.kind).toBe('package');
    expect(heaviest.pct).toBeGreaterThan(50);

    // The folder's own files are listed as its own, with their path — not as "the app".
    expect(composition.parts.find((part) => part.name === 'src/main.js')?.kind).toBe('local');
    expect(composition.parts.find((part) => part.name === 'src/greet.js')?.bytes).toBeGreaterThan(0);

    // A package that is not installed is weight the user's machine never carries…
    expect(composition.externals).toContain('vue');
    // …so it must not be blamed for bytes that are simply not in the bundle.
    expect(composition.parts.some((part) => part.name === 'vue')).toBe(false);
    expect(composition.truncated).toBe(false);
  });

  it('1c. carries the same account of the bundle into the document the origin serves', async () => {
    // The screen runs the served plan and shows its numbers, so the plan has to carry them too —
    // otherwise the panel would only ever be filled by the in-memory fallback.
    write('node_modules/heavy-dep/package.json', JSON.stringify({ name: 'heavy-dep', main: 'index.js' }));
    write('node_modules/heavy-dep/index.js', `export const heavy = ${JSON.stringify('x'.repeat(20_000))};\n`);
    write('src/main.js', 'import { heavy } from "heavy-dep";\nconsole.log(heavy.length);\n');

    const plan = await buildPreviewPlan();

    expect(plan.ok).toBe(true);
    expect(plan.kind).toBe('bundle');
    expect(plan.composition?.parts[0]?.name).toBe('heavy-dep');
    expect(plan.composition?.bytes).toBeGreaterThan(20_000);
  });

  it('2. leaves a game page that loads its engine from a CDN alone', async () => {
    write('game.html', [
      '<!DOCTYPE html>',
      '<html><head><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.0/dist/phaser.min.js"></script></head>',
      '<body><div id="game"></div><script>new Phaser.Game({ parent: "game" });</script></body></html>'
    ].join('\n'));

    const result = await buildPreview('game.html');

    expect(result.ok).toBe(true);
    expect(result.entry).toBe('game.html');
    expect(result.html).toContain('cdn.jsdelivr.net/npm/phaser');
    expect(result.html).toContain('new Phaser.Game');
  });

  it('3. bundles a script entry, following its imports', async () => {
    write('src/main.js', 'import { greet } from "./greet.js";\nconsole.log(greet("мир"));\n');
    write('src/greet.js', 'export const greet = (who) => `Привет, ${who}`;\n');

    const result = await buildPreview();

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('bundle');
    expect(result.entry).toBe('src/main.js');
    const html = result.html || '';
    // Both files are in one script: the import never survives into the browser.
    expect(html).toContain('Привет,');
    expect(html).not.toContain('import { greet }');
    expect(html).toContain('<div id="root">');
    expect(result.diagnostics).toEqual([]);
  });

  it('4. compiles TSX and answers missing packages from a CDN instead of failing', async () => {
    write('src/App.tsx', [
      'import React from "react";',
      'export default function App() {',
      '  return <h1>Готово</h1>;',
      '}'
    ].join('\n'));

    const result = await buildPreview('src/App.tsx');

    expect(result.ok).toBe(true);
    const html = result.html || '';
    // react is not installed in this folder, so the import map has to carry it.
    expect(html).toContain('esm.sh/react');
    expect(html).toContain('esm.sh/react/jsx-runtime');
    expect(html).toContain('Готово');
    // The component is mounted when the file only exports it.
    expect(html).toContain('createRoot');
  });

  it('5. reports a broken file with the file, line and message', async () => {
    write('src/main.ts', 'const answer = ;\nexport default answer;\n');

    const result = await buildPreview();

    expect(result.ok).toBe(false);
    expect(result.html).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].file).toBe('src/main.ts');
    expect(result.diagnostics[0].line).toBe(1);
  });

  it('6. says what it can run, preferring the page over a script', () => {
    write('src/main.ts', 'export const value = 1;\n');
    write('index.html', '<!DOCTYPE html><html><body><h1>hi</h1></body></html>\n');
    write('about.html', '<!DOCTYPE html><html><body>about</body></html>\n');

    const candidates = listPreviewCandidates();

    expect(candidates[0]).toEqual({ path: 'index.html', kind: 'static' });
    expect(candidates.map((entry) => entry.path)).toContain('about.html');
    expect(candidates.map((entry) => entry.path)).toContain('src/main.ts');
    expect(candidates.find((entry) => entry.path === 'src/main.ts')?.kind).toBe('bundle');
  });

  it('7. explains an empty folder instead of showing a blank screen', async () => {
    write('README.md', '# пусто\n');

    const result = await buildPreview();

    expect(result.ok).toBe(false);
    expect(result.html).toBeNull();
    expect(result.diagnostics[0].text).toMatch(/index\.html/);
  });

  it('9. runs the finished page of a folder that also carries a loose script', async () => {
    // The shape a game folder usually has: the real page, plus a src/main.js from an earlier try.
    write('Пивной кликер.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Кликер</title></head>',
      '<body><h1>Бухово кот</h1><script>window.clicks = 0;</script></body></html>'
    ].join('\n'));
    write('src/main.js', 'const config = { type: "PHASER" };\n');

    const result = await buildPreview();

    expect(result.entry).toBe('Пивной кликер.html');
    expect(result.kind).toBe('static');
    expect(result.html).toContain('Бухово кот');
    expect(result.html).toContain('window.clicks = 0');
    // Its earlier entry still stays reachable in the picker.
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      'Пивной кликер.html',
      'src/main.js'
    ]);
  });

  it('10. bundles a page that points at TypeScript, keeping the page as the shell', async () => {
    write('index.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Моё приложение</title></head>',
      '<body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>'
    ].join('\n'));
    write('src/main.ts', 'const el = document.getElementById("root"); if (el) el.textContent = "работает";\n');

    const result = await buildPreview();

    // A page cannot run TypeScript itself, so the script entry is what runs…
    expect(result.kind).toBe('bundle');
    expect(result.entry).toBe('src/main.ts');
    // …and the page is still the shell around it.
    expect(result.html).toContain('Моё приложение');
    expect(result.html).toContain('работает');
    expect(result.html).not.toContain('/src/main.ts');
  });

  it('11. brings the engine of a game that was never installed, and somewhere to draw', async () => {
    // The shape of a hand-written game: no node_modules, the engine named only as a global.
    write('package.json', JSON.stringify({ name: 'kot', dependencies: { phaser: '^3.60.0' } }, null, 2));
    write(
      'src/main.js',
      [
        'const config = { type: Phaser.AUTO, width: 800, height: 600, parent: "game" };',
        'new Phaser.Game(config);'
      ].join('\n')
    );

    const result = await buildPreview('src/main.js');

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('bundle');
    const html = result.html || '';
    // The engine arrives as a tag in front of the bundle, at the version the folder asked for.
    expect(html).toContain(
      '<script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>'
    );
    expect((html.match(/npm\/phaser@/g) || []).length).toBe(1);
    // A canvas game needs somewhere to attach to.
    expect(html).toContain('<div id="game">');
    expect(html).toContain('new Phaser.Game');
    expect(result.warnings.join(' ')).toMatch(/phaser@3\.60\.0/);
  });

  it('12. keeps the page\'s own CDN script, and never loads the same engine twice', async () => {
    write(
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html><head><title>Кот</title>',
        '<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script></head>',
        '<body><div id="game"></div><script type="module" src="/src/game.ts"></script></body></html>'
      ].join('\n')
    );
    write('src/game.ts', 'new Phaser.Game({ type: Phaser.AUTO, parent: "game" });\n');

    const result = await buildPreview();

    expect(result.kind).toBe('bundle');
    const html = result.html || '';
    // The page's engine tag is the one that survives; the detected one is not added on top of it.
    expect((html.match(/npm\/phaser@/g) || []).length).toBe(1);
    expect(html).toContain('phaser@3.80.1');
    expect(html).toContain('Кот');
    expect(html).toContain('new Phaser.Game');
    // The page's own script tag is gone: the bundle already contains that file.
    expect(html).not.toContain('data-epc-from="src/game.ts"');
  });

  it('8. ignores an entry that points out of the folder', async () => {
    write('index.html', '<!DOCTYPE html><html><body>safe</body></html>\n');
    const outside = path.join(sandbox, 'outside.html');
    fs.writeFileSync(outside, '<!DOCTYPE html><html><body>secret</body></html>\n');

    // Both a traversal and an absolute path must fall back to the folder's own entry.
    for (const attempt of ['../outside.html', outside, '..\\outside.html']) {
      const result = await buildPreview(attempt);
      expect(result.ok).toBe(true);
      expect(result.entry).toBe('index.html');
      expect(result.html).not.toContain('secret');
    }
  });
});
