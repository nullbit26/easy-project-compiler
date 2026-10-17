/**
 * Desktop shell for Easy Project Compiler.
 *
 * The app itself is unchanged: the same Express server serves the same built web app. What changes
 * is where it is shown and where it keeps its state.
 *
 *  - It runs in its own window (Electron), not in a browser tab. Closing the window really stops
 *    the app, so a finished copy can never keep serving an old screen from behind the new one.
 *  - Everything the app remembers lives in a `data` folder next to the .exe the user actually
 *    started: the projects (the renderer's own storage), the saved API keys, the connected project
 *    folder and the backups of written files.
 *  - If another copy of the app is already open, the question is settled over the app's own
 *    loopback port *before* Chromium is given a profile: two copies cannot share one profile (they
 *    fight over Chromium's GPU cache and the second one dies), and the copy that is already running
 *    either comes to the front (same build) or closes so the new build can start (other build).
 *    A rebuilt app must show its own screen, never yesterday's.
 *
 * It is bundled by tools/desktop/build-desktop.mjs into main.cjs and loads server.cjs (built from
 * server.ts) at runtime, so the server keeps a single entry point for every way of running it.
 *
 * `--self-test=<file>` runs the whole thing without showing a window, checks it and writes a JSON
 * report — see tools/desktop/verify-desktop.mjs.
 */
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createUpdater, EXE_NAME, readStagedUpdate, scheduleUpdateInstall, stagedUpdateVersion, Updater } from './updates';
import { UpdateState } from '../src/utils/updateRules';

declare const __EPC_BUILD_ID__: string;
declare const __EPC_BUILT_AT__: string;
declare const __EPC_VERSION__: string;
declare const __EPC_UPDATE_FEED__: string;

const BUILD_ID = typeof __EPC_BUILD_ID__ === 'string' ? __EPC_BUILD_ID__ : 'dev';
const BUILT_AT = typeof __EPC_BUILT_AT__ === 'string' ? __EPC_BUILT_AT__ : '';
/**
 * The version people are told about, as opposed to the id that tells builds apart.
 *
 * A release is a number (`1.2.0`); the build id stays what it always was — a stamp that answers
 * "which file is this" without claiming anything about newer or older.
 */
const APP_VERSION = typeof __EPC_VERSION__ === 'string' ? __EPC_VERSION__ : '0.0.0';
/**
 * Where releases live: `…/releases/latest/download`, with a `version.json` in it.
 *
 * Empty in a checkout that has no repository configured (npm run desktop, the tests), which is why
 * the sidebar then simply never mentions updates.
 */
const UPDATE_FEED = (typeof __EPC_UPDATE_FEED__ === 'string' ? __EPC_UPDATE_FEED__ : '').trim();
const APP_NAME = 'Easy Project Compiler';
/** How long to wait for a copy that was asked to close to actually release the app's folder. */
const HANDOVER_TIMEOUT_MS = 20000;
const HEALTH_TIMEOUT_MS = 800;

const args = process.argv.slice(1);

function flagValue(name: string): string {
  const prefix = `--${name}=`;
  const found = args.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const selfTestTarget = flagValue('self-test');
const SELF_TEST_FILE = selfTestTarget ? path.resolve(selfTestTarget) : '';
/**
 * Which build this start-up presents itself as when it talks to a copy that is already running.
 * Only the self-test ever overrides it, to prove that another build's window steps aside.
 */
const NEGOTIATION_BUILD_ID = process.env.EPC_BUILD_ID_OVERRIDE || BUILD_ID;

const report: {
  buildId: string;
  builtAt: string;
  negotiationBuildId: string;
  checks: { name: string; ok: boolean; detail: string }[];
  passed: number;
  failed: number;
  facts: Record<string, unknown>;
  error?: string;
} = {
  buildId: BUILD_ID,
  builtAt: BUILT_AT,
  negotiationBuildId: NEGOTIATION_BUILD_ID,
  checks: [],
  passed: 0,
  failed: 0,
  facts: {}
};

function check(name: string, ok: boolean, detail = ''): void {
  report.checks.push({ name, ok: Boolean(ok), detail });
  if (ok) report.passed += 1;
  else report.failed += 1;
}

/** Requests the app made to anywhere but its own loopback server — should always be empty. */
const externalRequests: string[] = [];

/**
 * A short journal of how this run started, kept with the app's data.
 *
 * The desktop app has no console window, so "nothing happened when I started it" would otherwise be
 * impossible to answer. The last line of data/startup.log is the step the app reached; the pid in
 * front of it separates two copies running from the same folder.
 */
function journal(step: string): void {
  try {
    const file = path.join(stateDir, 'startup.log');
    fs.mkdirSync(stateDir, { recursive: true });
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > 64 * 1024) fs.writeFileSync(file, '', 'utf8');
    fs.appendFileSync(file, `${new Date().toISOString()}  pid ${process.pid}  ${BUILD_ID}  ${step}\n`, 'utf8');
  } catch {
    /* never let bookkeeping break the app */
  }
}

/** The last things the page said, for the self-test report to carry out of a window nobody sees. */
const pageConsole: string[] = [];

let mainWindow: BrowserWindow | null = null;
let windowAllClosedFired = false;
/** The update service, once the window that shows it exists. */
let updater: Updater | null = null;
/** The last thing the updater said, kept for a window that asks after the fact. */
let lastUpdateState: UpdateState = { status: 'unconfigured' };
/** The swap has been handed to its helper; quitting must not hand it over a second time. */
let updateInstallScheduled = false;

/**
 * The folder the .exe really sits in.
 *
 * The portable launcher unpacks the app into a temp folder to run it, so `process.execPath` points
 * at the temp copy; `PORTABLE_EXECUTABLE_DIR` is how it tells us where the user's file actually is.
 */
function resolveAppDir(): string {
  // EPC_APP_DIR is only for running unpackaged from the checkout (npm run desktop); it says where
  // the app should keep its data, never where a build is published.
  const override = process.env.EPC_APP_DIR;
  if (override) return path.resolve(override);
  if (!app.isPackaged) return process.cwd();
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable && fs.existsSync(portable)) return portable;
  return path.dirname(process.execPath);
}

let appDir = resolveAppDir();
let stateDir = path.join(appDir, 'data');
let profileDir = path.join(stateDir, 'app-data');
let appStateFile = path.join(stateDir, 'app-state.json');
let stateNextToApp = true;
let profileNextToApp = true;
const distDir = process.env.EPC_DIST_DIR || path.join(__dirname, 'dist');
/**
 * The page's only way back into the shell: the window buttons of the app's own title bar.
 * It sits next to this file in every build (see tools/desktop/build-desktop.mjs).
 */
const preloadPath = path.join(__dirname, 'preload.cjs');
/** Must match `SELF_TEST_SWITCH` in preload.ts: the same word, passed to the page. */
const SELF_TEST_SWITCH = '--epc-self-test';
/**
 * The app's own mark, for the window's corner and for the taskbar.
 *
 * Every build puts the generated .ico next to this file (tools/desktop/build-desktop.mjs). The
 * packaged window would take its icon from the .exe anyway; the unpackaged one would not — it starts
 * from electron.exe and would wear Electron's icon, which makes "which of these windows is my app"
 * a question the developer has to answer by reading titles. Started straight from source without a
 * build there is no file, and the window keeps whatever icon the runtime has.
 */
const iconPath = path.join(__dirname, 'icon.ico');
/** The identity Windows groups the taskbar button under; the same id electron-builder stamps. */
const APP_USER_MODEL_ID = 'ru.easyprojectcompiler.desktop';

function fallbackRoot(): string {
  return path.join(app.getPath('appData'), APP_NAME, 'data');
}

/**
 * Creates the state folder and points Chromium's profile at it, so the projects the renderer keeps
 * in its own storage sit next to the app instead of inside the tester's browser profile.
 *
 * This has to happen before `app.ready`: Chromium reads the profile location while starting up.
 */
function prepareDirs(): void {
  const useFolder = (root: string): boolean => {
    try {
      fs.mkdirSync(path.join(root, 'app-data'), { recursive: true });
      stateDir = root;
      appStateFile = path.join(stateDir, 'app-state.json');
      profileDir = path.join(stateDir, 'app-data');
      app.setPath('userData', profileDir);
      return true;
    } catch {
      return false;
    }
  };

  stateNextToApp = useFolder(path.join(appDir, 'data'));
  if (!stateNextToApp) {
    // A folder the user cannot write to (a network share, a read-only drive) must not leave them
    // without the app: fall back to the standard per-user location and say so in the report.
    profileNextToApp = false;
    try {
      fs.mkdirSync(path.join(fallbackRoot(), 'app-data'), { recursive: true });
      stateDir = fallbackRoot();
      appStateFile = path.join(stateDir, 'app-state.json');
      profileDir = path.join(stateDir, 'app-data');
      app.setPath('userData', profileDir);
    } catch {
      /* last resort: Chromium's default profile location */
      stateDir = fallbackRoot();
      appStateFile = path.join(stateDir, 'app-state.json');
      profileDir = app.getPath('userData');
    }
  }

  // The key store, the workspace file and the backups are all resolved from the working directory:
  // keep it next to the .exe so they land in the same visible folder.
  try {
    process.chdir(appDir);
  } catch {
    /* keep the inherited working directory */
  }
}

/** What a previous run of the app left behind next to the .exe. */
interface RecordedRun {
  buildId?: string;
  launchedAt?: string;
  pid?: number;
  port?: number;
  url?: string;
}

function readPreviousState(): RecordedRun {
  try {
    const parsed = JSON.parse(fs.readFileSync(appStateFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as RecordedRun) : {};
  } catch {
    return {};
  }
}

/** A small, readable record of which build ran from where — used by support and by the tests. */
function writeAppState(extra: Record<string, unknown>): void {
  const payload = {
    buildId: BUILD_ID,
    builtAt: BUILT_AT,
    appDir,
    stateDir,
    distDir,
    launchedAt: new Date().toISOString(),
    pid: process.pid,
    ...extra
  };
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(appStateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* the report and the window are what matter, not this convenience file */
  }
}

function focusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Asks the app that is already running, on its own loopback port, what it is. */
async function healthOn(port: number): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const body: any = await response.json();
    return body?.app === APP_NAME ? body : null;
  } catch {
    return null;
  }
}

async function askRunningCopy(port: number, path: string): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS * 4)
    });
    if (!response.ok) return null;
    const body: any = await response.json();
    return body?.app === APP_NAME ? body : null;
  } catch {
    return null;
  }
}

/** Waits until nothing answers on that port any more, which means that copy has really gone. */
async function waitForPortToClose(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await healthOn(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return (await healthOn(port)) === null;
}

/**
 * The outcome of the negotiation: `start` is true when this copy may go ahead; otherwise `message`
 * explains to the user which window they should use.
 */
interface Settlement {
  start: boolean;
  message?: string;
}

/**
 * Settles who gets to run, before Chromium is given a profile folder.
 *
 * Two copies of this app cannot share one profile: Chromium keeps its GPU and network caches there,
 * and the second copy dies with "GPU process isn't usable" while the first one holds those files.
 * So the question is answered here in plain Node, over the running copy's own loopback port, and
 * only afterwards is a profile prepared.
 */
async function settleWithRunningCopy(): Promise<Settlement> {
  const recorded = readPreviousState();
  const port = Number(recorded?.port);
  if (!Number.isInteger(port) || port <= 0) {
    report.facts.runningCopy = null;
    return { start: true };
  }

  const health = await healthOn(port);
  if (!health) {
    // The last run left a note behind but nothing answers there: it was closed or crashed.
    report.facts.runningCopy = null;
    return { start: true };
  }

  const runningBuild = health.build?.id;
  report.facts.runningCopy = { port, buildId: runningBuild ?? null, pid: recorded.pid ?? null };
  check('another copy of the app was found and asked what it is', true, `port ${port}, build ${runningBuild}`);

  if (runningBuild === NEGOTIATION_BUILD_ID) {
    // The same build is on screen: bring its window forward instead of starting a twin.
    const answered = await askRunningCopy(port, '/api/focus');
    report.facts.sameBuildRunning = answered ? 'brought forward' : 'could not be reached';
    check('the window that was already open came to the front', Boolean(answered), JSON.stringify(answered));
    return {
      start: false,
      message: answered
        ? ''
        : `${APP_NAME} уже запущено.${'\n\n'}Открытое окно приложения поднято наверх — работайте в нём или закройте его и запустите файл снова.`
    };
  }

  // A different build of the app is on screen. This is the case people otherwise experience as
  // "I installed the new version and still see the old one": ask the old window to close and wait
  // for the folder to be free, so the build that was just started is the one that runs.
  const asked = await askRunningCopy(port, '/api/quit');
  report.facts.otherBuildAskedToClose = Boolean(asked);

  if (!asked) {
    return {
      start: false,
      message:
        `Рядом уже запущено другое приложение на этом же порту (${port}).\n\n` +
        'Закройте то окно и запустите этот файл снова. Так у вас будет ровно та сборка, которую вы запустили.'
    };
  }

  const closed = await waitForPortToClose(port, HANDOVER_TIMEOUT_MS);
  report.facts.otherBuildClosed = closed;
  check('the build that was on screen closed so this one can start', closed, `port ${port}`);
  if (!closed) {
    return {
      start: false,
      message:
        'Предыдущая копия приложения не закрылась.\n\n' +
        'Закройте её окно и запустите этот файл снова — тогда откроется именно эта сборка.'
    };
  }

  return { start: true };
}

/**
 * The three window buttons of the app's own title bar arrive here.
 *
 * The page can ask for exactly these things and nothing else: it never gets access to the file
 * system, to Node or to the shell — only "minimise me", "maximise me", "close me".
 */
function installWindowControls(): void {
  ipcMain.on('epc:window', (event, command: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (command === 'minimize') win.minimize();
    else if (command === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (command === 'close') win.close();
  });

  ipcMain.handle('epc:window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return Boolean(win && !win.isDestroyed() && win.isMaximized());
  });
}

/**
 * What the sidebar may ask about updates, and nothing more.
 *
 * Three questions, all answered by the shell: what is the state, please look again, and please put
the downloaded build in place now. The page never names a URL, a version or a file — it cannot
point the updater at anything.
 */
function installUpdateControls(): void {
  ipcMain.handle('epc:update:state', () => lastUpdateState);
  ipcMain.handle('epc:update:check', async () => (updater ? updater.check(true) : lastUpdateState));
  ipcMain.handle('epc:update:download', async () => (updater ? updater.download() : lastUpdateState));
  ipcMain.handle('epc:update:install', () => {
    if (SELF_TEST_FILE) return { scheduled: false, reason: 'self-test' };
    const result = scheduleUpdateNow(true);
    if (result.scheduled) {
      /* The swap runs as this process closes; the script starts the app again afterwards. */
      updateInstallScheduled = true;
      setTimeout(() => app.quit(), 100);
    }
    return result;
  });
}

/**
 * Tells the helper script to put the downloaded build in place as soon as the app is gone.
 *
 * It cannot be done inside the running app: Windows answers a rename of the running portable .exe
 * with `EBUSY` (verified on a real machine), so the file is swapped by a separate process that
 * waits for this one to exit.
 */
function scheduleUpdateNow(relaunch: boolean): { scheduled: boolean; version?: string; reason?: string } {
  const result = scheduleUpdateInstall({
    updateDir: updateDir(),
    exeName: runningExeName(),
    version: APP_VERSION,
    relaunch,
    log: (line) => journal(line)
  });
  if (!result.scheduled) journal(`update: nothing scheduled — ${result.reason ?? 'unknown reason'}`);
  return result;
}

/**
 * The .exe the user actually double-clicked.
 *
 * A portable build runs from a temp folder, so `process.execPath` names a copy that disappears; the
 * launcher tells us where the file really is. Anything else (an unpacked build, a plain checkout)
 * runs the file that sits in its own folder.
 */
function runningExeName(): string {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && fs.existsSync(portable)) return path.basename(portable);
  if (app.isPackaged) return path.basename(process.execPath);
  return EXE_NAME;
}

/** `<data>/update` — next to everything else the app remembers. */
function updateDir(): string {
  return path.join(stateDir, 'update');
}

/** One state, one window: the page is only told what changed. */
function publishUpdateState(state: UpdateState): void {
  lastUpdateState = state;
  journal(`update state: ${state.status}${state.version ? ` ${state.version}` : ''}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('epc:update:state-changed', state);
  }
}

/**
 * Keeps the window honest: nothing may be cached from a previous build, nothing outside the app's
 * own origin may run in it, and links to the outside world open in the real browser.
 */
function configureSession(buildChanged: boolean): void {
  const ses = session.defaultSession;

  // A rebuilt app must never show the previous build's screen. The UI comes from the app's own
  // folder, so a stale screen can only be a cached one — drop it before the window opens.
  if (buildChanged) void ses.clearCache();

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  ses.webRequest.onHeadersReceived((details, callback) => {
    const incoming = details.responseHeaders ?? {};
    const next: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (key.toLowerCase() === 'cache-control') continue;
      next[key] = value;
    }
    const contentType = incoming['Content-Type']?.[0] ?? incoming['content-type']?.[0] ?? '';
    if (contentType.startsWith('text/html')) next['Cache-Control'] = ['no-store, must-revalidate'];
    callback({ responseHeaders: next });
  });

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const host = new URL(details.url).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') {
        externalRequests.push(`${details.resourceType} ${details.url}`);
      }
    } catch {
      /* not a network URL */
    }
    callback({});
  });
}

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 640,
    title: `${APP_NAME} ${APP_VERSION} — сборка ${BUILD_ID}`,
    backgroundColor: '#020617',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    // No light Windows title bar above a dark app: the app draws the top of the window itself
    // (src/components/TitleBar.tsx) and with it the minimise/maximise/close buttons.
    frame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The page is told when the app is checking itself, so it can leave out the launch animation:
      // the self-test measures the window it would otherwise be looking at through a curtain.
      additionalArguments: SELF_TEST_FILE ? [SELF_TEST_SWITCH] : [],
      // Missing when running the shell straight from source without a bundle: the page then simply
      // has no window buttons and behaves like the browser build.
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined
    }
  });
  win.setMenuBarVisibility(false);

  /*
   * What the page itself says, kept for the self-test report.
   *
   * A check that fails names what was wrong and never why: a badge that never appeared, a fetch
   * that never answered. The page says those things out loud, and on a machine with nobody at it the
   * report is the only place they can be heard. Electron has moved this event from positional
   * arguments to a single detail object, so both shapes are read.
   */
  win.webContents.on('console-message', (...args: unknown[]) => {
    const details = args.find((arg) => arg && typeof arg === 'object' && 'message' in (arg as object)) as
      | { level?: number | string; message?: string; lineNumber?: number }
      | undefined;
    const message = details?.message ?? (typeof args[2] === 'string' ? args[2] : '');
    const level = details?.level ?? args[1];
    if (!message) return;
    pageConsole.push(`[${String(level)}] ${message.replace(/\s+/g, ' ').trim().slice(0, 240)}`);
    if (pageConsole.length > 40) pageConsole.shift();
  });

  // The window's own title stays the one set above; the app's name and build id are drawn in the
  // app's title bar, so a page title would only fight with it.
  win.on('page-title-updated', (event) => event.preventDefault());

  // The middle button shows a different icon once the window is maximised.
  const tellRendererAboutSize = () => {
    if (!win.isDestroyed()) win.webContents.send('epc:window:maximized', win.isMaximized());
  };
  win.on('maximize', tellRendererAboutSize);
  win.on('unmaximize', tellRendererAboutSize);

  const ownOrigin = new URL(url).origin;
  // A link to the internet belongs in the user's browser, not in the app's window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(ownOrigin)) event.preventDefault();
  });

  void win.loadURL(url);
  return win;
}

/** Waits until the app shell has actually been rendered, so the checks see a real screen. */
async function waitForRender(win: BrowserWindow, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await win.webContents.executeJavaScript(
        `(document.getElementById('root')?.childElementCount ?? 0) > 0`,
        true
      );
      if (ready === true) return true;
    } catch {
      /* the page is still loading */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * Polls the page until an expression answers with something, and hands that answer back.
 *
 * `waitUntil` asks a yes/no question, which is enough for most checks. This one is for the checks
 * that need the number they were asking about: a zone that has been dragged is measured once the
 * board has drawn where the zone landed, and the answer — the gap to its neighbour — is the whole
 * point. Asking once and measuring in the same breath reads the frame the pointer left behind, which
 * is where the zone was during the drag, not where it was put down.
 */
async function waitForValue<T>(win: BrowserWindow, expression: string, timeoutMs = 6000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await win.webContents.executeJavaScript(expression, true);
      if (value !== null && value !== undefined && value !== false) return value as T;
    } catch {
      /* the page is busy rendering; ask again */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

/** Polls the page until an expression is true, so a check never races a re-render. */
async function waitUntil(win: BrowserWindow, expression: string, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await win.webContents.executeJavaScript(expression, true)) === true) return true;
    } catch {
      /* the page is busy reloading; ask again */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

/**
 * The app's own window chrome, measured in the running page.
 *
 * It also forces a scrollbar in and measures what it costs: that number is the whole difference
 * between the app's slim dark scrollbar and the grey system one. A tile is added and removed
 * again, so the page is left exactly as it was found.
 */
const LAYOUT_PROBE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  };
  const text = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');

  const bar = document.querySelector('[data-testid="app-title-bar"]');
  const sidebar = document.querySelector('aside');
  const footer = document.querySelector('[data-testid="sidebar-footer"]');
  const scroller = document.querySelector('main');

  const controls = {};
  for (const name of ['minimize', 'maximize', 'close']) {
    const el = document.querySelector('[data-window-control="' + name + '"]');
    controls[name] = el ? box(el) : null;
  }

  let scrollbarPx = null;
  if (scroller) {
    const tile = document.createElement('div');
    tile.style.height = '6000px';
    scroller.appendChild(tile);
    scrollbarPx = scroller.offsetWidth - scroller.clientWidth;
    tile.remove();
  }

  const bridge = window.desktopWindow;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    titleBar: box(bar),
    titleBarText: text(bar),
    titleBarRegion: bar ? bar.getAttribute('style') || '' : '',
    controls,
    bridge: bridge
      ? ['minimize', 'toggleMaximize', 'close', 'isMaximized', 'onMaximizedChange'].map((key) => typeof bridge[key])
      : null,
    sidebar: box(sidebar),
    sidebarOverflow: sidebar ? sidebar.scrollWidth - sidebar.clientWidth : null,
    footer: box(footer),
    footerText: text(footer),
    footerOverflow: footer ? footer.scrollWidth - footer.clientWidth : null,
    scroller: box(scroller),
    scrollbarPx,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()`;

/**
 * A project planted in the app's own storage, exactly as a saved one would be.
 * Level "Advanced" so the app opens on the dashboard and the checks look at the list, not at the
 * step-by-step helper.
 */
const SEED_PROJECT = `(() => {
  const project = {
    id: 'probe-project',
    name: 'Проверка удаления',
    projectType: 'React',
    engineOrFramework: 'React 19',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Advanced',
    phases: [],
    projectMap: {
      projectName: 'Проверка удаления',
      projectType: 'React',
      engineOrFramework: 'React 19',
      language: 'TypeScript',
      rulesFiles: [],
      files: []
    },
    recentErrors: [],
    nextBestAction: '',
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  return true;
})()`;

/** Checks the frame the app draws around itself: title bar, window buttons, scrolling. */
async function checkWindowChrome(win: BrowserWindow): Promise<void> {
  let layout: Record<string, any> | null = null;
  try {
    layout = await win.webContents.executeJavaScript(LAYOUT_PROBE, true);
  } catch (error) {
    check('the app’s own window chrome can be inspected', false, (error as Error)?.message ?? String(error));
    return;
  }
  report.facts.layout = layout;

  const bar = layout.titleBar;
  const controls = layout.controls ?? {};
  const names = ['minimize', 'maximize', 'close'];

  check(
    'the app draws its own title bar at the top of the window',
    Boolean(bar) && bar.y === 0 && bar.h >= 28 && bar.h <= 48 && bar.w === layout.viewport.w,
    JSON.stringify(bar)
  );
  check('the title bar names the app', String(layout.titleBarText).includes(APP_NAME), String(layout.titleBarText).slice(0, 80));
  check(
    'the title bar is the window’s drag handle',
    /app-region/i.test(String(layout.titleBarRegion)),
    String(layout.titleBarRegion).slice(0, 120)
  );
  check(
    'the title bar carries the minimise, maximise and close buttons',
    names.every((name) => controls[name] && controls[name].w >= 28 && controls[name].h >= 20),
    JSON.stringify(controls)
  );
  check(
    'the window buttons sit inside the title bar',
    Boolean(bar) &&
      names.every((name) => {
        const c = controls[name];
        return c && c.w > 0 && c.y >= bar.y && c.y + c.h <= bar.y + bar.h + 1;
      }),
    JSON.stringify(controls)
  );
  check(
    'the window buttons really reach the desktop shell',
    Array.isArray(layout.bridge) && layout.bridge.length === 5 && layout.bridge.every((kind: string) => kind === 'function'),
    JSON.stringify(layout.bridge)
  );
  check(
    'the scrollbar is the app’s own, not the one Windows would draw',
    typeof layout.scrollbarPx === 'number' && layout.scrollbarPx >= 8 && layout.scrollbarPx <= 14,
    `${layout.scrollbarPx}px wide (Windows draws 17px)`
  );
  check('nothing spills past the right edge of the window', layout.docOverflowX <= 0, `overflow ${layout.docOverflowX}px`);
  check(
    'the sidebar and its footer fit their column',
    layout.sidebarOverflow <= 0 && Boolean(layout.footer) && layout.footerOverflow <= 0,
    `sidebar ${layout.sidebarOverflow}px, footer ${layout.footerOverflow}px`
  );
  check(
    'the sidebar footer stays inside the window',
    Boolean(layout.footer) && layout.footer.y + layout.footer.h <= layout.viewport.h + 1,
    `footer ends at ${layout.footer ? layout.footer.y + layout.footer.h : 'n/a'}px of ${layout.viewport.h}px`
  );
  check(
    'the language switch and the API keys button are both in the footer',
    /RU/.test(layout.footerText) && /EN/.test(layout.footerText) && /API|Ключи/i.test(layout.footerText),
    String(layout.footerText).slice(0, 120)
  );

  // The build the app is running is named in exactly one place inside the app: the sidebar footer.
  // The badge asks the app's own server for it, so it is given a moment to arrive.
  await waitUntil(
    win,
    `Boolean(document.querySelector('[data-testid="sidebar-footer"]')?.innerText.includes(${JSON.stringify(BUILD_ID)}))`,
    6000
  );
  const footerText = await win.webContents.executeJavaScript(
    `(document.querySelector('[data-testid="sidebar-footer"]')?.innerText || '').replace(/\\s+/g, ' ').trim()`,
    true
  );
  report.facts.footerText = footerText;
  check('the sidebar footer names the build the app is running', String(footerText).includes(BUILD_ID), String(footerText).slice(0, 120));
  check(
    'the build id is not repeated in the title bar',
    !String(layout.titleBarText).includes(BUILD_ID),
    String(layout.titleBarText).slice(0, 80)
  );

  /*
    Two rows of two items, and not one box among them: the language on the left with the keys on
    the right, then the version and the build under them. The footer used to be four framed pills of
    equal halves; it is small print now, so the check is about the edges each row runs between and
    about the absence of a border or a background on every item in it.
  */
  const footerGrid = await win.webContents.executeJavaScript(
    `(() => {
      const footer = document.querySelector('[data-testid="sidebar-footer"]');
      if (!footer) return null;
      const rows = Array.from(footer.children).map((row) =>
        Array.from(row.children).map((cell) => {
          const r = cell.getBoundingClientRect();
          const style = getComputedStyle(cell);
          const sides = ['Top', 'Right', 'Bottom', 'Left'];
          const bordered = sides.some(
            (side) =>
              style['border' + side + 'Style'] !== 'none' &&
              parseFloat(style['border' + side + 'Width']) > 0
          );
          const painted =
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
          return {
            x: Math.round(r.x),
            w: Math.round(r.width),
            right: Math.round(r.right),
            text: (cell.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
            boxed: bordered || painted
          };
        })
      );
      const inner = footer.getBoundingClientRect();
      return { rows, innerLeft: Math.round(inner.x), innerWidth: Math.round(inner.width), innerRight: Math.round(inner.right), overflow: footer.scrollWidth - footer.clientWidth };
    })()`,
    true
  );
  report.facts.footerGrid = footerGrid;
  const rows: Array<Array<{ x: number; w: number; right: number; text: string; boxed: boolean }>> =
    footerGrid?.rows ?? [];
  check(
    'the footer is two rows of two items',
    rows.length === 2 && rows.every((row) => row.length === 2),
    JSON.stringify(footerGrid)
  );
  check(
    'nothing in the footer is drawn as a box',
    rows.length === 2 && rows.every((row) => row.every((cell) => cell.boxed === false)),
    JSON.stringify(rows.map((row) => row.map((cell) => `${cell.text}${cell.boxed ? ' [boxed]' : ''}`)))
  );
  const innerLeft = footerGrid?.innerLeft ?? 0;
  const innerRight = footerGrid?.innerRight ?? 0;
  /** The first item starts at the row's own left edge and the last one ends at its right edge. */
  const spansItsRow = (row: Array<{ x: number; right: number }>) =>
    row.length === 2 && row[0].x - innerLeft <= 6 && innerRight - row[1].right <= 6;
  check(
    'each row of the footer runs from its left edge to its right edge',
    rows.length === 2 && rows.every(spansItsRow),
    JSON.stringify({
      innerLeft,
      innerRight,
      rows: rows.map((row) => row.map((cell) => `${cell.x}..${cell.right}`))
    })
  );
  check(
    'the footer still fits its column',
    typeof footerGrid?.overflow === 'number' && footerGrid.overflow <= 0,
    `overflow ${footerGrid?.overflow}px`
  );
}

/**
 * What the window actually looks like, read from its own pixels.
 *
 * A screenshot proves something a DOM query cannot: the complaint was a light grey Windows
 * scrollbar and a system title bar above a dark app, and both of those are about colour. Windows
 * draws its scrollbar in near-white (around 240 of 255); everything the app draws in these places
 * is between 2 and 70.
 */
/**
 * A picture of the window, taken once Chromium has a frame to give.
 *
 * The self-test's window is never shown (see boot), so a capture asked for in the first moments after
 * the window exists is answered with `UnknownVizError` — there is nothing drawn yet. That is a fact
 * about the moment, not about the window: the check is "the window can be pictured", and a release
 * run has already failed on it for being asked too early. The wait is bounded and the last error is
 * the one reported, so a window that genuinely cannot be pictured still fails the check.
 */
async function pictureOfWindow(win: BrowserWindow, timeoutMs = 8000): Promise<Electron.NativeImage> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return await win.webContents.capturePage();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error('the window could not be pictured');
}

async function checkPixels(win: BrowserWindow): Promise<void> {
  let image;
  try {
    image = await pictureOfWindow(win);
  } catch (error) {
    check('the window can be pictured', false, (error as Error)?.message ?? String(error));
    return;
  }

  const size = image.getSize();
  const pixels = image.toBitmap(); // BGRA; only the sum of the channels is used
  const brightness = (x: number, y: number) => {
    const i = (Math.round(y) * size.width + Math.round(x)) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  const darkest = (what: string, points: Array<[number, number]>) => {
    const values = points.map(([x, y]) => brightness(x, y));
    const brightest = Math.max(...values);
    check(what, brightest < 90, `brightest sample ${Math.round(brightest)} of 255`);
  };

  const topRow: Array<[number, number]> = [];
  // The middle of the title bar only: the badge and the buttons live near its right edge.
  for (let x = 200; x < size.width - 320; x += 40) topRow.push([x, 8]);

  const rightEdge: Array<[number, number]> = [];
  for (let y = 150; y < size.height - 60; y += 50) rightEdge.push([size.width - 4, y]);

  darkest('the app’s own title bar is dark across the top of the window', topRow);
  darkest('the scrollbar strip along the right edge is the app’s, not Windows grey', rightEdge);
  darkest('the window is dark right into its corners', [
    [size.width - 20, size.height - 6],
    [Math.round(size.width / 2), size.height - 6]
  ]);

  report.facts.pixels = { size, brightestRightEdge: Math.max(...rightEdge.map(([x, y]) => brightness(x, y))) };
}

/**
 * Deleting a saved project, the way a user does it: the trash button on the row, then the
 * confirmation. It has to be two steps — one misclick must not throw a project away.
 */
async function checkDeleteFlow(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(SEED_PROJECT, true);
  win.webContents.reload();
  const rendered = await waitForRender(win);
  const seeded = await waitUntil(win, `document.querySelectorAll('[data-project-row]').length === 1`, 6000);
  check('a saved project shows up again after a restart', rendered && seeded, `rendered ${rendered}, row ${seeded}`);

  const pressed = await win.webContents.executeJavaScript(
    `(() => {
      const trash = document.querySelector('[data-project-delete="probe-project"]');
      if (!trash) return false;
      trash.click();
      return true;
    })()`,
    true
  );
  const dialogShown = await waitUntil(win, `Boolean(document.querySelector('[data-project-delete-confirm]'))`, 4000);
  const rowsBefore = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-project-row]').length`, true);
  check(
    'the delete button on a project row opens a confirmation',
    pressed === true && dialogShown,
    `button pressed ${pressed}, confirmation shown ${dialogShown}`
  );
  check('nothing is deleted before the confirmation is answered', rowsBefore === 1, `rows: ${rowsBefore}`);
  if (dialogShown) {
    // One more frame, so the picture is of the confirmation rather than of the instant before it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    report.facts.deleteDialogShot = await captureScreenshot(win, '-delete');
  }

  await win.webContents.executeJavaScript(
    `document.querySelector('[data-project-delete-confirm]').click()`,
    true
  );
  const gone = await waitUntil(win, `document.querySelectorAll('[data-project-row]').length === 0`, 4000);
  const after = await win.webContents.executeJavaScript(
    `(() => ({
      stored: JSON.parse(localStorage.getItem('easy_project_compiler_projects') || '[]').length,
      current: localStorage.getItem('easy_project_compiler_current_project')
    }))()`,
    true
  );
  report.facts.afterDelete = after;
  check('confirming removes the project from the app for good', gone && after?.stored === 0, JSON.stringify(after));
  check(
    'the deleted project is not left as the open one',
    after?.current === null,
    String(after?.current)
  );
}

/**
 * The plan screen as a board, from inside the window.
 *
 * Four promises are checked here, and all four are about the screen the user actually sits in front
 * of: the board fills the window instead of sitting in a column in the middle of it, a lane answers a
 * right-click with its own menu, renaming a lane from that menu sticks, and a lane dragged by its
 * header takes the cards the board laid out inside it. Each one is driven through the same events a
 * real pointer produces — a check that called the app's own internals would prove nothing about what
 * happens when a person right-clicks.
 */
async function checkPlanBoard(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(SEED_PLAN, true);
  win.webContents.reload();
  const rendered = await waitForRender(win);
  await win.webContents.executeJavaScript("location.hash = '#/plan'; true", true);

  const boardShown = await waitUntil(win, `Boolean(document.querySelector('[data-testid="plan-canvas"]'))`, 10000);
  /*
    The canvas is on screen before the plan's cards are: the screen reads the project after mounting
    and draws the tasks then, so a count read the moment the canvas appears can see three of four.
    The check is that the whole plan is on the board, so the count is waited for rather than read
    once — the same reason the dragged zone is measured with waitForValue.
  */
  const cardCount = `document.querySelectorAll('[data-testid^="plan-card-"]').length`;
  let cards = 0;
  if (boardShown) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      cards = await win.webContents.executeJavaScript(cardCount, true);
      if (cards === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  check('the plan opens as a board with the whole plan on it', rendered && boardShown && cards === 4, `cards: ${cards}`);
  if (!boardShown) return;

  const layout = await win.webContents.executeJavaScript(
    `(() => {
      const rect = (node) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, w: box.width, h: box.height }; };
      const main = document.querySelector('main');
      const board = document.querySelector('[data-testid="plan-canvas"]').parentElement;
      return { main: rect(main), board: rect(board) };
    })()`,
    true
  );
  const leftGap = Math.round(layout.board.x - layout.main.x);
  const rightGap = Math.round(layout.main.x + layout.main.w - (layout.board.x + layout.board.w));
  const bottomGap = Math.round(layout.main.y + layout.main.h - (layout.board.y + layout.board.h));
  check(
    'the board fills the working window instead of sitting in a column in the middle of it',
    leftGap < 40 && rightGap < 40,
    `${leftGap}px left, ${rightGap}px right`
  );
  // The board is the part of the screen that gets the leftover height, so it has to reach the bottom
  // edge of the working area: a band of empty slate under it is the room the board should have had.
  check(
    'the board takes the height that is left in the window',
    bottomGap < 40 && layout.board.h >= 420,
    `${Math.round(layout.board.h)}px tall, ${bottomGap}px under it`
  );

  // ------------------------------------------------------------- renaming a lane
  await win.webContents.executeJavaScript(
    `(() => {
      const lane = document.querySelector('[data-testid="plan-lane-blocked"]');
      const box = lane.getBoundingClientRect();
      lane.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: Math.round(box.left + 30), clientY: Math.round(box.top + 14)
      }));
      return true;
    })()`,
    true
  );
  const laneMenu = await waitUntil(win, `Boolean(document.querySelector('[data-testid="plan-context-menu"]'))`, 4000);
  const menuForLane = laneMenu
    ? await win.webContents.executeJavaScript(
        `document.querySelector('[data-testid="plan-context-menu"]').getAttribute('data-menu-for')`,
        true
      )
    : null;
  check('a lane answers a right-click with its own menu', laneMenu && menuForLane === 'lane-blocked', String(menuForLane));

  const typed = laneMenu
    ? await win.webContents.executeJavaScript(
        `(() => {
          const field = document.querySelector('[data-testid="plan-context-rename"]');
          if (!field) return 'no field';
          const held = field.value;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(field, 'Ждёт заказчика');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return held;
        })()`,
        true
      )
    : null;
  const renamed = await waitUntil(
    win,
    `(document.querySelector('[data-testid="plan-lane-header-blocked"]')?.innerText || '').includes('ЖДЁТ ЗАКАЗЧИКА')`,
    4000
  );
  check(
    'the menu arrives holding the lane’s own name, and renaming it renames the lane',
    typed === 'Заблокировано' && renamed,
    `field first said: ${typed}`
  );
  const kept = await win.webContents.executeJavaScript(
    `(() => {
      try {
        const project = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
        return (project.canvasLanes && project.canvasLanes.blocked && project.canvasLanes.blocked.label) || null;
      } catch { return null; }
    })()`,
    true
  );
  check('the name the user gave a lane is what the project keeps', kept === 'Ждёт заказчика', String(kept));

  // ------------------------------------------------------- moving a lane and its cards
  /*
   * The zone is dragged *down* the board, not across it.
   *
   * Two zones stand 28 world pixels apart — a 304px lane in a 332px stride — so a sideways drag of
   * any size worth testing leans on the neighbour after those 28 pixels and stops there. The check
   * used to drag 90px across and read 24px of movement, which is the board keeping its promise (a
   * zone leans against its neighbour instead of lying on it, see `separateRect`) and the check
   * asking for something the geometry cannot give: at the board's own fit, 90 screen pixels is more
   * than twice the room that exists. Empty board below the lane is where the promise can be read
   * cleanly — the zone follows the pointer the whole way, and its cards come with it — and the lean
   * itself is checked next, in the direction where it is the expected answer.
   */
  const drag = await win.webContents.executeJavaScript(
    `(() => {
      const lane = document.querySelector('[data-testid="plan-lane-blocked"]');
      const header = document.querySelector('[data-testid="plan-lane-header-blocked"]');
      const card = document.querySelector('[data-testid="plan-card-bd3"]');
      const rect = (node) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y }; };
      const from = { x: Math.round(lane.getBoundingClientRect().left + 40), y: Math.round(lane.getBoundingClientRect().top + 14) };
      const to = { x: from.x, y: from.y + 90 };
      const event = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', isPrimary: true,
        button: type === 'pointerdown' ? 0 : -1, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y
      });
      const before = { lane: rect(lane), card: rect(card) };
      header.dispatchEvent(event('pointerdown', from.x, from.y));
      window.dispatchEvent(event('pointermove', to.x, to.y));
      window.dispatchEvent(event('pointerup', to.x, to.y));
      return { before, from, to };
    })()`,
    true
  );
  const dragSaved = await waitUntil(
    win,
    `(() => {
      try {
        const project = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
        const lane = project.canvasLanes && project.canvasLanes.blocked;
        return Boolean(lane && lane.offsetY);
      } catch { return false; }
    })()`,
    4000
  );
  const after = await win.webContents.executeJavaScript(
    `(() => {
      const rect = (selector) => { const box = document.querySelector(selector).getBoundingClientRect(); return { x: box.x, y: box.y }; };
      return { lane: rect('[data-testid="plan-lane-blocked"]'), card: rect('[data-testid="plan-card-bd3"]') };
    })()`,
    true
  );
  const laneMoved = Math.round(after.lane.y - drag.before.lane.y);
  const cardMoved = Math.round(after.card.y - drag.before.card.y);
  check(
    'a lane follows the pointer when its header is dragged',
    dragSaved && Math.abs(laneMoved - (drag.to.y - drag.from.y)) <= 3,
    `moved ${laneMoved}px of ${drag.to.y - drag.from.y}px`
  );
  // The cards the board placed inside the lane are the lane's: moving it must not leave them behind.
  check(
    'the cards the board placed in a lane go with it',
    Math.abs(cardMoved - laneMoved) <= 2 && cardMoved !== 0,
    `lane ${laneMoved}px, card ${cardMoved}px`
  );

  /*
   * Sideways is the other half of the same promise: a zone pushed into its neighbour leans on it and
   * stops, so two zones never cover one patch of board. The stored offset is the evidence that the
   * gesture was taken — a zone that simply refused to move would also leave the zones apart.
   */
  await win.webContents.executeJavaScript(
    `(() => {
      const lane = document.querySelector('[data-testid="plan-lane-blocked"]');
      const header = document.querySelector('[data-testid="plan-lane-header-blocked"]');
      const box = lane.getBoundingClientRect();
      const from = { x: Math.round(box.left + 40), y: Math.round(box.top + 14) };
      const to = { x: from.x + 120, y: from.y };
      const event = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 92, pointerType: 'mouse', isPrimary: true,
        button: type === 'pointerdown' ? 0 : -1, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y
      });
      header.dispatchEvent(event('pointerdown', from.x, from.y));
      window.dispatchEvent(event('pointermove', to.x, to.y));
      window.dispatchEvent(event('pointerup', to.x, to.y));
      return true;
    })()`,
    true
  );
  const leaning = await waitUntil(
    win,
    `(() => {
      try {
        const project = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
        const lane = project.canvasLanes && project.canvasLanes.blocked;
        return Boolean(lane && lane.offsetX);
      } catch { return false; }
    })()`,
    4000
  );
  /*
   * The promise is that two zones never cover one patch of board — not that one of them stops at a
   * particular horizontal distance from the other. A pair of rectangles is what answers it, so that
   * is what is measured and reported: the promise, in the shape the promise has.
   */
  const measureApart = `(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width)
      };
    };
    const lane = box('[data-testid="plan-lane-blocked"]');
    const next = box('[data-testid="plan-lane-done"]');
    if (!lane || !next) return { gap: null, moved: null, overlap: null, lane, next };
    const overlap =
      Math.min(lane.right, next.right) - Math.max(lane.left, next.left) > 0 &&
      Math.min(lane.bottom, next.bottom) - Math.max(lane.top, next.top) > 0;
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}').canvasLanes || {};
    } catch { stored = 'unreadable'; }
    return {
      gap: Math.round(next.left - lane.right), moved: lane.left, overlap, lane, next, stored,
      viewport: window.innerWidth,
      canvas: (() => { const node = document.querySelector('[data-testid="plan-canvas"]'); return node ? getComputedStyle(node).transform : null; })()
    };
  })()`;
  // Waited for rather than read once: the zone is drawn where the pointer left it until the board
  // redraws it where it landed, and the check is about where it landed.
  const drawnApart = await waitForValue<Record<string, unknown>>(
    win,
    `(() => {
      const apart = ${measureApart};
      return apart.overlap === false ? apart : null;
    })()`,
    4000
  );
  const apart = (drawnApart ?? (await win.webContents.executeJavaScript(measureApart, true))) as Record<string, unknown>;
  check(
    'a zone pushed sideways leans on its neighbour instead of lying on it',
    leaning && drawnApart !== null,
    `two zones in one place: ${JSON.stringify(apart)}`
  );

  // ------------------------------------------------------------- renaming a card
  await win.webContents.executeJavaScript(
    `(() => {
      const card = document.querySelector('[data-testid="plan-card-bd2"]');
      const box = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: Math.round(box.left + 40), clientY: Math.round(box.top + 16)
      }));
      return true;
    })()`,
    true
  );
  const cardMenu = await waitUntil(
    win,
    `document.querySelector('[data-testid="plan-context-menu"]')?.getAttribute('data-menu-for') === 'task-bd2'`,
    4000
  );
  const cardTyped = cardMenu
    ? await win.webContents.executeJavaScript(
        `(() => {
          const field = document.querySelector('[data-testid="plan-context-rename"]');
          if (!field) return null;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(field, 'Налить пиво в стакан');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return true;
        })()`,
        true
      )
    : null;
  const cardRenamed = await waitUntil(
    win,
    `(document.querySelector('[data-testid="plan-card-bd2"]')?.innerText || '').includes('Налить пиво в стакан')`,
    4000
  );
  check('a card answers a right-click with a rename of its own task', cardMenu && cardTyped === true && cardRenamed, String(cardMenu));

  /*
   * The app's storage goes back the way the next run expects to find it.
   *
   * A plan has to be planted to have a board to work on, and the app's start-up promises — an empty
   * project list, nothing preselected — are checked at the beginning of *every* run, including the
   * one that starts after this one in the same folder. Leaving the probe project behind would make
   * the rebuilt copy report a saved project it never had. The reload is what makes the clean-up
   * real: without it the app still holds the project in memory and would write it back on its next
   * state change, which is exactly the state the app writes when it boots with nothing.
   */
  await win.webContents.executeJavaScript(
    `(() => {
      localStorage.removeItem('easy_project_compiler_projects');
      localStorage.removeItem('easy_project_compiler_current_project');
      return true;
    })()`,
    true
  );
  win.webContents.reload();
  await waitForRender(win);
}


/**
 * A plan with something on it: two phases, four tasks, one dependency. Planted the same way a saved
 * project is, so the board is opened exactly the way a user opens it.
 */
const SEED_PLAN = `(() => {
  const task = (id, phaseId, title, status, dependencies) => ({
    id,
    phaseId,
    title,
    goal: 'Цель задачи ' + id,
    status,
    relevantFiles: [],
    forbiddenFiles: [],
    acceptanceCriteria: [{ id: id + '_ac1', description: 'собирается', passed: status === 'completed' }],
    testRequirements: [],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies: dependencies || [],
    progressPercent: status === 'completed' ? 100 : 0
  });
  const project = {
    id: 'board-probe',
    name: 'Проверка доски',
    projectType: 'React',
    engineOrFramework: 'React 19',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Advanced',
    phases: [
      {
        id: 'phase_0',
        phaseNumber: 1,
        title: 'Ядро',
        purpose: 'играть',
        deliverable: 'сборка',
        tasks: [
          task('bd1', 'phase_0', 'Создать сцену', 'completed'),
          task('bd2', 'phase_0', 'Налить пиво', 'in_progress', ['bd1'])
        ]
      },
      {
        id: 'phase_1',
        phaseNumber: 2,
        title: 'Полировка',
        purpose: 'красиво',
        deliverable: 'полировка',
        tasks: [task('bd3', 'phase_1', 'Звук налива', 'blocked'), task('bd4', 'phase_1', 'Анимация пены', 'ready')]
      }
    ],
    projectMap: {
      projectName: 'Проверка доски',
      projectType: 'React',
      engineOrFramework: 'React 19',
      language: 'TypeScript',
      rulesFiles: [],
      files: []
    },
    recentErrors: [],
    nextBestAction: '',
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  return true;
})()`;

/** Runs inside the page: what the user sees, and what the app remembers. */
const PROBE = `(async () => {
  const readList = () => {
    try { return JSON.parse(localStorage.getItem('easy_project_compiler_projects') || '[]'); }
    catch { return null; }
  };
  const projects = readList();
  let health = null;
  try { health = await (await fetch('/api/health')).json(); } catch { health = null; }
  return {
    title: document.title,
    projects: Array.isArray(projects) ? projects.length : null,
    currentProject: localStorage.getItem('easy_project_compiler_current_project'),
    storageKeys: Object.keys(localStorage),
    rootChildren: document.getElementById('root')?.childElementCount ?? 0,
    asideText: (document.querySelector('aside')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
    health
  };
})()`;

async function captureScreenshot(win: BrowserWindow, suffix = ''): Promise<string> {
  try {
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    if (!size.width || !size.height) return 'empty';
    const file = `${SELF_TEST_FILE}${suffix}.png`;
    fs.writeFileSync(file, image.toPNG());
    // Only the plain shot is the one the harness expects to find.
    if (!suffix) {
      report.facts.screenshot = file;
      report.facts.screenshotSize = size;
    }
    return file;
  } catch (error) {
    return `failed: ${(error as Error)?.message ?? String(error)}`;
  }
}

async function runSelfTest(win: BrowserWindow, url: string): Promise<void> {
  const rendered = await waitForRender(win);
  check('the app shell is rendered in the window', rendered, rendered ? '' : 'no children under #root');

  /*
   * Every check below is about the screen the app settles on — the title bar, the sidebar, the board
   * — and the launch animation is drawn over all of it for the first two and a half seconds. It is a
   * real part of the window and it is checked by hand in the preview; here it would only report on
   * itself, and measuring the app through a curtain is how a layout check starts failing for a
   * reason that has nothing to do with the layout.
   *
   * The animation used to be taken out of the document by hand here. That is a page removing a node
   * React still owns: when the overlay's own timer fires and React hides it, the node is already
   * gone, the removal throws, and the app comes apart — an empty window a moment after it was
   * measured. So the shell says it is a self-test (see `additionalArguments` in createWindow) and the
   * app leaves the animation out; this checks that the word arrived.
   */
  check(
    'the app knows it is the one being checked, so no launch animation hides it',
    (await win.webContents.executeJavaScript(
      `!document.querySelector('[data-testid="launch-splash"]')`,
      true
    )) === true,
    'a launch animation was drawn over the window'
  );

  let probe: Record<string, any> | null = null;
  try {
    probe = await win.webContents.executeJavaScript(PROBE, true);
  } catch (error) {
    check('the page can be inspected', false, (error as Error)?.message ?? String(error));
  }

  if (probe) {
    report.facts.probe = probe;
    check(
      'the window asks its own server which build it is',
      probe.health?.build?.id === BUILD_ID,
      `health build ${probe.health?.build?.id ?? 'missing'}`
    );
    check(
      'the page was served by the desktop build',
      probe.health?.build?.mode === 'desktop',
      String(probe.health?.build?.mode)
    );
    check('the app opens with an empty project list', probe.projects === 0, `projects: ${probe.projects}`);
    check('no project is preselected', !probe.currentProject, String(probe.currentProject));
    check('the sidebar is on screen', (probe.asideText || '').length > 0, (probe.asideText || '').slice(0, 80));
  }

  check(
    'nothing outside the app itself was requested',
    externalRequests.length === 0,
    externalRequests.slice(0, 3).join(' | ')
  );
  check('the state folder sits next to the application', profileNextToApp && stateNextToApp, String(profileDir));
  check(
    'the state file records this build',
    fs.existsSync(appStateFile) && readPreviousState().buildId === BUILD_ID,
    appStateFile
  );

  report.facts.externalRequests = externalRequests.slice(0, 10);
  report.facts.pageConsole = pageConsole.slice(-40);

  // The frame the app draws itself, and the delete button that used to be impossible to find.
  await checkWindowChrome(win);
  await checkPixels(win);

  // Pictured last of the layout work: the build id in the footer is fetched from the app's own
  // server, so taking the picture here is what makes it show the finished screen rather than the
  // instant before the footer had its last item.
  await captureScreenshot(win);
  try {
    await checkDeleteFlow(win);
  } catch (error) {
    check('deleting a saved project can be walked through', false, (error as Error)?.message ?? String(error));
  }

  // The board, driven the way a user drives it: right-click a lane, drag its header, right-click a
  // card. It comes after the layout checks because it needs a project with a plan in it, and the
  // pixel check before it must look at the screen the app opens with.
  try {
    await checkPlanBoard(win);
  } catch (error) {
    check('the plan board can be worked on', false, (error as Error)?.message ?? String(error));
  }

  // Closing the only window must stop the app: that is what makes an old copy impossible to leave
  // running behind a newer one. The app's own close button has to do it, not just win.close().
  const closePressed = await win.webContents
    .executeJavaScript(
      `(() => {
        const button = document.querySelector('[data-window-control="close"]');
        if (!button) return false;
        button.click();
        return true;
      })()`,
      true
    )
    .catch(() => false);
  check('the app’s own close button reaches the desktop shell', closePressed === true, String(closePressed));

  const deadline = Date.now() + 5000;
  while (!windowAllClosedFired && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('closing the window stops the app', windowAllClosedFired, url);
}

interface ServerBundle {
  /** See startServer() in server.ts: the shell hands it its two window controls. */
  startServer: (hooks?: { focus?: () => void; quit?: () => void }) => Promise<{ port: number; url: string }>;
}

function loadServerBundle(): ServerBundle {
  // Loaded dynamically on purpose: the server file is built next to this one and is not part of
  // this bundle, so that `npm start`, the single-executable build and this shell share one server.
  const serverPath = path.join(__dirname, 'server.cjs');
  process.env.EPC_EMBEDDED = '1';
  process.env.EPC_DESKTOP = '1';
  process.env.EPC_STATE_DIR = stateDir;
  // The packaged app never serves Vite's development middleware; it serves the built dist folder.
  process.env.NODE_ENV = 'production';
  if (!process.env.EPC_DIST_DIR) process.env.EPC_DIST_DIR = distDir;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(serverPath);
}

async function boot(): Promise<void> {
  const previous = readPreviousState();
  const buildChanged = Boolean(previous.buildId) && previous.buildId !== BUILD_ID;

  Object.assign(report.facts, {
    appDir,
    stateDir,
    profileDir,
    stateNextToApp,
    profileNextToApp,
    distDir,
    buildChanged,
    previousBuildId: previous.buildId ?? null,
    execPath: process.execPath,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR ?? null,
    isPackaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    selfTest: Boolean(SELF_TEST_FILE)
  });

  const { startServer } = loadServerBundle();
  journal('server bundle loaded');
  // The app answers these two calls from its own server: bring this window forward, or close it
  // because a different build is starting. Plain Node decides who runs; see settleWithRunningCopy.
  const { port, url } = await startServer({
    focus: focusWindow,
    quit: () => app.quit()
  });
  journal(`server listening on ${url}`);

  configureSession(buildChanged);
  externalRequests.length = 0; // count only what the app itself requests while it starts
  writeAppState({ port, url, buildChanged, previousBuildId: previous.buildId ?? null });
  report.facts.port = port;
  report.facts.url = url;

  mainWindow = createWindow(url);
  journal('window created');

  if (!SELF_TEST_FILE) {
    startUpdater();
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    return;
  }

  try {
    await runSelfTest(mainWindow, url);
  } catch (error) {
    check('the self-test finished without throwing', false, (error as Error)?.stack ?? String(error));
  }

  const failed = report.failed > 0;
  writeSelfTestReport();
  journal(`exit: self-test finished (${report.passed} passed, ${report.failed} failed)`);
  app.exit(failed ? 1 : 0);
}

/**
 * Starts asking a release server whether there is a newer build, and downloading it when there is.
 *
 * Nothing happens until a few seconds after the window is up (see createUpdater): the first seconds
 * of a start belong to the app. A build with no release configured — every checkout, the tests —
 * answers `unconfigured`, and the sidebar then never mentions updates.
 */
function startUpdater(): void {
  const enabled = Boolean(UPDATE_FEED) && (app.isPackaged || process.env.EPC_UPDATES_IN_DEV === '1');
  updater = createUpdater({
    enabled,
    feed: UPDATE_FEED,
    version: APP_VERSION,
    updateDir: updateDir(),
    onState: publishUpdateState,
    log: (line) => journal(line)
  });

  if (!enabled) {
    lastUpdateState = { status: 'unconfigured' };
    return;
  }

  /* A build downloaded during a previous run but not yet put in place (another copy was starting,
     or the app was closed before the swap) still deserves the line in the sidebar. */
  const staged = stagedUpdateVersion(updateDir());
  if (staged) lastUpdateState = { status: 'ready', version: staged, percent: 100 };

  updater.start();
}

/** Leaves the report behind for the self-test harness, when it asked for one. */
function writeSelfTestReport(): void {
  if (!SELF_TEST_FILE) return;
  try {
    fs.mkdirSync(path.dirname(SELF_TEST_FILE), { recursive: true });
    fs.writeFileSync(SELF_TEST_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('self-test report could not be written:', error);
  }
}

async function main(): Promise<void> {
  journal('start: looking for a copy that is already running');
  // Before anything Chromium-shaped: is a copy of the app already running? Only afterwards is a
  // profile folder prepared, because two copies cannot share one.
  const settlement = await settleWithRunningCopy();
  journal(settlement.start ? 'negotiation: nothing else is running, going ahead' : 'negotiation: handing over');
  if (!settlement.start) {
    if (settlement.message) {
      console.log(settlement.message);
      if (!SELF_TEST_FILE) dialog.showErrorBox(`${APP_NAME} уже запущено`, settlement.message);
    }
    writeSelfTestReport();
    journal('exit: another copy keeps the app');
    app.exit(0);
    return;
  }

  prepareDirs();
  journal(`profile prepared: ${profileDir}`);

  /*
    A build that was downloaded during an earlier run takes the place of the file the user has,
    before anything else happens: the window then opens, is closed, and the start after it is the
    new version's own start. The manifest is consumed by the swap, so this happens exactly once —
    a failed or repeated swap cannot trap the app in a restart loop.
  */
  if (!SELF_TEST_FILE && readStagedUpdate(updateDir(), APP_VERSION)) {
    journal('update: a downloaded build is waiting and will be installed when this one closes');
  }

  // Last-resort guard for two launches in the same instant, when neither has a server to ask yet.
  if (!app.requestSingleInstanceLock()) {
    const message = `${APP_NAME} уже запускается.\n\nЗакройте открытое окно приложения и запустите файл снова.`;
    report.facts.singleInstanceLock = false;
    console.log(message);
    if (!SELF_TEST_FILE) dialog.showErrorBox(`${APP_NAME} уже запущено`, message);
    writeSelfTestReport();
    journal('exit: another copy holds the app folder');
    app.exit(0);
    return;
  }
  report.facts.singleInstanceLock = true;
  journal('single instance lock taken');

  await app.whenReady();
  installWindowControls();
  installUpdateControls();
  journal('electron is ready');
  await boot();
}

app.setName(APP_NAME);
// Windows draws the taskbar button from the window's icon, but it also groups it under the
// application's identity: without one of our own the button is Electron's, and a pinned app is a
// nameless second entry.
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

// With the negotiation in place this is only a safety net, and it brings the window forward.
app.on('second-instance', () => focusWindow());

/*
  The last moment at which the downloaded build can be put in place: the app is closing, the file
  it runs from is about to be free, and the helper script is waiting for exactly that. Closing the
  window and pressing «Перезапустить» take the same road — the difference is only whether the
  script starts the app again afterwards.
*/
app.on('will-quit', () => {
  if (SELF_TEST_FILE || updateInstallScheduled) return;
  if (!readStagedUpdate(updateDir(), APP_VERSION)) return;
  scheduleUpdateNow(false);
});

// Closing the window stops the app for good: no hidden copy keeps answering from the background.
app.on('window-all-closed', () => {
  windowAllClosedFired = true;
  if (SELF_TEST_FILE) return; // the self-test observes this flag and finishes on its own
  app.quit();
});

main().catch((error) => {
  console.error('the app could not start:', error);
  report.error = (error as Error)?.stack ?? String(error);
  journal(`exit: could not start — ${(error as Error)?.message ?? error}`);
  writeSelfTestReport();
  app.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('unexpected error:', error);
});
