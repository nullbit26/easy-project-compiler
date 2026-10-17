#!/usr/bin/env node
/**
 * Builds a single-file Windows application for testers.
 *
 * The result is one .exe that contains the Node.js runtime, the Express server and the whole
 * built web app. Testers double-click it: no Node.js install, no command line, no npm.
 *
 * Nothing secret is baked in: API keys are read at runtime from `data/api-keys.json` next to the
 * .exe (written when a key is pasted into the in-app settings panel) or from environment
 * variables. The build scans the produced binary for the developer's own keys and fails loudly
 * if one of them ever ends up inside it.
 *
 * Usage: npm run build:exe            → Desktop/Приложение-для-тестеров
 *        EPC_EXE_DIR=... npm run build:exe
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { buildIcon, icoPath } from '../assets/make-icons.mjs';
import { assertExeIcon, stampExeIcon } from '../assets/exe-icon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
// postject cannot handle paths containing spaces ("GITHub Repos"), so the SEA staging
// happens in the system temp folder and only the finished .exe is copied to the destination.
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-sea-'));
// Must match PACKAGED_PORT in server.ts: the packaged app keeps its own port so its browser
// storage is never shared with a development server on 3000.
const appPort = 4123;
const appFolderName = 'Приложение-для-тестеров';
const exeName = 'Easy Project Compiler.exe';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function desktopDir() {
  const candidates = [
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    path.join(os.homedir(), 'Desktop')
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? root;
}

const outDir = path.join(
  process.env.EPC_EXE_DIR ? path.resolve(process.env.EPC_EXE_DIR) : desktopDir(),
  appFolderName
);

function step(message) {
  console.log(`\n=== ${message}`);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });
}

function megabytes(filePath) {
  return `${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`;
}

function readDeveloperKeys() {
  const keyFile = path.join(root, 'data', 'api-keys.json');
  if (!fs.existsSync(keyFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return Object.values(parsed?.keys ?? {}).filter((value) => typeof value === 'string' && value.length >= 20);
  } catch {
    return [];
  }
}

function readDeveloperWorkspaceRoot() {
  const storeFile = path.join(root, 'data', 'workspace.json');
  if (!fs.existsSync(storeFile)) return '';
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return typeof parsed?.root === 'string' ? parsed.root.trim() : '';
  } catch {
    return '';
  }
}

/**
 * The developer's own state must never ship: no API keys, and no connected folder. A tester has to
 * start from a clean slate, so an accidental path baked into the binary aborts the build.
 */
function assertCleanBinary(binaryPath) {
  const binary = fs.readFileSync(binaryPath);
  const name = path.basename(binaryPath);

  const keys = readDeveloperKeys();
  if (keys.length === 0) {
    console.log('· no local API keys were found, nothing to leak (key scan skipped)');
  } else {
    const leaked = keys.filter((key) => binary.includes(Buffer.from(key, 'utf8')));
    if (leaked.length > 0) {
      throw new Error(`Build aborted: ${leaked.length} API key(s) found inside ${name}`);
    }
    console.log(`· checked ${keys.length} local API key(s): none of them are inside the binary`);
  }

  const connectedRoot = readDeveloperWorkspaceRoot();
  if (!connectedRoot) {
    console.log('· no project folder is connected here, nothing to leak (folder scan skipped)');
    return;
  }
  if (binary.includes(Buffer.from(connectedRoot, 'utf8'))) {
    throw new Error(`Build aborted: the connected folder ${connectedRoot} is inside ${name}`);
  }
  console.log(`· checked the connected folder (${connectedRoot}): it is not inside the binary`);
}

/**
 * Testers must never inherit the developer's state, so the release folder is emptied of the app's
 * own runtime data (saved keys, the connected folder, the backups of written files) before the new
 * .exe is published into it.
 */
function cleanReleaseFolder() {
  const staleData = path.join(outDir, 'data');
  if (!fs.existsSync(staleData)) return;
  fs.rmSync(staleData, { recursive: true, force: true });
  console.log('· removed data/ from the release folder (saved keys, connected folder, backups)');
}

/**
 * The folder testers receive must hold the app and nothing of the developer's: no saved keys, no
 * connected folder, no backups and no checkpoints. This is checked, not assumed, because a stale
 * data/ folder is exactly what would make a tester start with someone else's projects.
 */
function assertReleaseFolderClean() {
  const stateDir = path.join(outDir, 'data');
  if (fs.existsSync(stateDir)) {
    throw new Error(`Build aborted: the release folder still contains app state (${stateDir})`);
  }

  const expected = new Set([exeName, 'КАК-ЗАПУСТИТЬ.txt']);
  const extras = fs.readdirSync(outDir).filter((name) => !expected.has(name));
  if (extras.length === 0) {
    console.log('· the folder holds only the app and its instructions');
    return;
  }
  console.log(`· note: these extra entries exist in the release folder: ${extras.join(', ')}`);
}

function listWebAssets() {
  const distDir = path.join(root, 'dist');
  const assets = {};

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      // The bundled node server and its source map are not part of the web app.
      if (rel.startsWith('dist/server') || rel.endsWith('.map')) continue;
      assets[rel] = full;
    }
  };

  walk(distDir);
  return assets;
}

function writeInstructions() {
  const lines = [
    'КАК ЗАПУСТИТЬ ПРИЛОЖЕНИЕ',
    '========================',
    '',
    '1. Положите эту папку в удобное место (она уже лежит на рабочем столе).',
    `2. Двойной щелчок по файлу: ${exeName}`,
    '3. Через несколько секунд сам откроется браузер с приложением.',
    `   Если браузер не открылся, наберите в адресной строке: http://localhost:${appPort}`,
    '',
    'ВАЖНО',
    '-----',
    '- Чёрное окно, которое появилось вместе с приложением, закрывать нельзя:',
    '  это и есть приложение. Чтобы остановить работу, закройте это окно.',
    '- Node.js, npm и командная строка не нужны — ничего доустанавливать не надо.',
    '- Если Windows покажет синее окно «Система Windows защитила ваш компьютер»:',
    '  «Подробнее» → «Выполнить в любом случае». Так бывает у новых программ без',
    '  цифровой подписи — это не вирус.',
    '',
    'ПЕРВЫЙ ЗАПУСК',
    '------------',
    'Приложение открывается пустым: внутри нет ни одного проекта и не подключена ни одна папка.',
    `Свои проекты приложение помнит в браузере по адресу http://localhost:${appPort} —`,
    'этот адрес принадлежит только приложению и не пересекается с другими программами.',
    'Если в списке всё же остался старый проект, он лежит в настройках браузера этого адреса,',
    'а не внутри .exe: удалите его в приложении или очистите данные сайта в браузере.',
    'Ничего не выбрано за вас — начните с кнопки «Создать проект»:',
    'опишите идею или импортируйте структуру своей папки.',
    'Папку с файлами проекта приложение попросит выбрать вам — без вашего выбора оно не читает',
    'и не меняет ничего на диске.',
    '',
    'ПРО КЛЮЧИ API',
    '-------------',
    'Ключ не обязателен: без него приложение работает на встроенном локальном движке.',
    'Чтобы подключить настоящую модель, нажмите в приложении внизу слева «Ключи API»,',
    'вставьте ключ и нажмите «Проверить» — перезапуск не нужен.',
    'Ключ сохраняется только на вашем компьютере (файл data/api-keys.json рядом с приложением).',
    '',
    'ЕСЛИ ЧТО-ТО НЕ ТАК',
    '------------------',
    `- Браузер не открылся: наберите http://localhost:${appPort} вручную.`,
    '- Порт занят другой программой: приложение само возьмёт следующий свободный порт',
    `  и напишет адрес в чёрном окне (например, http://localhost:${appPort + 1}).`,
    '- Если рядом работает другой проект на 3000 — это разные приложения с разными',
    '  списками проектов, так и задумано.',
    '- Приложение не запускается: антивирус может блокировать новые .exe — разрешите',
    `  запуск для файла ${exeName}.`,
    '- Если приложение уже запущено, повторный запуск просто откроет браузер.',
    ''
  ];

  const target = path.join(outDir, 'КАК-ЗАПУСТИТЬ.txt');
  fs.writeFileSync(target, '\uFEFF' + lines.join('\r\n'), 'utf8');
  return target;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  step('1/7 Building the web app (vite build)');
  run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

  step('2/7 Preparing the app icon from the logo');
  buildIcon();

  step('3/7 Bundling the server with all dependencies (esbuild)');
  const serverBundle = path.join(buildDir, 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'server.ts')],
    outfile: serverBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Vite is a development-only dependency and must never be loaded by the packaged app.
    external: ['vite'],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info'
  });

  step('4/7 Preparing the single-executable blob');
  const blobPath = path.join(buildDir, 'sea-prep.blob');
  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  const assets = listWebAssets();
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: serverBundle,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        assets
      },
      null,
      2
    )
  );
  console.log(`· embedding ${Object.keys(assets).length} web asset(s)`);
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  step('5/7 Injecting the blob into a copy of node.exe');
  const stagedExe = path.join(buildDir, 'staged-app.exe');
  fs.copyFileSync(process.execPath, stagedExe);
  run(
    'npx',
    ['--yes', 'postject', 'staged-app.exe', 'NODE_SEA_BLOB', 'sea-prep.blob', '--sentinel-fuse', SEA_FUSE],
    { cwd: buildDir, shell: process.platform === 'win32' }
  );

  // The icon goes in after the blob, because postject rewrites the executable's resource section
  // and would carry our icon away with the rest of it.
  console.log(`· icon written into the executable (resource group ${stampExeIcon(stagedExe, icoPath)})`);

  step('6/7 Publishing the executable folder for testers');
  cleanReleaseFolder();
  const finalExe = path.join(outDir, exeName);
  fs.copyFileSync(stagedExe, finalExe);
  const instructions = writeInstructions();

  step('7/7 Checking the executable');
  // Not "the icon was written" but "the file that ships carries the logo": read back and compared.
  console.log(`· icon in the published .exe: ${assertExeIcon(finalExe, icoPath)}`);
  assertCleanBinary(finalExe);
  assertReleaseFolderClean();

  if (process.env.EPC_KEEP_TEMP !== '1') {
    fs.rmSync(buildDir, { recursive: true, force: true });
  } else {
    console.log(`· staging folder kept: ${buildDir}`);
  }

  console.log('\nГотово.');
  console.log(`  Папка для тестеров: ${outDir}`);
  console.log(`  Приложение:         ${finalExe} (${megabytes(finalExe)})`);
  console.log(`  Инструкция:         ${instructions}`);
  console.log('\nОтправляйте тестерам саму папку целиком (или её zip).');
}

main().catch((error) => {
  fs.rmSync(buildDir, { recursive: true, force: true });
  console.error('\nСборка не удалась:', error?.message ?? error);
  process.exit(1);
});
