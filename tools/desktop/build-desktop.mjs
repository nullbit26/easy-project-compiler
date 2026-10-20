#!/usr/bin/env node
/**
 * Builds the desktop application: one portable .exe that opens its own window.
 *
 * Compared with tools/exe/build-sea.mjs (the browser-based build) this one:
 *   - wraps the same server and the same built web app in Electron, so testers see an application
 *     window instead of a browser tab and a black console window;
 *   - stamps every build with an id that is shown in the window title and in the app itself, so
 *     "which version am I looking at?" is never a guess;
 *   - keeps everything the app remembers in a `data` folder next to the .exe it was started from.
 *
 * Nothing secret is baked in: API keys are read at runtime from `data/api-keys.json` next to the
 * .exe. The build refuses to publish if the developer's own keys or connected folder would ship.
 *
 * Usage: npm run build:desktop          → Desktop/Приложение-для-тестеров
 *        EPC_EXE_DIR=... npm run build:desktop
 *        EPC_DESKTOP_WORK_DIR=... npm run build:desktop   (staging folder; a synced checkout gets one
 *                                                          outside the synced tree by itself)
 */
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { buildIcon, icoPath } from '../assets/make-icons.mjs';
import { assertExeIcon } from '../assets/exe-icon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const appFolderName = 'Приложение-для-тестеров';
const exeName = 'Easy Project Compiler.exe';

/**
 * Staging area for the Electron app: everything electron-builder needs, and nothing else.
 *
 * Windows refuses to rename a directory while anything holds a handle inside it, and a synced folder
 * holds one on the three hundred megabytes of Electron that packaging has just written — so the
 * rename electron-builder finishes with fails with EPERM, on every retry, while the staged tree can
 * be deleted and its files renamed by hand without complaint.
 *
 * So a checkout that lives in a synced folder stages outside it and copies the finished .exe into
 * the release folder, which is a file copy and syncs happily. That build used to fail with EPERM
 * until someone read this comment and set the variable by hand; asked of the path instead, the
 * command in the README works as written. `EPC_DESKTOP_WORK_DIR` still overrides where it goes.
 */
const insideSyncedFolder = /onedrive|dropbox|google drive/i.test(root);

const workDir = process.env.EPC_DESKTOP_WORK_DIR
  ? path.resolve(process.env.EPC_DESKTOP_WORK_DIR)
  : insideSyncedFolder
  ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'epc-desktop-build')
  : path.join(root, 'build', 'desktop');

if (!process.env.EPC_DESKTOP_WORK_DIR && insideSyncedFolder) {
  console.log(`· the checkout is synced (${root}); staging in ${workDir} so the packager can rename it`);
}

const stageApp = path.join(workDir, 'app');
const stageDist = path.join(workDir, 'dist');
const stageOut = path.join(workDir, 'out');

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

// No shell here on purpose: the project lives in a folder with spaces in its name, and a shell
// would split those paths apart.
function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });
}

/**
 * Copies the finished .exe into the release folder, waiting out a busy file.
 *
 * The release folder usually sits on a synced desktop, and the file being replaced — or the one
 * just produced by the packager and its signer — can be held for a moment: the copy then fails
 * with EBUSY even though the same copy succeeds a minute later by hand. Three things make it work:
 * the bytes are read and written as a stream rather than with the block-copy call, which is the
 * one that trips over a handle somebody else has open; the destination is removed before the last
 * attempt, because the file being replaced is the one those handles belong to; and every attempt
 * waits a little longer than the one before it. A copy that still fails is reported.
 */
async function publishExe(source, target, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (attempt >= attempts) fs.rmSync(target, { force: true });
      await pipeline(fs.createReadStream(source), fs.createWriteStream(target));
      return;
    } catch (error) {
      if (attempt > attempts) throw error;
      console.log(`· the release folder is busy (${error.code ?? 'error'}); trying again (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

function megabytes(filePath) {
  return `${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`;
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

/** Copies the built web app, leaving out the bundled server and source maps (not part of the UI). */
function copyWebApp() {
  fs.rmSync(stageDist, { recursive: true, force: true });
  fs.mkdirSync(stageDist, { recursive: true });
  let copied = 0;
  walk(path.join(root, 'dist'), (full) => {
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (relative.startsWith('dist/server') || relative.endsWith('.map')) return;
    const target = path.join(stageDist, path.relative(path.join(root, 'dist'), full));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(full, target);
    copied += 1;
  });
  console.log(`· copied ${copied} web asset(s)`);
  return copied;
}

/**
 * The version people are told about, and the address releases are fetched from.
 *
 * The version is the one in package.json — a release is `1.2.0` because someone said so, while the
 * build id stays what it is: a stamp that answers "which file is this". Bumping the version is the
 * only thing that makes an update happen, so it is deliberately a hand-made decision.
 *
 * The feed is `…/releases/latest/download` on GitHub, taken from `EPC_GITHUB_REPO=owner/repo` or
 * from the repository field of package.json. A checkout with neither simply builds an app that
 * never mentions updates — which is what `npm run desktop` and the tests want.
 */
function appVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return String(pkg.version || '0.0.0');
}

function updateFeed() {
  if (process.env.EPC_UPDATE_FEED) return process.env.EPC_UPDATE_FEED.trim().replace(/\/$/, '');
  const explicit = (process.env.EPC_GITHUB_REPO || '').trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const fromPackage = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const slug = explicit || githubSlug(fromPackage) || '';
  return slug ? `https://github.com/${slug}/releases/latest/download` : '';
}

/** `github:owner/repo`, git+https and both ssh spellings all become `owner/repo`. */
function githubSlug(value) {
  if (!value) return '';
  const text = String(value)
    .replace(/^git\+/, '')
    .replace(/^(https?:\/\/|ssh:\/\/)?(git@)?github\.com[:/]/i, '')
    .replace(/^github:/i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(text) ? text : '';
}

/**
 * The id every build carries: when it was made plus a fingerprint of the app that was built.
 * Two builds that differ in any file get different ids, which is what makes a stale screen
 * impossible to mistake for the current one.
 */
function buildId() {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(path.join(root, 'dist', 'index.html')));
  const files = [];
  walk(stageDist, (full) => files.push(full));
  for (const file of files.sort()) {
    hash.update(path.relative(stageDist, file));
    hash.update(fs.readFileSync(file));
  }
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${stamp}-${time}-${hash.digest('hex').slice(0, 4)}`;
}

async function bundleServer(id, builtAt, version) {
  const outfile = path.join(stageApp, 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Vite is a development-only dependency and must never be loaded by the packaged app.
    external: ['vite'],
    define: {
      __EPC_BUILD_ID__: JSON.stringify(id),
      __EPC_BUILT_AT__: JSON.stringify(builtAt),
      __EPC_VERSION__: JSON.stringify(version)
    },
    logLevel: 'warning'
  });
  console.log(`· server bundle: ${megabytes(outfile)}`);
}

async function bundleMain(id, builtAt, version, feed) {
  const outfile = path.join(stageApp, 'main.cjs');
  await esbuild.build({
    entryPoints: [path.join(here, '..', '..', 'electron', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Electron itself is provided by the runtime; the server is loaded next to this file.
    external: ['electron'],
    define: {
      __EPC_BUILD_ID__: JSON.stringify(id),
      __EPC_BUILT_AT__: JSON.stringify(builtAt),
      __EPC_VERSION__: JSON.stringify(version),
      __EPC_UPDATE_FEED__: JSON.stringify(feed)
    },
    logLevel: 'warning'
  });
  console.log(`· desktop shell: ${megabytes(outfile)}`);
}

/**
 * The bridge that lets the page's own window buttons reach the shell.
 *
 * It must be a file of its own next to main.cjs: a preload script is loaded by Chromium before the
 * page exists, so it can be neither bundled into main.cjs nor served over HTTP.
 */
async function bundlePreload() {
  const outfile = path.join(stageApp, 'preload.cjs');
  await esbuild.build({
    entryPoints: [path.join(here, '..', '..', 'electron', 'preload.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    logLevel: 'warning'
  });
  console.log(`· window bridge: ${megabytes(outfile)}`);
}

/**
 * The app icon, next to the shell that puts it on the window.
 *
 * It travels inside the package as well as into the .exe: the packaged window would inherit the
 * icon from the executable anyway, but the unpackaged run (`npm run desktop`) starts from
 * electron.exe, whose icon is Electron's — and "which of these windows is my app" is not a question
 * the developer should have to answer by reading titles.
 */
function stageIcon() {
  const target = path.join(stageApp, 'icon.ico');
  fs.copyFileSync(icoPath, target);
  console.log(`· app icon: ${megabytes(target)}`);
}

function writeStagedPackage(version) {
  const staged = {
    name: 'easy-project-compiler',
    productName: 'Easy Project Compiler',
    // Windows version resources insist on strict semver; the build id lives in the app itself,
    // in the window title and in the file's copyright line instead.
    version,
    description:
      'Easy Project Compiler — desktop edition: turns an idea into a plan, prompts and safe file changes.',
    author: 'Easy Project Compiler',
    license: 'UNLICENSED',
    main: 'main.cjs',
    private: true
  };
  fs.writeFileSync(path.join(stageApp, 'package.json'), `${JSON.stringify(staged, null, 2)}\n`, 'utf8');
}

/** Electron must never be packed away from the app: video drivers and Windows both need it next to it. */
/**
 * Removes the app's state folder from the release folder, waiting out a copy that is still running.
 *
 * The tester folder is the one the testers *use*, so it very often has the app open in it — and the
 * previous build's WebView2 cache is open with it. Windows then refuses to delete those files with
 * EBUSY, and a build that was finished in every other respect dies on a cache file. The folder has
 * to go before publishing (the check afterwards refuses to ship a release that carries somebody's
 * projects and API keys), so it is retried rather than skipped: waiting is right when the cause is
 * the app the user is looking at, and the message says what to close if it really stays open.
 */
async function desktopFolderClean(attempts = 4) {
  const stale = path.join(outDir, 'data');
  if (!fs.existsSync(stale)) return;

  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.rmSync(stale, { recursive: true, force: true });
      console.log('· removed data/ from the release folder (saved keys, connected folder, backups)');
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(
          `Публикация не удалась: папку ${stale} не удалось очистить (${error.code ?? 'ошибка'}).\n` +
            'Так бывает, когда из этой папки запущено приложение — закройте его окно и повторите сборку.'
        );
      }
      console.log(`· the release folder is in use (${error.code ?? 'error'}); trying again (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
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
 * The application folder that gets packed must hold the app and nothing of the developer's: no
 * saved keys, no connected folder, no backups of their files and no checkpoints. Checked before
 * packing, because an accidental folder here is exactly what would ship someone else's projects.
 */
function assertStageClean() {
  const forbiddenDirs = ['data', 'node_modules'];
  for (const name of forbiddenDirs) {
    const candidate = path.join(stageApp, name);
    if (fs.existsSync(candidate)) throw new Error(`Build aborted: ${candidate} would be shipped`);
  }

  const keys = readDeveloperKeys();
  if (keys.length === 0) console.log('· no local API keys were found, nothing to leak');
  else {
    const found = [];
    walk(stageApp, (file) => {
      const content = fs.readFileSync(file);
      for (const key of keys) if (content.includes(Buffer.from(key, 'utf8'))) found.push(file);
    });
    if (found.length > 0) throw new Error(`Build aborted: an API key is inside ${found[0]}`);
    console.log(`· checked ${keys.length} local API key(s): none of them are in the application`);
  }

  const connectedRoot = readDeveloperWorkspaceRoot();
  if (connectedRoot) {
    const found = [];
    walk(stageApp, (file) => {
      if (fs.readFileSync(file).includes(Buffer.from(connectedRoot, 'utf8'))) found.push(file);
    });
    if (found.length > 0) throw new Error(`Build aborted: the connected folder is inside ${found[0]}`);
    console.log(`· checked the connected folder (${connectedRoot}): it is not in the application`);
  }
}

function assertReleaseFolderClean() {
  const stateDir = path.join(outDir, 'data');
  if (fs.existsSync(stateDir)) throw new Error(`Build aborted: the release folder holds app state (${stateDir})`);

  const expected = new Set([exeName, 'КАК-ЗАПУСТИТЬ.txt']);
  const extras = fs.readdirSync(outDir).filter((name) => !expected.has(name));
  if (extras.length === 0) console.log('· the folder holds only the app and its instructions');
  else console.log(`· note: these extra entries exist in the release folder: ${extras.join(', ')}`);
}

function writeInstructions(id) {
  const lines = [
    'КАК ЗАПУСТИТЬ ПРИЛОЖЕНИЕ',
    '========================',
    '',
    '1. Положите эту папку в удобное место (она уже лежит на рабочем столе).',
    `2. Двойной щелчок по файлу: ${exeName}`,
    '3. Откроется окно приложения. Браузер не нужен — приложение работает само по себе.',
    '',
    `СБОРКА ${id}`,
    '------------------',
    'Этот же номер написан внизу слева в самом приложении (мелким шрифтом рядом с версией).',
    '',
    'ОБНОВЛЕНИЯ',
    '----------',
    'Новые версии приложение забирает само — присылать ничего не надо.',
    'При запуске оно спрашивает релиз проекта. Если там версия новее, внизу слева появится строка',
    'с номером версии: можно нажать иконку загрузки, а можно ничего не нажимать — приложение скачает',
    'обновление в фоне и поставит его при следующем запуске.',
    'Строка «… готова» значит, что новая версия уже скачана: закройте окно и откройте файл снова,',
    'или сразу нажмите иконку перезапуска рядом. Данные в папке data не теряются.',
    'Чтобы обновление могло записаться, файл приложения должен лежать в обычной папке на диске',
    '(например, на рабочем столе). На диске только для чтения или в сетевой папке приложение',
    'работает, но обновиться не сможет.',
    'Ваш .exe после обновления остаётся тем же файлом с тем же именем — ярлык не устареет.',
    '',
    'ГДЕ ПРИЛОЖЕНИЕ ХРАНИТ ДАННЫЕ',
    '============================',
    'Рядом с .exe приложение создаёт папку data:',
    '  data/проекты и настройки приложения',
    '  data/api-keys.json  — ключи API, если вы их вставили',
    '  data/workspace.json — папка проекта, которую вы подключили',
    '  data/workspace-backups/ — копии файлов, сделанные перед записью',
    'Ничего никуда больше не пишется. Чтобы начать с полного нуля, закройте приложение',
    'и удалите эту папку data.',
    '',
    'ПЕРВЫЙ ЗАПУСК',
    '------------',
    'Приложение открывается пустым: внутри нет ни одного проекта и не подключена ни одна папка.',
    'Начните с кнопки «Создать проект»: опишите идею или импортируйте структуру своей папки.',
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
    '- Закрытие окна останавливает приложение полностью. Повторный запуск ничего не дублирует.',
    '- Приложение уже запущено, а вы запускаете ещё раз: окно просто поднимется наверх.',
    '- Запускаете новую сборку поверх открытой старой: старое окно закроется само,',
    '  и откроется новая версия — тот самый номер сборки будет в заголовке окна.',
    '- Если Windows покажет синее окно «Система Windows защитила ваш компьютер»:',
    '  «Подробнее» → «Выполнить в любом случае». Так бывает у новых программ без',
    '  цифровой подписи — это не вирус.',
    '- Приложение не запускается: антивирус может блокировать новые .exe — разрешите',
    `  запуск для файла ${exeName}.`,
    '- Первый запуск занимает несколько секунд: .exe распаковывает себя во временную папку.',
    '',
    'ЧТО НЕ РАБОТАЕТ',
    '--------------',
    '- Только Windows.',
    '- Нужен установленный Microsoft Edge WebView2 или Windows 10/11 — на современных системах',
    '  он уже есть и ничего доустанавливать не надо.',
    ''
  ];

  const target = path.join(outDir, 'КАК-ЗАПУСТИТЬ.txt');
  fs.writeFileSync(target, '\uFEFF' + lines.join('\r\n'), 'utf8');
  return target;
}

async function main() {
  step('1/8 Building the web app (vite build)');
  run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

  step('2/8 Preparing the app icon from the logo');
  buildIcon();

  step('3/8 Staging the built web app');
  copyWebApp();

  step('4/8 Stamping this build');
  const id = buildId();
  const builtAt = new Date().toISOString();
  const version = appVersion();
  const feed = updateFeed();
  console.log(`· build id: ${id}`);
  console.log(`· built at: ${builtAt}`);
  console.log(`· version: ${version}${feed ? ` (обновления с ${feed})` : ' (лента обновлений не задана)'}`
  );

  step('5/8 Bundling the server and the desktop shell (esbuild)');
  fs.rmSync(stageApp, { recursive: true, force: true });
  fs.mkdirSync(stageApp, { recursive: true });
  await bundleServer(id, builtAt, version);
  await bundleMain(id, builtAt, version, feed);
  await bundlePreload();
  fs.cpSync(stageDist, path.join(stageApp, 'dist'), { recursive: true });
  stageIcon();
  writeStagedPackage(version);

  step('6/8 Checking that nothing of the developer’s ships inside the app');
  assertStageClean();

  // `npm run desktop` stops here: it runs Electron straight on this staged app, which is the fast
  // way to look at a change without packing and unpacking a portable .exe every time.
  if (process.env.EPC_DESKTOP_ASSETS_ONLY === '1') {
    fs.writeFileSync(
      path.join(workDir, 'assets-info.json'),
      `${JSON.stringify({ buildId: id, builtAt, app: stageApp }, null, 2)}\n`,
      'utf8'
    );
    console.log(`\nПриложение подготовлено, упаковка пропущена (EPC_DESKTOP_ASSETS_ONLY=1).`);
    console.log(`  Приложение:   ${stageApp}`);
    console.log(`  Номер сборки: ${id}`);
    return;
  }

  step('7/8 Packing the portable .exe (electron-builder)');
  fs.rmSync(stageOut, { recursive: true, force: true });
  const { build } = await import('electron-builder');
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
  ).version;
  // electron-builder's programmatic build() takes command-line shaped options, where `win` is the
  // list of targets; the configuration itself goes under `config`. The two `win` keys are not the
  // same thing and mixing them up fails with "types is not iterable".
  await build({
    win: ['portable'],
    x64: true,
    publish: 'never',
    config: {
      electronVersion,
      appId: 'ru.easyprojectcompiler.desktop',
      productName: 'Easy Project Compiler',
      // Shown in the file's properties on the Details tab, so support can read the build id off
      // the .exe itself without starting it.
      copyright: `Easy Project Compiler — сборка ${id}`,
      directories: { app: stageApp, output: stageOut },
      files: ['main.cjs', 'preload.cjs', 'server.cjs', 'package.json', 'icon.ico', 'dist/**/*'],
      asar: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      buildDependenciesFromSource: false,
      removePackageScripts: true,
      win: {
        // The mark of the app, on the file and on its window: the same .ico the shell loads at
        // runtime, generated from the logo by buildIcon() a few steps above.
        icon: icoPath,
        // Unsigned by design; the instructions explain the Windows SmartScreen prompt.
        artifactName: exeName
      },
      portable: {
        artifactName: exeName,
        requestExecutionLevel: 'user',
        /**
         * Where the portable launcher unpacks the app before running it.
         *
         * This must not be one shared folder: the launcher wipes its unpack folder before it
         * extracts, so a shared one means launching the .exe a second time deletes the files the
         * copy that is already running was started from — "I double-clicked again and my app broke".
         * A per-launch folder (NSIS's own $PLUGINSDIR) keeps two copies out of each other's way,
         * and lets the app itself then sort out which copy should be on screen.
         *
         * electron-builder's documentation says `false` does this, but its implementation defines
         * a fixed folder for both `false` and the default — the one value that leaves the folder
         * per-launch is any other non-string truthy value. That is what the packaged check
         * (npm run test:desktop, phase 3) verifies: two copies must not share an unpack folder.
         */
        unpackDirName: true
      }
    }
  });

  step('8/8 Publishing the folder for testers');
  fs.mkdirSync(outDir, { recursive: true });
  await desktopFolderClean();
  const builtExe = path.join(stageOut, exeName);
  if (!fs.existsSync(builtExe)) {
    const found = fs.existsSync(stageOut) ? fs.readdirSync(stageOut).join(', ') : '(no output folder)';
    throw new Error(`The portable .exe was not produced. Output folder holds: ${found}`);
  }
  const finalExe = path.join(outDir, exeName);
  await publishExe(builtExe, finalExe);
  const instructions = writeInstructions(id);
  assertReleaseFolderClean();
  // Not "the packager was told to use the icon" but "the published file really carries the logo":
  // the icon is read back out of the .exe and compared with the one the build started from.
  console.log(`· icon in the published .exe: ${assertExeIcon(finalExe, icoPath)}`);

  fs.writeFileSync(
    path.join(stageOut, 'build-info.json'),
    `${JSON.stringify({ buildId: id, builtAt, exe: finalExe }, null, 2)}\n`,
    'utf8'
  );

  console.log('\nГотово.');
  console.log(`  Папка для тестеров: ${outDir}`);
  console.log(`  Приложение:         ${finalExe} (${megabytes(finalExe)})`);
  console.log(`  Инструкция:         ${instructions}`);
  console.log(`  Номер сборки:       ${id}  (показан внизу слева в приложении, рядом с версией)`);
  console.log('\nПриложение открывается в своём окне, а не в браузере. Отправляйте тестерам папку целиком (или её zip).');
}

main().catch((error) => {
  console.error('\nСборка не удалась:', error?.message ?? error);
  process.exit(1);
});
