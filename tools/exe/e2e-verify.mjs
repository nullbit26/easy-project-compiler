/**
 * Scratch end-to-end check for the verification loop and checkpoints: it boots the real server
 * against a sandbox folder (its own workspace file, backup dir and key store, so the developer's
 * data/ is never touched), then drives the HTTP API exactly as the screen does.
 *
 * Usage: node tools/exe/e2e-verify.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PORT = Number(process.env.E2E_PORT || 3177);
// E2E_BASE points the same checks at an already running instance — for example the packaged .exe,
// which cannot be started with the sandbox environment variables below.
const EXTERNAL_BASE = process.env.E2E_BASE || '';
const BASE = EXTERNAL_BASE || `http://127.0.0.1:${PORT}`;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-e2e-'));
const project = path.join(sandbox, 'project');
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
}

function write(relative, content) {
  const absolute = path.join(project, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

function read(relative) {
  return fs.readFileSync(path.join(project, relative), 'utf8');
}

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

// A tiny project whose "build" fails with a real TypeScript-style error.
write('package.json', JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'node check.js' } }, null, 2));
write(
  'check.js',
  [
    "console.log('src/broken.ts(4,2): error TS2339: Property nope does not exist on type Game.');",
    'process.exitCode = 2;'
  ].join('\n')
);
write('app.txt', 'v1\n');
write('src/broken.ts', 'export const broken = () => nope;\n');

const server = EXTERNAL_BASE
  ? null
  : spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    EPC_WORKSPACE_FILE: path.join(sandbox, 'workspace.json'),
    EPC_WORKSPACE_BACKUP_DIR: path.join(sandbox, 'backups'),
    EPC_API_KEYS_FILE: path.join(sandbox, 'keys.json')
  },
      stdio: ['ignore', 'pipe', 'pipe']
    });

let serverLog = '';
if (server) {
  server.stdout.on('data', (chunk) => (serverLog += chunk.toString()));
  server.stderr.on('data', (chunk) => (serverLog += chunk.toString()));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

try {
  check('the app answers on its health endpoint', await waitForServer());

  const bind = await api('POST', '/api/files/bind', { path: project });
  check('folder binds', bind.payload?.data?.root === project, JSON.stringify(bind.payload?.data?.root));

  const checks = await api('GET', '/api/files/checks');
  const buildCheck = checks.payload?.data?.checks?.find((entry) => entry.kind === 'build');
  check('detects the folder’s build check', Boolean(buildCheck), JSON.stringify(checks.payload?.data?.checks));
  check('runs it through the package manager', buildCheck?.commandLine?.includes('run build'), buildCheck?.commandLine);

  const verify = await api('POST', '/api/files/verify', { ids: [buildCheck?.id].filter(Boolean) });
  const report = verify.payload?.data;
  check('verify reports the failure', report?.failed === 1, JSON.stringify(report?.results?.map((r) => r.status)));
  check(
    'reads the file and line out of the output',
    report?.problems?.[0]?.file === 'src/broken.ts' && report?.problems?.[0]?.line === 4,
    JSON.stringify(report?.problems?.[0])
  );
  check('keeps the command output for the screen', (report?.results?.[0]?.output || '').includes('TS2339'));

  const marker = await api('POST', '/api/files/checkpoints', { name: 'до правки' });
  const checkpointId = marker.payload?.data?.checkpoint?.id;
  check('creates a checkpoint', Boolean(checkpointId), JSON.stringify(marker.payload?.data?.checkpoint));
  check('records it as “before any write”', marker.payload?.data?.checkpoint?.changesetId === null);

  const apply = await api('POST', '/api/files/apply', {
    changes: [{ path: 'app.txt', action: 'update', content: 'v2\n' }],
    label: 'рискованная правка'
  });
  check('applies a labelled batch', apply.payload?.data?.applied === 1);
  check('file really changed on disk', read('app.txt') === 'v2\n');

  const verifyAgain = await api('POST', '/api/files/verify', {
    ids: [buildCheck?.id].filter(Boolean),
    changesetId: apply.payload?.data?.backupId
  });
  const timeline = verifyAgain.payload?.data?.timeline || [];
  check('the check result lands on the batch', timeline[0]?.verification?.ok === false, JSON.stringify(timeline[0]?.verification));
  check('the batch keeps its label', timeline[0]?.label === 'рискованная правка', timeline[0]?.label);
  check('the batch lists the files it touched', timeline[0]?.paths?.includes('app.txt'));

  const rollback = await api('POST', '/api/files/rollback', { checkpointId });
  check('rollback reports what it undid', rollback.payload?.data?.undoneChangesets === 1, JSON.stringify(rollback.payload?.data?.undoneChangesets));
  check('the folder is back to the checkpoint state', read('app.txt') === 'v1\n', read('app.txt'));
  check('the timeline admits the batch was rolled back', rollback.payload?.data?.scan?.timeline?.[0]?.rolledBackAt);

  const unknown = await api('POST', '/api/files/rollback', { checkpointId: 'cp-nope' });
  check('an unknown checkpoint is refused', unknown.status === 404, `status ${unknown.status}`);

  // A typed command is added to the selected checks, so it is found by its own id.
  const unsafe = await api('POST', '/api/files/verify', { customCommand: 'node check.js && curl http://example.com' });
  const custom = unsafe.payload?.data?.results?.find((entry) => entry.id === 'custom:user');
  check('a chained shell command is refused', custom?.status === 'unavailable', JSON.stringify(custom?.error));

  const fix = await api('POST', '/api/files/fix-checks', { verification: report });
  check(
    'repair asks for a model key instead of failing silently',
    fix.status === 400 && fix.payload?.error === 'no_ai_provider',
    `${fix.status} ${fix.payload?.error}`
  );

  // Ask for a repair again with no failing checks: it must refuse instead of inventing work.
  const passing = await api('POST', '/api/files/verify', { customCommand: 'node -v', ids: [] });
  const nothing = await api('POST', '/api/files/fix-checks', { verification: passing.payload?.data });
  check(
    'nothing to fix is reported as such',
    nothing.status === 400 && nothing.payload?.error === 'nothing_to_fix',
    `${nothing.status} ${nothing.payload?.error}`
  );
} catch (err) {
  check('the run finished without throwing', false, err?.stack || String(err));
} finally {
  server?.kill('SIGKILL');
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok || !result.detail ? '' : `  →  ${result.detail}`}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures > 0) {
  console.log('\n--- server log (tail) ---\n' + serverLog.split('\n').slice(-25).join('\n'));
}
fs.rmSync(sandbox, { recursive: true, force: true });
process.exit(failures > 0 ? 1 : 0);
