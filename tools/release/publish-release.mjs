#!/usr/bin/env node
/**
 * Publishes the built portable .exe as a GitHub release, with the `version.json` the app's updater
 * reads.
 *
 * The app does not talk to the GitHub API: it asks one folder — `…/releases/latest/download` — for
 * two files, `version.json` and the .exe it names. That keeps the update free (no server of your
 * own), cache-safe (the `latest` folder always points at the newest release), and private about
 * nothing: the release is public, and the app needs no token to read it.
 *
 * The manifest is written here rather than by hand, because it carries the SHA-256 of the file that
 * is being uploaded: a hash typed by a person is a hash that will one day be wrong.
 *
 * Usage:
 *   npm run release -- --notes "что изменилось"
 *   EPC_GITHUB_REPO=owner/repo npm run release
 *   npm run release -- --dry-run          (writes version.json next to the .exe and stops)
 *
 * Needs the GitHub CLI (`gh`) signed in, or `GITHUB_TOKEN` in the environment and `gh` installed —
 * the release is created through it rather than through a token of our own.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const EXE_NAME = 'Easy Project Compiler.exe';
const folderName = 'Приложение-для-тестеров';

function desktopDir() {
  const candidates = [path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')];
  return candidates.find((dir) => fs.existsSync(dir)) ?? root;
}

const argValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const notes = argValue('notes') || '';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!version || version === '0.0.0') {
  console.error('Нет версии в package.json: релиз должен иметь номер, иначе обновление не случится.');
  process.exit(1);
}

const exePath = path.resolve(
  argValue('exe') ||
    path.join(process.env.EPC_EXE_DIR ? path.resolve(process.env.EPC_EXE_DIR) : desktopDir(), folderName, EXE_NAME)
);
if (!fs.existsSync(exePath)) {
  console.error(`Не нашёл собранный файл: ${exePath}\nСначала: npm run build:desktop`);
  process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
const publishDir = path.join(root, 'build', 'release');
fs.mkdirSync(publishDir, { recursive: true });

const manifest = {
  version,
  file: EXE_NAME,
  sha256,
  ...(notes ? { notes } : {})
};
const manifestPath = path.join(publishDir, 'version.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/* A copy with the stable name the manifest promises: the release asset and the file the updater
   downloads must be the same name, or the swap looks for a file that was never written. */
const stagedExe = path.join(publishDir, EXE_NAME);
fs.copyFileSync(exePath, stagedExe);

const megabytes = (fs.statSync(stagedExe).size / 1024 / 1024).toFixed(1);
console.log(`· версия ${version}`);
console.log(`· файл ${stagedExe} (${megabytes} MB)`);
console.log(`· SHA-256 ${sha256}`);
console.log(`· манифест ${manifestPath}`);

if (dryRun) {
  console.log('\n--dry-run: файлы готовы, публикация пропущена.');
  process.exit(0);
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

const tag = `v${version}`;
try {
  gh(['--version']);
} catch {
  console.error('\nНе найден GitHub CLI (gh). Установите его или загрузите файлы вручную:');
  console.error(`  ${stagedExe}`);
  console.error(`  ${manifestPath}`);
  process.exit(1);
}

try {
  const releaseNotes = notes || `Сборка ${version}`;
  try {
    gh(['release', 'view', tag]);
    console.log(`· релиз ${tag} уже есть — обновляю файлы`);
    gh(['release', 'upload', tag, stagedExe, manifestPath, '--clobber']);
  } catch {
    gh([
      'release',
      'create',
      tag,
      stagedExe,
      manifestPath,
      '--title',
      `Easy Project Compiler ${version}`,
      '--notes',
      releaseNotes,
      '--latest'
    ]);
  }
  console.log(`\nГотово: ${tag} опубликован.`);
  console.log('Друзьям обновление придёт само — приложение спросит ленту при следующем запуске.');
} catch (error) {
  console.error('\nПубликация не удалась:', (error.stderr || error.message || String(error)).toString().trim());
  process.exit(1);
}
