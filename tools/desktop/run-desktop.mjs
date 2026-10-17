#!/usr/bin/env node
/**
 * Runs the desktop app straight from this checkout: builds the web app, bundles the server and the
 * shell, then starts Electron on the result.
 *
 * It is the same code the packaged .exe runs — only without the portable wrapper — so it is the
 * fast way to look at a change, and it accepts the same self-test flag:
 *
 *   npm run desktop
 *   npm run desktop -- --self-test=C:/temp/report.json
 *
 * The developer's own state is used by default (data/ in this project, the same keys and connected
 * folder as `npm run dev`); point EPC_APP_DIR somewhere else to start from a clean slate instead.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const stageApp = path.join(root, 'build', 'desktop', 'app');

const prepare = spawnSync(process.execPath, [path.join(here, 'build-desktop.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, EPC_DESKTOP_ASSETS_ONLY: '1' }
});
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const bundledElectron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const electron = fs.existsSync(bundledElectron) ? bundledElectron : 'electron';
const main = path.join(stageApp, 'main.cjs');
if (!fs.existsSync(main)) {
  console.error(`Не нашёл собранное приложение: ${main}`);
  process.exit(1);
}

const child = spawn(electron, [main, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Where the app keeps data, and where it reads the built web app from, for an unpackaged run.
    EPC_APP_DIR: process.env.EPC_APP_DIR || root,
    EPC_DIST_DIR: path.join(stageApp, 'dist')
  }
});

child.on('exit', (code) => process.exit(code ?? 0));
