/**
 * The desktop build's own update of itself.
 *
 * The app is published as one portable .exe that keeps everything it remembers in a `data` folder
 * beside itself, so an installer would be a step backwards for the people testing it: the portable
 * file is the whole installation, and moving it into a programs folder would move the folder it
 * writes to as well. What an installer is needed for — installing a newer build over an older one —
 * is done here instead: the new .exe is downloaded next to the app, and on the next start the old
 * file is renamed out of the way and replaced.
 *
 * That is allowed on Windows only because of one detail: a running executable cannot be deleted or
 * overwritten, but it *can* be renamed. So the swap is rename, rename, delete — and the app then
 * starts the new file, which is an ordinary start with everything where it belongs.
 *
 * What the app trusts: the version in `version.json` next to the release, and a SHA-256 of the file
 * it names. A download whose hash does not match is deleted and never installed, which is the only
 * thing standing between the user and a corrupted file on a flaky connection.
 *
 * The decisions that can be made from strings — which version is newer, whether a manifest is
 * complete — live in src/utils/updateRules.ts, where the tests can reach them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  fileNameOf,
  isNewerVersion,
  readManifest,
  alternateAssetUrl,
  resolveAssetUrl,
  UpdateManifest,
  UpdateState
} from '../src/utils/updateRules';

/** How often a running window asks again, when nothing is happening. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The file a downloaded build is kept as, and the name the old file is swapped for it with. */
export const EXE_NAME = 'Easy Project Compiler.exe';

export interface UpdaterOptions {
  /** Nothing is asked, offered or installed when false (development runs, no feed configured). */
  enabled: boolean;
  /** The folder the release lives in; `version.json` is read from it. */
  feed: string;
  /** The version of the build that is running. */
  version: string;
  /** Where the downloaded build is kept until the next start: `<data>/update`. */
  updateDir: string;
  /**
   * The file name of the build that is running.
   *
   * The download is staged under exactly this name, because the swap looks for exactly this name
   * beside the app: a build the tester renamed must still be able to replace itself. Defaults to the
   * name it is published under.
   */
  exeName?: string;
  onState: (state: UpdateState) => void;
  log: (line: string) => void;
  /** Only for tests: replace the network. */
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  /**
   * Waits a few seconds before the first question: the first seconds of a start belong to the app,
   * and a slow network must never be part of why it feels slow.
   */
  startupDelayMs?: number;
  /**
   * How long the «Скачать» button is left alone before the download starts by itself.
   *
   * The offer is a button first — pressing it is the fastest path — but nobody has to be at the
   * screen for an update to arrive: an ignored offer becomes a background download, and the build
   * is installed at the next start either way.
   */
  idleDownloadMs?: number;
}

export interface Updater {
  /** Asks once; `manual` (a pressed button) ignores the throttle between automatic checks. */
  check: (manual?: boolean) => Promise<UpdateState>;
  /** Starts the download before the idle delay is over (the sidebar's «Скачать»). */
  download: () => Promise<UpdateState>;
  /** The last state handed to onState. */
  state: () => UpdateState;
  /** Starts the automatic question-and-download, and stops with the returned function. */
  start: () => () => void;
  /** Stops a check/download pair without touching what is already staged. */
  stop: () => void;
}

/** A message for the sidebar: short, and never a stack trace. */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return 'Нет связи с сервером обновлений';
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) return 'Сервер обновлений не ответил';
  if (/404/.test(message)) return 'Релиз с обновлением не найден';
  return message.slice(0, 160) || 'Не удалось проверить обновление';
}

export function createUpdater(options: UpdaterOptions): Updater {
  const {
    enabled,
    feed,
    version,
    updateDir,
    exeName = EXE_NAME,
    onState,
    log,
    fetchImpl = fetch,
    intervalMs = CHECK_INTERVAL_MS,
    startupDelayMs = 4000,
    idleDownloadMs = 20000
  } = options;

  let current: UpdateState = { status: enabled ? 'idle' : 'unconfigured' };
  let lastCheckAt = 0;
  let checking: Promise<UpdateState> | null = null;
  let downloading = false;
  let stopped = false;
  /** The offer is waiting for an answer; the timer is what makes "no answer" a normal outcome. */
  let offered: UpdateManifest | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  const emit = (state: UpdateState): UpdateState => {
    current = state;
    try {
      onState(state);
    } catch {
      /* a closed window is not a reason to fail an update */
    }
    return state;
  };

  /** A file name that can be written beside the app: no separators, no surprises from the server. */
  function stagedPaths(fileName: string) {
    return {
      manifest: path.join(updateDir, 'version.json'),
      file: path.join(updateDir, fileName),
      part: path.join(updateDir, `${fileName}.part`)
    };
  }

  async function question(): Promise<UpdateManifest | null> {
    const url = `${feed.endsWith('/') ? feed : `${feed}/`}version.json?t=${Date.now()}`;
    log(`update: asking ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        // The manifest is one small file that changes per release; a cached copy would hide a
        // release that went out a minute ago.
        headers: { 'cache-control': 'no-cache' }
      });
      if (response.status === 404) {
        /*
          The feed answers 404 in two cases: the repository has no releases yet, or the address is
          wrong. Neither is something the person using the app can act on, so it is not shown as a
          failure — but it is written to the log, where the one person who can act on it looks.
        */
        log('update: the release feed answered 404 — no releases yet, or a wrong address in this build');
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for version.json`);
      const manifest = readManifest(await response.json());
      if (!manifest) throw new Error('version.json is not a complete update manifest');
      return manifest;
    } finally {
      clearTimeout(timer);
    }
  }

  async function download(manifest: UpdateManifest): Promise<UpdateState> {
    const url = resolveAssetUrl(feed, manifest.file);
    /* The name of the file that is running: the swap looks for exactly this, so it is the one that
       is downloaded even when the release names the asset differently. */
    const paths = stagedPaths(exeName);
    fs.mkdirSync(updateDir, { recursive: true });
    if (fs.existsSync(paths.part)) fs.rmSync(paths.part, { force: true });
    log(`update: downloading ${url}`);
    emit({ status: 'downloading', version: manifest.version, percent: 0, notes: manifest.notes });

    let response = await fetchImpl(url);
    /*
     * A name with spaces is not a name a release host keeps, and the first release was published
     * with one in its manifest: the asset went up as `Easy.Project.Compiler.exe` and the URL the
     * manifest named answered 404. The publisher records the stored name now; this is so a build
     * that is already in someone's hands still finds its update.
     */
    if (response.status === 404) {
      const alternate = alternateAssetUrl(feed, manifest.file);
      if (alternate) {
        log(`update: ${manifest.file} answered 404 — asking for ${alternate}`);
        response = await fetchImpl(alternate);
      }
    }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${manifest.file}`);
    const total = Number(response.headers.get('content-length') || 0);
    const hash = crypto.createHash('sha256');
    const handle = fs.createWriteStream(paths.part);
    let received = 0;
    let lastPercent = -1;

    try {
      // @ts-expect-error — Node's fetch body is an async iterable of bytes.
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.length;
        hash.update(buffer);
        if (!handle.write(buffer)) {
          await new Promise<void>((resolve) => handle.once('drain', () => resolve()));
        }
        if (total > 0) {
          const percent = Math.min(99, Math.floor((received / total) * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            emit({ status: 'downloading', version: manifest.version, percent, notes: manifest.notes });
          }
        }
        if (stopped) throw new Error('обновление остановлено');
      }
    } finally {
      await new Promise<void>((resolve) => handle.end(resolve));
    }

    const actual = hash.digest('hex');
    if (actual !== manifest.sha256) {
      fs.rmSync(paths.part, { force: true });
      throw new Error('Скачанный файл не совпал с опубликованным (проверка SHA-256 не прошла)');
    }

    fs.rmSync(paths.file, { force: true });
    fs.renameSync(paths.part, paths.file);
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    log(`update: ${manifest.version} is on disk (${received} bytes)`);
    return emit({ status: 'ready', version: manifest.version, percent: 100, notes: manifest.notes });
  }

  async function runCheck(manual: boolean): Promise<UpdateState> {
    if (!enabled) return emit({ status: 'unconfigured' });
    if (downloading || current.status === 'ready') return current;
    const now = Date.now();
    if (!manual && now - lastCheckAt < intervalMs && lastCheckAt > 0) return current;
    lastCheckAt = now;
    emit({ status: 'checking', version: current.version, notes: current.notes });

    try {
      const manifest = await question();
      if (!manifest) return emit({ status: 'current' });
      if (!isNewerVersion(manifest.version, version)) {
        log(`update: ${version} is the newest (release says ${manifest.version})`);
        return emit({ status: 'current', version: manifest.version });
      }
      log(`update: ${manifest.version} is newer than ${version}`);
      const state = emit({ status: 'available', version: manifest.version, notes: manifest.notes });
      /* The offer is shown first; unless a button is pressed, it becomes a background download. */
      offered = manifest;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        log('update: the offer was not taken, downloading in the background');
        void startDownload();
      }, idleDownloadMs);
      idleTimer.unref?.();
      return state;
    } catch (error) {
      /* The state carries the message; the return value is only for a caller that waits. */
      return emit({ status: 'error', version: current.version, error: shortError(error) });
    }
  }

  /** Downloads the offered build once; a second call answers with the state already reached. */
  async function startDownload(): Promise<UpdateState> {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (current.status === 'ready' || current.status === 'downloading' || downloading) return current;
    let manifest = offered;
    /* A press with nothing offered asks first — the press was "yes", so the answer downloads it. */
    if (!manifest) {
      const checked = await runCheck(true);
      if (checked.status !== 'available') return checked;
      manifest = offered;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }
    if (!manifest) return current;
    offered = null;
    downloading = true;
    try {
      return await download(manifest);
    } catch (error) {
      return emit({ status: 'error', version: manifest.version, error: shortError(error) });
    } finally {
      downloading = false;
    }
  }

  return {
    check(manual = false) {
      if (checking) return checking;
      checking = runCheck(manual).finally(() => {
        checking = null;
      });
      return checking;
    },
    download: startDownload,
    state: () => current,
    start() {
      if (!enabled) return () => {};
      const timer = setTimeout(() => {
        void this.check(false);
      }, startupDelayMs);
      const interval = setInterval(() => {
        void this.check(false);
      }, intervalMs);
      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    },
    stop() {
      stopped = true;
    }
  };
}

export interface StagedUpdate {
  manifest: UpdateManifest;
  /** The downloaded file, ready to take the place of the one being run. */
  file: string;
}

/**
 * What is waiting to be installed, without touching it.
 *
 * Null when nothing is staged, when the manifest cannot be read, when the file it names is gone, or
 * when the staged build is not newer than the one running — the last one matters most: a file left
 * over from a released version that has since been rolled back must never be installed.
 */
export function readStagedUpdate(updateDir: string, version: string, exeName = EXE_NAME): StagedUpdate | null {
  const manifestPath = path.join(updateDir, 'version.json');
  if (!fs.existsSync(manifestPath)) return null;
  let manifest: UpdateManifest | null = null;
  try {
    manifest = readManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch {
    manifest = null;
  }
  if (!manifest) return null;
  if (!isNewerVersion(manifest.version, version)) return null;
  /*
    The file is looked for under the name the app itself is running as — that is the name the
    download stages it under (see `download`), while the manifest names the asset the way the
    release host stores it (`Easy.Project.Compiler.exe` beside a running `Easy Project Compiler.exe`).
    Reading only the manifest's name found nothing beside a staged download, so a build that had
    reported «готово» for a whole release was never installed on anybody's machine. The manifest's
    own name is still accepted, so a stage written by an older build is not abandoned.
  */
  const fromManifest = /^https?:\/\//i.test(manifest.file)
    ? fileNameOf(manifest.file, exeName)
    : path.basename(manifest.file);
  const file = [exeName, fromManifest]
    .map((name) => path.join(updateDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  return { manifest, file };
}

/** What is waiting to be installed, by version: for the sidebar and for tests. */
export function stagedUpdateVersion(updateDir: string): string | null {
  try {
    const manifest = readManifest(JSON.parse(fs.readFileSync(path.join(updateDir, 'version.json'), 'utf8')));
    return manifest?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * The little script that swaps the files after the app has gone.
 *
 * It exists because Windows will not let the running program replace its own executable — the
 * rename fails with `EBUSY` while the portable launcher has the file open, which is exactly how the
 * first version of this updater failed on a real machine. A separate process has no such problem:
 * it waits for the app to exit, moves the downloaded build over the old one, and (when the user
 * asked for a restart) starts it again.
 *
 * Everything is relative to the script's own folder (`%~dp0` is `<data>\update\`), so the app can
 * live anywhere — including a folder whose name is not ASCII — without the script carrying a path.
 */
export function updateHelperScript(options: { exeName: string; relaunch: boolean }): string {
  const { exeName, relaunch } = options;
  const restart = relaunch ? '1' : '0';
    /*
    A backslash written as a character rather than as `\\`: inside a template literal an unknown
    escape silently loses its backslash, which is exactly how the first version of this script
    shipped a line that said `set "TARGET=%~dp0...."` and moved nothing.
  */
  const SEP = String.fromCharCode(92);
  return [
    '@echo off',
    'setlocal',
    'set "TARGET=%~dp0..' + SEP + '..' + SEP + exeName + '"',
    'set "FRESH=%~dp0' + exeName + '"',
    'set "RELAUNCH=' + restart + '"',
    'set /a tries=0',
    ':wait',
    'move /y "%FRESH%" "%TARGET%" >nul 2>&1',
    'if errorlevel 1 goto retry',
    'goto done',
    ':retry',
    'set /a tries+=1',
    'if %tries% GEQ 60 goto giveUp',
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':giveUp',
    'if "%RELAUNCH%"=="1" start "" "%TARGET%"',
    'del "%~dp0version.json" >nul 2>&1',
    'del "%~f0" >nul 2>&1',
    'exit /b 1',
    ':done',
    'if "%RELAUNCH%"=="1" start "" "%TARGET%"',
    /* The manifest goes with it: a leftover would name a file that is no longer there. */
    'del "%~dp0version.json" >nul 2>&1',
    'del "%~f0" >nul 2>&1',
    'exit /b 0',
    ''
  ].join('\r\n');
}

export interface InstallSchedule {
  scheduled: boolean;
  version?: string;
  reason?: string;
}

/**
 * Starts the swap, to happen as soon as this process is gone.
 *
 * Called on the way out — whether the user pressed «Перезапустить и обновить» or simply closed the
 * window. `relaunch` is the difference between the two: with it the script starts the app again
 * once the new file is in place.
 */
/**
 * The environment the restarted build must NOT inherit.
 *
 * The shell tells its own server where the app is (`EPC_DIST_DIR`, `EPC_STATE_DIR`, …) by writing
 * those variables into this process before loading the server bundle. The swap helper is started
 * from this process, so a plain `spawn` would hand them to the new build — and the new build runs
 * from a *different* temporary folder, because the portable launcher extracts every start afresh.
 * Inheriting the old folder's `EPC_DIST_DIR` made the new build serve the web app from a directory
 * its predecessor had already deleted: the server answered 500, and the window was black. A build
 * that starts must start from its own paths, so these are removed before the helper is launched.
 */
export function launchEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith('EPC_') || key === 'NODE_ENV' || key === 'PORT' || key === 'ELECTRON_RUN_AS_NODE') {
      delete env[key];
    }
  }
  return env;
}

export function scheduleUpdateInstall(options: {
  updateDir: string;
  exeName: string;
  version: string;
  relaunch: boolean;
  log: (line: string) => void;
  /** Only for tests. */
  spawnImpl?: (command: string, args: string[], options: Record<string, unknown>) => { unref: () => void };
}): InstallSchedule {
  const staged = readStagedUpdate(options.updateDir, options.version, options.exeName);
  if (!staged) return { scheduled: false, reason: 'nothing newer is staged' };

  const scriptPath = path.join(options.updateDir, 'apply-update.cmd');
  try {
    fs.writeFileSync(scriptPath, updateHelperScript({ exeName: options.exeName, relaunch: options.relaunch }), 'ascii');
  } catch (error) {
    return { scheduled: false, reason: `cannot write the swap script: ${(error as Error).message}` };
  }

  const spawnImpl =
    options.spawnImpl ??
    ((command: string, spawnArgs: string[], spawnOptions: Record<string, unknown>) =>
      spawn(command, spawnArgs, spawnOptions) as unknown as { unref: () => void });

  try {
    const child = spawnImpl('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // The restarted build reads its own folder; nothing here may point it at this process's.
      env: launchEnvironment()
    });
    child.unref();
  } catch (error) {
    return { scheduled: false, reason: `cannot start the swap: ${(error as Error).message}` };
  }

  options.log(`update: ${staged.manifest.version} will be installed as this build closes${options.relaunch ? ' and started again' : ''}`);
  return { scheduled: true, version: staged.manifest.version };
}
