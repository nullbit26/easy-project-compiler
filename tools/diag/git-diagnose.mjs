/**
 * Temporary: why do the Git tests pass on a developer's machine and fail on a runner?
 *
 * The suite's own answers are not enough to tell — the service reports "nothing changed" for a file
 * that was just written. This script repeats the same few Git commands a test repeats, prints every
 * exit code, both streams and the configuration they ran under, and prefixes each line with
 * `::error::` so the runner's annotations carry it back out of CI without a token.
 *
 * Delete this file and its workflow step once the answer is known.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const say = (line) => console.log(`::error::${line}`);

function run(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  return {
    code: result.status,
    out: (result.stdout || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    err: (result.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  };
}

const show = (label, result) => say(`${label} code=${result.code} out=${JSON.stringify(result.out)} err=${JSON.stringify(result.err)}`);

say(`where: tmpdir=${os.tmpdir()} cwd=${process.cwd()} user=${process.env.USERNAME || '?'} home=${process.env.USERPROFILE || '?'}`);
say(`env: GIT_CEILING_DIRECTORIES=${process.env.GIT_CEILING_DIRECTORIES || '(unset)'} GIT_CONFIG_GLOBAL=${process.env.GIT_CONFIG_GLOBAL || '(unset)'} GIT_CONFIG_SYSTEM=${process.env.GIT_CONFIG_SYSTEM || '(unset)'} GIT_DIR=${process.env.GIT_DIR || '(unset)'} TEMP=${process.env.TEMP || '(unset)'}`);
show('git --version', run(['--version']));
show('git config --list --show-origin', run(['config', '--list', '--show-origin']));
show('git config --global --get user.email', run(['config', '--global', '--get', 'user.email']));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-diag-'));
const project = fs.mkdtempSync(path.join(sandbox, 'project-'));
say(`repo: ${project}`);

const oldCeiling = process.env.GIT_CEILING_DIRECTORIES;
process.env.GIT_CEILING_DIRECTORIES = os.tmpdir();

show('git init', run(['init', '-q', '.'], project));
show('git config user.email', run(['config', 'user.email', 'tester@example.com'], project));
show('git config user.name', run(['config', 'user.name', 'Tester'], project));
show('git config --get user.email', run(['config', '--get', 'user.email'], project));
show('git rev-parse --show-toplevel', run(['rev-parse', '--show-toplevel'], project));

fs.writeFileSync(path.join(project, 'a.txt'), 'one\n', 'utf8');
show('status after first write', run(['status', '--porcelain'], project));
show('status --untracked-files=all', run(['status', '--porcelain', '--untracked-files=all'], project));
show('git add -A', run(['add', '-A'], project));
show('git commit', run(['commit', '-q', '-m', 'first'], project));

fs.writeFileSync(path.join(project, 'a.txt'), 'one\ntwo\n', 'utf8');
fs.writeFileSync(path.join(project, 'new.txt'), 'fresh\n', 'utf8');
const afterWrite = run(['status', '--porcelain'], project);
show('status after second write', afterWrite);
say(`file: exists=${fs.existsSync(path.join(project, 'a.txt'))} size=${fs.statSync(path.join(project, 'a.txt')).size} mtime=${fs.statSync(path.join(project, 'a.txt')).mtime.toISOString()}`);
show('git diff --stat', run(['diff', '--stat'], project));
show('git status --no-optional-locks=false', run(['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'status', '--porcelain'], project));
show('git ls-files -m', run(['ls-files', '-m'], project));

for (const [key, value] of [['core.fsmonitor', run(['config', '--get', 'core.fsmonitor'], project)], ['core.untrackedCache', run(['config', '--get', 'core.untrackedCache'], project)], ['core.autocrlf', run(['config', '--get', 'core.autocrlf'], project)], ['core.checkStat', run(['config', '--get', 'core.checkStat'], project)], ['safe.directory', run(['config', '--get-all', 'safe.directory'], project)]]) {
  show(`config ${key}`, value);
}

if (oldCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
else process.env.GIT_CEILING_DIRECTORIES = oldCeiling;

try {
  fs.rmSync(sandbox, { recursive: true, force: true });
} catch {
  /* the sandbox is temporary either way */
}
