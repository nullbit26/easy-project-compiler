#!/usr/bin/env node
/**
 * Pictures of every screen, so a change can be looked at instead of imagined.
 *
 * It starts an app of its own on port 3913 (or uses the one addressed in EPC_SHOT_URL), drives an
 * Electron window through all the screens (tools/screens/capture-main.cjs), writes one PNG per
 * screen into build/screenshots/ and builds a contact sheet next to them:
 *
 *   npm run shots
 *   EPC_SHOT_URL=http://127.0.0.1:3000 npm run shots
 *   EPC_SHOT_WIDTH=1280 EPC_SHOT_HEIGHT=800 npm run shots
 *
 * The demo project the screens need is written into the browser's storage of that origin, which is
 * why the default is a port of its own: taking the pictures on the port of the developer's own
 * session would replace their saved projects with the demo one.
 *
 * The contact sheet (build/screenshots/index.html) shows every screen at once. Opening it in the
 * preview panel is how the pictures are meant to be read: one page, all the screens, no file
 * hunting. The sheet is deliberately not part of the published app — it lives in build/, which the
 * desktop build ignores.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'build', 'screenshots');
const width = process.env.EPC_SHOT_WIDTH || '1440';
const height = process.env.EPC_SHOT_HEIGHT || '900';

/**
 * Which app the pictures are taken of.
 *
 * An explicitly addressed app is used as it is (`EPC_SHOT_URL`), because that is what someone
 * asking for it means. Otherwise a server of our own is started on a port of its own: the demo
 * project the pictures need is written into the browser's storage, and storage belongs to an origin —
 * seeding it on the port the developer uses for their own session would replace their saved projects
 * with the demo one.
 */
const explicitUrl = process.env.EPC_SHOT_URL;
const ownPort = Number(process.env.EPC_SHOT_PORT) || 3913;
const appUrl = explicitUrl || `http://127.0.0.1:${ownPort}`;

function log(message) {
  console.log(`· ${message}`);
}

/** Can the app be asked for its health right now? */
async function appAnswers(url) {
  try {
    const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await appAnswers(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

let ownServer = null;

/**
 * Stops the app this script started — the whole tree, not just the `npm` wrapper.
 *
 * A bare `kill()` leaves `tsx` and its server alive on Windows, and the port stays taken (the next
 * run then finds an app that is not ours). The tree is killed instead, and the port is given a
 * moment to come free before the process ends.
 */
async function stopOwnServer() {
  if (!ownServer || ownServer.killed) return;
  const pid = ownServer.pid;
  ownServer.killed = true;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      ownServer.kill();
    }
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await appAnswers(appUrl))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

try {
  if (await appAnswers(appUrl)) {
    log(`использую приложение на ${appUrl}`);
  } else if (explicitUrl) {
    throw new Error(`приложение на ${appUrl} не отвечает, а адрес задан вручную`);
  } else {
    log(`запускаю своё приложение на ${appUrl} (это отдельный порт, ваши проекты не тронуты)`);
    ownServer = spawn('npm', ['run', 'dev'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      env: { ...process.env, PORT: String(ownPort) }
    });
    ownServer.stdout.on('data', () => {});
    ownServer.stderr.on('data', (chunk) => process.stderr.write(chunk));
    if (!(await waitForApp(appUrl, 60000))) {
      throw new Error(`приложение не поднялось на ${appUrl}`);
    }
    log('приложение поднялось');
  }

  const bundledElectron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electron = fs.existsSync(bundledElectron) ? bundledElectron : 'electron';
  const main = path.join(here, 'capture-main.cjs');
  if (!fs.existsSync(main)) throw new Error(`не нашёл ${main}`);

  log(`снимаю экраны окном ${width}×${height}`);
  /*
    A window that cannot load its own script does not exit: it stays up and says nothing. Waiting is
    then endless, so the shoot gets a deadline of its own — a run that overruns it is killed and
    reported as such rather than left hanging.
  */
  const run = spawnSync(electron, [main], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    env: {
      ...process.env,
      EPC_SHOT_URL: appUrl,
      EPC_SHOT_DIR: outDir,
      EPC_SHOT_WIDTH: String(width),
      EPC_SHOT_HEIGHT: String(height)
    }
  });

  const stdout = String(run.stdout || '');
  const summaryLine = stdout.split('\n').find((line) => line.startsWith('SCREENSHOTS_JSON '));
  if (run.status !== 0 || !summaryLine) {
    process.stdout.write(stdout);
    process.stderr.write(String(run.stderr || ''));
    if (run.error?.code === 'ETIMEDOUT') {
      throw new Error('съёмка не уложилась в 10 минут и была остановлена — окно не сообщило о конце работы');
    }
    throw new Error(`съёмка экранов не удалась (код ${run.status})`);
  }

  const report = JSON.parse(summaryLine.replace('SCREENSHOTS_JSON ', ''));
  const failed = (report.shots || []).filter((shot) => !shot.ok);
  if (failed.length > 0) {
    throw new Error(`пустыми оказались снимки: ${failed.map((shot) => shot.file).join(', ')}`);
  }

  const sheet = contactSheet(report);
  fs.writeFileSync(path.join(outDir, 'index.html'), sheet);
  log(`кадров: ${report.shots.length}, окно снималось ${report.mode === 'offscreen' ? 'скрыто' : 'на экране'}`);
  log(`контактный лист: ${path.relative(root, path.join(outDir, 'index.html'))}`);
  console.log('\nСмотрите build/screenshots/index.html в панели предпросмотра.');
} catch (error) {
  console.error(`не получилось: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopOwnServer();
}

/**
 * One page with every screen on it: two columns, a label and the picture in each cell, newest run
 * only. Rendered at a readable width, so the whole app can be judged in a couple of screenshots.
 *
 * The pictures are inlined as data URIs rather than linked, because the preview panel serves this
 * one file and nothing next to it: a relative href there answers 404, which is a blank page with a
 * broken-image frame around it. Thumbnails are used when the camera wrote them; the full-size PNGs
 * stay in the folder for looking at a detail.
 */
function contactSheet(report) {
  const labels = {
    '01-wizard': 'Мастер нового проекта',
    '02-dashboard': 'Обзор проекта',
    '03-simple': 'Пошаговый помощник',
    '04-compiler': 'Компилятор промптов',
    '05-review': 'Проверка ответа',
    '06-preview': 'Песочница и код',
    '07-coach': 'Тренер ошибок',
    '08-plan': 'План и задачи',
    '09-map': 'Карта проекта',
    '10-files': 'Файлы проекта',
    '11-brief': 'Бриф и архитектура',
    '12-api-keys': 'Ключи API'
  };
  const cards = (report.shots || [])
    .map((shot) => {
      const thumb = shot.file.replace(/\.png$/, '.jpg');
      const thumbPath = path.join(report.outDir || outDir, 'thumbs', thumb);
      const picture = fs.existsSync(thumbPath) ? thumbPath : path.join(report.outDir || outDir, shot.file);
      const type = picture.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      const data = `data:${type};base64,${fs.readFileSync(picture).toString('base64')}`;
      return `      <figure>
        <figcaption>${labels[shot.file.replace(/\.png$/, '')] || shot.file} <span>${shot.hash}</span></figcaption>
        <img src="${data}" alt="${shot.file}" />
      </figure>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Экраны приложения — ${report.shots.length} кадров</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #020617; color: #e2e8f0; font: 14px/1.4 system-ui, "Segoe UI", sans-serif; }
      header { padding: 16px 20px; border-bottom: 1px solid #1e293b; position: sticky; top: 0; background: #020617ee; backdrop-filter: blur(6px); }
      header h1 { margin: 0; font-size: 15px; }
      header p { margin: 4px 0 0; color: #94a3b8; font-size: 12px; }
      main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 18px 20px 40px; }
      figure { margin: 0; }
      figcaption { font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; display: flex; justify-content: space-between; gap: 8px; }
      figcaption span { color: #64748b; font-weight: 400; font-family: ui-monospace, monospace; }
      img { width: 100%; border: 1px solid #1e293b; border-radius: 10px; display: block; background: #0b1220; }
    </style>
  </head>
  <body>
    <header>
      <h1>Экраны приложения</h1>
      <p>${report.shots.length} кадров · окно ${report.size.width}×${report.size.height} · ${report.url} · съёмка ${
    report.mode === 'offscreen' ? 'скрытым окном' : 'окном на экране'
  }</p>
      <p>Кадры в полном размере — рядом: ${report.shots.map((shot) => shot.file).join(', ')}</p>
    </header>
    <main>
${cards}
    </main>
  </body>
</html>
`;
}
