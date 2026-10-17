import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fileNameOf,
  isNewerVersion,
  normalizeVersion,
  parseVersion,
  readManifest,
  resolveAssetUrl
} from '../utils/updateRules';
import {
  createUpdater,
  EXE_NAME,
  readStagedUpdate,
  scheduleUpdateInstall,
  stagedUpdateVersion,
  updateHelperScript
} from '../../electron/updates';

/**
 * The update of the desktop build.
 *
 * Two halves are pinned here. The arithmetic — which version is newer, whether a manifest can be
 * trusted, where its file lives — is pure and is checked directly. The download is checked against a
 * fake network: the bytes arrive, the hash is compared, the file lands in the update folder, and a
 * corrupted download leaves nothing behind to install.
 *
 * What is deliberately not tested: the swap of a real .exe on a real disk. That happens at the next
 * start and is verified on the packaged build (see the update notes in КАК-ЗАПУСТИТЬ.md); a unit test
 * pretending to rename a running executable would only prove that the mock works.
 */

const sha = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

describe('1. version arithmetic', () => {
  it('1a. reads the numbers out of anything that looks like a version', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v2.0')).toEqual([2, 0, 0]);
    expect(parseVersion('1.2.3-beta.4')).toEqual([1, 2, 3]);
    expect(parseVersion('')).toEqual([0, 0, 0]);
    expect(parseVersion(null)).toEqual([0, 0, 0]);
    expect(parseVersion('мусор')).toEqual([0, 0, 0]);
    expect(normalizeVersion('v1.2')).toBe('1.2.0');
    expect(normalizeVersion(' 2 ')).toBe('2.0.0');
  });

  it('1b. says newer only when it is newer', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
    // A missing answer is not a newer version either: the app must not offer to update to nothing.
    expect(isNewerVersion('', '1.0.0')).toBe(false);
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false);
  });
});

describe('2. the manifest', () => {
  const good = { version: '1.2.0', file: 'Easy Project Compiler.exe', sha256: 'a'.repeat(64) };

  it('2a. accepts a complete one and refuses an incomplete one', () => {
    expect(readManifest(good)).toMatchObject({ version: '1.2.0' });
    expect(readManifest({ ...good, sha256: '' })).toBeNull();
    expect(readManifest({ ...good, sha256: 'not-a-hash' })).toBeNull();
    expect(readManifest({ version: '1.2.0', sha256: good.sha256 })).toBeNull();
    expect(readManifest(null)).toBeNull();
    expect(readManifest('строка')).toBeNull();
  });

  it('2b. keeps a note for the sidebar, when the release has one', () => {
    expect(readManifest({ ...good, notes: '  Исправлено сохранение проектов  ' })?.notes).toBe(
      'Исправлено сохранение проектов'
    );
  });

  it('2c. finds the file next to the feed, or where an absolute URL says', () => {
    expect(resolveAssetUrl('https://example.com/releases/latest/download', 'Build.exe')).toBe(
      'https://example.com/releases/latest/download/Build.exe'
    );
    expect(resolveAssetUrl('https://example.com/download/', 'Build.exe')).toBe(
      'https://example.com/download/Build.exe'
    );
    expect(resolveAssetUrl('https://example.com/download', 'https://cdn.example.com/x.exe')).toBe(
      'https://cdn.example.com/x.exe'
    );
  });

  it('2d. never turns a name from the network into a path', () => {
    expect(fileNameOf('https://example.com/download/Easy%20Project%20Compiler.exe')).toBe(
      'Easy Project Compiler.exe'
    );
    expect(fileNameOf('https://example.com/download/..%2F..%2Fevil.exe', 'fallback.exe')).toBe('fallback.exe');
    expect(fileNameOf('https://example.com/download/C:evil.exe', 'fallback.exe')).toBe('fallback.exe');
  });
});

describe('3. the updater', () => {
  let dir = '';
  let states: string[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-update-'));
    states = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  const build = Buffer.from('new build bytes');

  /** A network that answers version.json and the file, counting the calls it saw. */
  function fakeNetwork(options: { version?: string; bytes?: Buffer; hash?: string; status?: number } = {}) {
    const version = options.version ?? '1.1.0';
    const bytes = options.bytes ?? build;
    const manifest = {
      version,
      file: EXE_NAME,
      sha256: options.hash ?? sha(bytes)
    };
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('version.json')) {
        return new Response(JSON.stringify(manifest), { status: options.status ?? 200 });
      }
      return new Response(bytes, {
        status: options.status ?? 200,
        headers: { 'content-length': String(bytes.length) }
      });
    }) as unknown as typeof fetch;
    return { impl, calls, manifest };
  }

  it('3a. downloads a newer build and stages it, hash and all', async () => {
    const network = fakeNetwork();
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: (state) => states.push(state.status),
      log: () => {},
      fetchImpl: network.impl,
      idleDownloadMs: 10
    });

    const afterCheck = await updater.check(true);
    expect(afterCheck.status).toBe('available');
    expect(afterCheck.version).toBe('1.1.0');

    await vi.waitFor(() => expect(stagedUpdateVersion(path.join(dir, 'update'))).toBe('1.1.0'), {
      timeout: 3000
    });
    const staged = path.join(dir, 'update', EXE_NAME);
    expect(fs.readFileSync(staged, 'utf8')).toBe('new build bytes');
    expect(network.calls.filter((url) => decodeURIComponent(url).includes(EXE_NAME))).toHaveLength(1);
    expect(states).toContain('downloading');
    expect(updater.state().status).toBe('ready');
  });

  it('3b. a download that does not match its hash is never left to be installed', async () => {
    const network = fakeNetwork({ hash: 'b'.repeat(64) });
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: () => {},
      log: () => {},
      fetchImpl: network.impl
    });

    const state = await updater.download();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/SHA-256/);
    expect(fs.existsSync(path.join(dir, 'update', EXE_NAME))).toBe(false);
    expect(stagedUpdateVersion(path.join(dir, 'update'))).toBeNull();
  });

  it('3c. the offered build can be downloaded by a press, and only once', async () => {
    const network = fakeNetwork();
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: () => {},
      log: () => {},
      fetchImpl: network.impl,
      idleDownloadMs: 10_000
    });

    await updater.check(true);
    const first = await updater.download();
    const second = await updater.download();
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(network.calls.filter((url) => decodeURIComponent(url).includes(EXE_NAME))).toHaveLength(1);
  });

  it('3d. an older or equal release is not an update', async () => {
    const network = fakeNetwork({ version: '1.0.0' });
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: () => {},
      log: () => {},
      fetchImpl: network.impl
    });

    const state = await updater.check(true);
    expect(state.status).toBe('current');
    expect(network.calls.filter((url) => decodeURIComponent(url).includes(EXE_NAME))).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'update'))).toBe(false);
  });

  it('3e. a broken or missing release is an error with a short message, not a crash', async () => {
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: () => {},
      log: () => {},
      fetchImpl: (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    });

    const state = await updater.check(true);
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
    expect(state.error!.length).toBeLessThan(200);
  });

  it('3f. a feed with no releases yet is quiet, not an error', async () => {
    const lines: string[] = [];
    const updater = createUpdater({
      enabled: true,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: (state) => states.push(state.status),
      log: (line) => lines.push(line),
      fetchImpl: (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    });

    const state = await updater.check(true);
    expect(state.status).toBe('current');
    expect(state.error).toBeUndefined();
    // The one person who can fix it finds it in the log rather than in the sidebar.
    expect(lines.join('\n')).toContain('404');
    expect(fs.existsSync(path.join(dir, 'update'))).toBe(false);
  });

  it('3g. without a feed nothing is asked at all', async () => {
    const network = fakeNetwork();
    const updater = createUpdater({
      enabled: false,
      feed: 'https://example.com/download',
      version: '1.0.0',
      updateDir: path.join(dir, 'update'),
      onState: () => {},
      log: () => {},
      fetchImpl: network.impl
    });

    const state = await updater.check(true);
    expect(state.status).toBe('unconfigured');
    expect(network.calls).toHaveLength(0);
  });
});

describe('4. putting the downloaded build in place', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-swap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A folder shaped like the published app: the .exe the user has, plus a staged new one. */
  function prepare(options: { staged?: string; current?: string; version?: string }) {
    const updateDir = path.join(dir, 'data', 'update');
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(path.join(dir, EXE_NAME), options.current ?? 'old');
    const staged = options.staged ?? 'brand new';
    fs.writeFileSync(path.join(updateDir, EXE_NAME), staged);
    fs.writeFileSync(
      path.join(updateDir, 'version.json'),
      JSON.stringify({
        version: options.version ?? '1.1.0',
        file: EXE_NAME,
        sha256: sha(Buffer.from(staged))
      })
    );
    return updateDir;
  }

  it('4a. a staged build is found, and is not mistaken for the one running', () => {
    const updateDir = prepare({});
    const staged = readStagedUpdate(updateDir, '1.0.0');
    expect(staged?.manifest.version).toBe('1.1.0');
    expect(fs.readFileSync(staged!.file, 'utf8')).toBe('brand new');
    // The same folder read by a build that is already newer has nothing to install.
    expect(readStagedUpdate(updateDir, '1.1.0')).toBeNull();
    expect(readStagedUpdate(updateDir, '1.2.0')).toBeNull();
  });

  it('4b. a manifest without its file is not an update', () => {
    const updateDir = prepare({});
    fs.rmSync(path.join(updateDir, EXE_NAME));
    expect(readStagedUpdate(updateDir, '1.0.0')).toBeNull();
  });

  it('4c. the swap script waits for the app, replaces the file and can start it again', () => {
    const script = updateHelperScript({ exeName: EXE_NAME, relaunch: true });
    const backslash = String.fromCharCode(92);
    const expectedTarget = 'set "TARGET=%~dp0..' + backslash + '..' + backslash + EXE_NAME + '"';
    expect(script).toContain(expectedTarget);
    expect(script).toContain(`set "FRESH=%~dp0${EXE_NAME}"`);
    expect(script).toContain('move /y "%FRESH%" "%TARGET%"');
    expect(script).toContain('if %tries% GEQ 60 goto giveUp');
    // The manifest leaves with the script: what is left in the folder must not name a file that
    // has already been moved away.
    expect(script.match(/del "%~dp0version\.json"/g)?.length).toBe(2);
    // A restart only when it was asked for: closing the app must not reopen it.
    expect(updateHelperScript({ exeName: EXE_NAME, relaunch: false })).toContain('set "RELAUNCH=0"');
    expect(script).toContain('set "RELAUNCH=1"');
    // The script carries no absolute path, so a folder with Cyrillic in its name is not a problem.
    expect(script).not.toMatch(/[А-Яа-я]/);
    expect(script).not.toContain(dir);
  });

  it('4d. scheduling starts the helper exactly for a newer staged build', () => {
    const updateDir = prepare({});
    const spawned: string[][] = [];
    const result = scheduleUpdateInstall({
      updateDir,
      exeName: EXE_NAME,
      version: '1.0.0',
      relaunch: false,
      log: () => {},
      spawnImpl: (command, args) => {
        spawned.push([command, ...args]);
        return { unref: () => {} };
      }
    });

    expect(result.scheduled).toBe(true);
    expect(result.version).toBe('1.1.0');
    expect(spawned).toHaveLength(1);
    expect(spawned[0][0]).toBe('cmd.exe');
    expect(fs.existsSync(path.join(updateDir, 'apply-update.cmd'))).toBe(true);

    const nothingNewer = scheduleUpdateInstall({
      updateDir,
      exeName: EXE_NAME,
      version: '1.1.0',
      relaunch: false,
      log: () => {},
      spawnImpl: () => ({ unref: () => {} })
    });
    expect(nothingNewer.scheduled).toBe(false);
  });

  it('4e. a build that never reached the update folder is not advertised', () => {
    expect(stagedUpdateVersion(path.join(dir, 'nope'))).toBeNull();
  });
});
