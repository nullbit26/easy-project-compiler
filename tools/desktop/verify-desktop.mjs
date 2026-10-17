#!/usr/bin/env node
/**
 * End-to-end check of the packaged desktop application.
 *
 * It starts the real .exe the way a tester starts it — by double-clicking the published file, in a
 * folder of its own — and checks the things unit tests cannot:
 *
 *   1. the app opens its own window, serves its own build and starts with an empty project list;
 *   2. everything it remembers lives in a `data` folder next to the .exe it ran from;
 *   3. its real HTTP API answers, driven by the same suite the packaged server already passes
 *      (tools/exe/e2e-verify.mjs);
 *   4. closing the window stops the app, and a *newer* build takes over from an older running
 *      copy instead of the older one answering — the failure this desktop build exists to remove.
 *
 * Every run happens in a temporary folder, so the published folder and the developer's own data
 * are never touched.
 *
 * Usage: npm run test:desktop
 *        EPC_DESKTOP_EXE=... npm run test:desktop
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const isWindows = process.platform === 'win32';
const exeName = 'Easy Project Compiler.exe';
const LAUNCH_TIMEOUT_MS = 180000;

function desktopDir() {
  const candidates = [
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    path.join(os.homedir(), 'Desktop')
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? root;
}

const releaseDir = path.join(
  process.env.EPC_EXE_DIR ? path.resolve(process.env.EPC_EXE_DIR) : desktopDir(),
  'Приложение-для-тестеров'
);
const exePath = process.env.EPC_DESKTOP_EXE
  ? path.resolve(process.env.EPC_DESKTOP_EXE)
  : path.join(releaseDir, exeName);

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function waitForValue(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const appRuns = [];

function startApp(exe, args = [], extraEnv = {}, label = 'приложение') {
  const child = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv }
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk.toString()));
  child.stderr.on('data', (chunk) => (log += chunk.toString()));
  const run = { child, log: () => log };
  appRuns.push({ label, run });
  return run;
}

function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWindows) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

async function waitForExit(child, timeoutMs) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code ?? 0));
  });
  const outcome = await Promise.race([exited, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    stopTree(child);
    return 'timeout';
  }
  return outcome;
}

/**
 * Names the checks a self-test run failed, for the runs whose report is not printed in full.
 *
 * The first run prints every check it made, one line each. The later runs — a rebuilt copy, and a
 * second build taking over from the one on screen — report only a count, so a failure there arrived
 * as "failed 2" with no way to tell which two. The names are in the report all along; this is what
 * brings them out, as failures of their own.
 */
function reportSelfTestFailures(report, label) {
  const failed = (report?.checks || []).filter((entry) => !entry.ok);
  for (const entry of failed) check(`${label}: ${entry.name}`, false, entry.detail);
  return failed.length;
}

/**
 * What the app saw, in one line, when its own checks failed.
 *
 * The names of the failed checks say what was wrong and nothing about why: a check about a missing
 * element needs the screen the app was on when it looked, and a check about a window needs the size
 * it had. This is printed as an annotation before any other, because a runner keeps only the first
 * few — and on a machine with no screen the app's own account of the run is the only one there is.
 */
function appContext(report, run) {
  const oneLine = (value, limit) =>
    JSON.stringify(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit));
  const facts = report?.facts ?? {};
  const parts = [
    `window ${JSON.stringify(facts.layout?.viewport ?? null)}`,
    `screenshot ${facts.screenshot ? 'saved' : 'not saved'}`,
    `on screen ${oneLine(facts.probe?.bodyText, 160)}`,
    `footer ${oneLine(facts.layout?.footerText, 80)}`,
    `page said ${oneLine((facts.pageConsole || []).slice(-4).join(' | '), 300)}`,
    `app said ${oneLine(run.log(), 200)}`
  ];
  return `the app, when its checks failed: ${parts.join(' · ')}`;
}

/** A folder of its own for every run, with its own copy of the published .exe. */
function freshFolder(name) {
  const folder = path.join(sandbox, name);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, exeName);
  fs.cpSync(exePath, target);
  return { folder, exe: target };
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-desktop-'));
const started = [];

try {
  // ---------------------------------------------------------------- the published folder itself
  check('the published application exists', fs.existsSync(exePath), exePath);
  if (!fs.existsSync(exePath)) throw new Error(`Пакет не найден: ${exePath}`);
  const exeSize = fs.statSync(exePath).size;
  check('it is one self-contained .exe', exeSize > 40 * 1024 * 1024, `${(exeSize / 1024 / 1024).toFixed(1)} MB`);

  const instructions = path.join(releaseDir, 'КАК-ЗАПУСТИТЬ.txt');
  const instructionsText = fs.existsSync(instructions) ? fs.readFileSync(instructions, 'utf8') : '';
  check('the instructions sit next to it', instructionsText.length > 0, instructions);
  check(
    'they tell the tester the app opens its own window, not a browser',
    /Откроется окно приложения/.test(instructionsText)
  );
  check('they do not send the tester to a browser address', !/localhost:4123/.test(instructionsText));
  check(
    'they explain where the data folder is',
    /data\/api-keys\.json/.test(instructionsText) && /удалите эту папку data/.test(instructionsText)
  );
  check(
    'the published folder carries no app state',
    !fs.existsSync(path.join(releaseDir, 'data'))
  );

  // ------------------------------- 1. a fresh copy checks itself, in a folder of its own
  const first = freshFolder('тестер-1');
  const selfTestFile = path.join(sandbox, 'self-test-1.json');
  const run = startApp(first.exe, [`--self-test=${selfTestFile}`], {}, 'первый запуск');
  started.push(run.child);
  const code = await waitForExit(run.child, LAUNCH_TIMEOUT_MS);
  const report = readJson(selfTestFile);
  if (report?.failed) console.log(`::error::${appContext(report, run)}`);
  check(
    'the app checks itself through its own window and exits cleanly',
    code === 0 && report?.failed === 0,
    `exit ${code}${report ? `, failed ${report.failed}` : ', no report'}`
  );
  if (!report) throw new Error(`Самопроверка не оставила отчёт. Вывод:\n${run.log().slice(-2000)}`);
  for (const entry of report.checks) check(`self-test: ${entry.name}`, entry.ok, entry.detail);

  check(
    'it runs from the folder the tester started it in',
    report.facts.appDir === first.folder,
    String(report.facts.appDir)
  );
  check(
    'everything it remembers is kept next to the .exe',
    report.facts.stateDir === path.join(first.folder, 'data') &&
      fs.existsSync(path.join(first.folder, 'data', 'app-data')),
    String(report.facts.stateDir)
  );
  check('it reports which build it is', Boolean(report.buildId) && report.buildId.length > 8, report.buildId);
  check(
    'nothing was downloaded from the internet while it started',
    (report.facts.externalRequests || []).length === 0,
    JSON.stringify(report.facts.externalRequests)
  );
  const screenshot = `${selfTestFile}.png`;
  check(
    'a picture of the running window was saved',
    fs.existsSync(screenshot) && fs.statSync(screenshot).size > 5000,
    screenshot
  );

  // ------------- 1b. a rebuild must drop the previous screen instead of showing it again
  // The state file is what tells the app that a different build ran in this folder before, which
  // is exactly what happens when a new .exe is put next to the old data folder.
  const stateInFirstFolder = path.join(first.folder, 'data', 'app-state.json');
  const remembered = readJson(stateInFirstFolder);
  fs.writeFileSync(stateInFirstFolder, `${JSON.stringify({ ...remembered, buildId: '000000-0000-old1' }, null, 2)}\n`);

  const rebuiltFile = path.join(sandbox, 'self-test-1b.json');
  const rebuilt = startApp(first.exe, [`--self-test=${rebuiltFile}`], {}, 'запуск после пересборки');
  started.push(rebuilt.child);
  const rebuiltCode = await waitForExit(rebuilt.child, LAUNCH_TIMEOUT_MS);
  const rebuiltReport = readJson(rebuiltFile);
  check(
    'a rebuilt app notices that another build ran here before',
    rebuiltReport?.facts?.buildChanged === true && rebuiltReport?.facts?.previousBuildId === '000000-0000-old1',
    JSON.stringify(rebuiltReport?.facts?.previousBuildId)
  );
  if (rebuiltReport?.failed) console.log(`::error::${appContext(rebuiltReport, rebuilt)}`);
  reportSelfTestFailures(rebuiltReport, 'rebuilt run');
  check(
    'it drops the old screen and renders its own',
    rebuiltCode === 0 && rebuiltReport?.failed === 0,
    `exit ${rebuiltCode}, failed ${rebuiltReport?.failed}`
  );
  check(
    'the build it shows is the new one, not the remembered one',
    rebuiltReport?.buildId === report.buildId && rebuiltReport?.facts?.probe?.health?.build?.id === report.buildId,
    String(rebuiltReport?.facts?.probe?.health?.build?.id)
  );
  check(
    'the newer run is what the folder remembers now',
    readJson(stateInFirstFolder)?.buildId === report.buildId,
    String(readJson(stateInFirstFolder)?.buildId)
  );

  // --------------------------------------- 2. the packaged app answers like the app it is
  const statePath = path.join(first.folder, 'data', 'app-state.json');
  const wasRecorded = readJson(statePath)?.launchedAt ?? null;
  const second = startApp(first.exe, [], {}, 'второй запуск');
  started.push(second.child);
  // Wait for *this* run to record itself: the file left by the previous run is still there.
  const state = await waitForValue(
    () => {
      const recorded = readJson(statePath);
      return recorded && recorded.launchedAt !== wasRecorded ? recorded : null;
    },
    LAUNCH_TIMEOUT_MS
  );
  check('the app records its run in its own folder', Boolean(state), JSON.stringify(state));
  if (state) {
    check('the record names the build that is running', state.buildId === report.buildId, String(state.buildId));
    const base = `http://127.0.0.1:${state.port}`;
    let health = null;
    try {
      health = await (await fetch(`${base}/api/health`)).json();
    } catch (error) {
      health = null;
      check('the app answers on its own loopback address', false, String(error?.message ?? error));
    }
    if (health) {
      check('it answers on its own loopback address', health.status === 'ok', base);
      check('it says it is the desktop build', health.build?.mode === 'desktop', String(health.build?.mode));
      check('it serves the same build it stamped', health.build?.id === report.buildId, String(health.build?.id));
      check(
        'it publishes no port to the local network',
        health.build?.stateDir === path.join(first.folder, 'data'),
        String(health.build?.stateDir)
      );
    }

    const e2e = spawn(
      process.execPath,
      [path.join(root, 'tools', 'exe', 'e2e-verify.mjs')],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E2E_BASE: base } }
    );
    let e2eOut = '';
    e2e.stdout.on('data', (chunk) => (e2eOut += chunk.toString()));
    e2e.stderr.on('data', (chunk) => (e2eOut += chunk.toString()));
    const e2eCode = await waitForExit(e2e, LAUNCH_TIMEOUT_MS);
    const summary = (e2eOut.match(/\d+\/\d+ checks passed/) || ['no summary'])[0];
    check('the packaged app passes the file and verification suite', e2eCode === 0, `${summary} (exit ${e2eCode})`);
    if (e2eCode !== 0) console.log(`\n--- проверки приложения ---\n${e2eOut.slice(-3000)}\n`);
  }
  stopTree(second.child);
  await waitForValue(() => !processAlive(state?.pid), 15000);

  // ------------- 3. two copies of the app next to each other, the way a person really starts them
  const third = freshFolder('тестер-2');
  const thirdStatePath = path.join(third.folder, 'data', 'app-state.json');
  const older = startApp(third.exe, [], {}, 'первая копия');
  started.push(older.child);
  const olderState = await waitForValue(() => readJson(thirdStatePath), LAUNCH_TIMEOUT_MS);
  check('the first copy is running before anything else starts', processAlive(olderState?.pid), String(olderState?.pid));

  // 3a — the same build started twice: the window that exists comes forward, no twin, no crash.
  const twinFile = path.join(sandbox, 'self-test-2.json');
  const twin = startApp(third.exe, [`--self-test=${twinFile}`], {}, 'вторая копия');
  started.push(twin.child);
  const twinCode = await waitForExit(twin.child, LAUNCH_TIMEOUT_MS);
  const twinReport = readJson(twinFile);
  check(
    'starting the same build twice raises the window instead of opening a second one',
    twinCode === 0 && twinReport?.facts?.sameBuildRunning === 'brought forward',
    `exit ${twinCode}, ${JSON.stringify(twinReport?.facts?.sameBuildRunning)}`
  );
  check('the copy that was already open keeps running', processAlive(olderState?.pid), String(olderState?.pid));
  const stillAnswers = await fetch(`http://127.0.0.1:${olderState?.port}/api/health`)
    .then((response) => response.ok)
    .catch(() => false);
  check('it still answers on its own address after the second launch', stillAnswers, `port ${olderState?.port}`);

  // 3b — another build started while this one is open: the old window must not answer again.
  const takeoverFile = path.join(sandbox, 'self-test-3.json');
  const newer = startApp(
    third.exe,
    [`--self-test=${takeoverFile}`],
    {
      // Pretends to be another build, which is exactly what happens when a rebuilt .exe is started
      // while the previous one is still open.
      EPC_BUILD_ID_OVERRIDE: '999999-9999-fake'
    },
    'новая сборка поверх открытой'
  );
  started.push(newer.child);
  const newerCode = await waitForExit(newer.child, LAUNCH_TIMEOUT_MS);
  const takeoverReport = readJson(takeoverFile);
  check(
    'another build closes the window that is on screen',
    takeoverReport?.facts?.otherBuildClosed === true && takeoverReport?.facts?.otherBuildAskedToClose === true,
    JSON.stringify(takeoverReport?.facts?.otherBuildClosed)
  );
  if (takeoverReport?.failed) console.log(`::error::${appContext(takeoverReport, newer)}`);
  reportSelfTestFailures(takeoverReport, 'takeover run');
  check(
    'the build that was just started renders its own screen and passes its own checks',
    newerCode === 0 && takeoverReport?.failed === 0,
    `exit ${newerCode}, failed ${takeoverReport?.failed}`
  );
  check(
    'the screen it shows is its own build, not the one that was open',
    takeoverReport?.facts?.probe?.health?.build?.id === report.buildId,
    String(takeoverReport?.facts?.probe?.health?.build?.id)
  );
  // The launcher wipes its unpack folder before extracting. If two copies ever shared one, the copy
  // that is already running would lose the files it was started from — so this is checked, not
  // assumed, because it depends on an option whose wording and behaviour disagree.
  check(
    'the two copies unpack into separate folders of their own',
    Boolean(takeoverReport?.facts?.distDir) && takeoverReport.facts.distDir !== olderState?.distDir,
    `${olderState?.distDir} vs ${takeoverReport?.facts?.distDir}`
  );
  const olderGone = await waitForValue(() => !processAlive(olderState?.pid), 20000);
  check('the older copy really stopped, so its window cannot answer again', olderGone === true, `pid ${olderState?.pid}`);
  stopTree(older.child);
} catch (error) {
  check('the run finished without throwing', false, error?.stack ?? String(error));
} finally {
  for (const child of started) stopTree(child);
  /*
   * A sandbox that resists deletion must not swallow the results.
   *
   * A window that has just been closed still lets go of its profile folder for a moment, and
   * Windows then refuses to remove the folder it is inside — which used to end the run with a stack
   * trace *before* the checks were printed, so a run that had measured everything reported nothing
   * at all and looked like a crash. The folder is a temporary one and the checks are the reason the
   * run exists, so a delete that fails is said out loud and the results are printed anyway.
   */
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    console.log(`· the sandbox was left behind (${error?.code ?? 'error'}): ${sandbox}`);
  }
}

for (const result of results) {
  const line = `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok || !result.detail ? '' : `  →  ${result.detail}`}`;
  console.log(line);
  /*
   * A failing check is also said as an annotation.
   *
   * The report above is the whole story for whoever watches the run, but a run on a machine nobody
   * is looking at — a build server, whose log needs a token to read — carries back only the lines it
   * recognises as errors. Without this, "the packaged app failed" is all that arrives, and the check
   * that failed has to be guessed.
   */
  if (!result.ok) console.log(`::error::${line}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
writeFailureSummary();
process.exit(failures > 0 ? 1 : 0);

/**
 * The whole failure, in the one place a machine nobody is sitting at can be read from.
 *
 * Annotations carry the failing check names but are capped and trimmed, and the reason a check
 * failed is usually in the application's own output: which build it thinks it is, what it saw, what
 * it could not find. On a build server that output is written to the job summary, which is part of
 * the run and readable without a token. Everywhere else — a developer's machine — nothing is
 * written and the console above stays the whole story.
 */
function writeFailureSummary() {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file || failures === 0) return;
  const lines = ['## Проверка приложения: что не прошло', ''];
  for (const result of results) {
    if (!result.ok) lines.push(`- **${result.name}**${result.detail ? ` — ${result.detail}` : ''}`);
  }
  for (const { label, run } of appRuns) {
    const text = run.log().trim();
    if (!text) continue;
    lines.push('', `<details><summary>Вывод приложения: ${label}</summary>`, '', '```', text.slice(-8000), '```', '', '</details>');
  }
  try {
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
  } catch (error) {
    console.log(`· сводка не записана (${error?.code ?? 'error'})`);
  }
}
