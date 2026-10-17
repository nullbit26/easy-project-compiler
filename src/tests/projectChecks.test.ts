import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  capOutput,
  parseCheckOutput,
  stripAnsi,
  summarizeProblems
} from '../../server/utils/checkOutputParser';
import { detectChecks, parseCustomCommand, runVerification } from '../../server/services/projectChecks';
import { readVerificationBaseline } from '../../server/store/verificationBaseline';

/**
 * The verification loop is only as good as its two halves: reading a tool's output correctly,
 * and running the right command in the right folder. Both are tested here on real files.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-checks-'));
  // The comparison history is redirected into the sandbox too: these tests run real commands and
  // must never read or write the developer's own history file.
  process.env.EPC_VERIFICATION_FILE = path.join(sandbox, 'verification.json');
});

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeProjectFile(relative: string, content: string): void {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

describe('Reading a check’s output', () => {
  it('0. reads a linter line that names a location and a severity', () => {
    // The shape a linter prints when it exits 0: nothing failed, and the finding is still real.
    const problems = parseCheckOutput('src/main.js:3:5 warning: unused variable leftover\n');

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      file: 'src/main.js',
      line: 3,
      column: 5,
      severity: 'warning',
      message: 'unused variable leftover'
    });

    // An error in the same shape is read the same way…
    expect(parseCheckOutput('src/main.js:9:1 error: unexpected token')[0]).toMatchObject({
      severity: 'error',
      line: 9
    });
    // …and prose that only mentions a warning is not a finding.
    expect(parseCheckOutput('Found 0 warnings, everything is fine.')).toHaveLength(0);

    // The app runs scripts through npm, and npm echoes the command it ran: that echo contains the
    // linter's finding word for word, and reporting it would double every problem.
    const withNpmNotice = parseCheckOutput(
      [
        'npm notice run node -e "console.warn(\'src/main.js:3:5 warning: unused variable leftover\')"',
        'src/main.js:3:5 warning: unused variable leftover'
      ].join('\n')
    );
    expect(withNpmNotice).toHaveLength(1);
    expect(withNpmNotice[0].file).toBe('src/main.js');
  });

  it('1. reads the tsc "file(line,col): error TSxxxx" dialect', () => {
    const problems = parseCheckOutput(
      "src/App.tsx(28,14): error TS2339: Property 'items' does not exist on type 'State'.\n"
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('src/App.tsx');
    expect(problems[0].line).toBe(28);
    expect(problems[0].column).toBe(14);
    expect(problems[0].code).toBe('TS2339');
    expect(problems[0].severity).toBe('error');
  });

  it('2. reads the "file:line:col - error" and the bundler "file:line:col: message" dialects', () => {
    const dash = parseCheckOutput('src/main.ts:5:3 - error TS2304: Cannot find name "x".\n');
    expect(dash[0]).toMatchObject({ file: 'src/main.ts', line: 5, column: 3 });

    const bundler = parseCheckOutput('src/App.tsx:12:9: ERROR: Unexpected token\n');
    expect(bundler[0]).toMatchObject({ file: 'src/App.tsx', line: 12, column: 9 });
  });

  it('3. attaches eslint findings to the file line above them', () => {
    const problems = parseCheckOutput(
      ['/project/src/App.tsx', '  28:14  error  "items" is assigned but never used  no-unused-vars', ''].join('\n'),
      { root: '/project' }
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('src/App.tsx');
    expect(problems[0].line).toBe(28);
    expect(problems[0].code).toBe('no-unused-vars');
  });

  it('4. reads pytest failures and python tracebacks', () => {
    const pytest = parseCheckOutput('FAILED tests/test_api.py::test_login - AssertionError: assert 401 == 200\n');
    expect(pytest[0].file).toBe('tests/test_api.py');
    expect(pytest[0].message).toContain('AssertionError');

    const traceback = parseCheckOutput(
      ['Traceback (most recent call last):', '  File "app/main.py", line 42, in handler', '    return user.name', 'AttributeError: NoneType has no attribute name'].join('\n')
    );
    const fromTraceback = traceback.find((problem) => problem.file === 'app/main.py');
    expect(fromTraceback?.line).toBe(42);
    expect(traceback.some((problem) => problem.message.includes('AttributeError'))).toBe(true);
  });

  it('5. relativizes absolute paths and ignores noise and duplicates', () => {
    const problems = parseCheckOutput(
      [
        '> project@1.0.0 typecheck',
        'Found 0 errors. Watching for file changes.',
        '/project/src/a.ts(3,1): error TS1005: ; expected.',
        '/project/src/a.ts(3,1): error TS1005: ; expected.'
      ].join('\n'),
      { root: '/project' }
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('src/a.ts');
  });

  it('6. counts severities and strips colour codes', () => {
    const output = '\u001b[31msrc/a.ts(1,1): error TS1: bad\u001b[0m\nsrc/a.ts(2,1): warning TS2: meh\n';
    const problems = parseCheckOutput(output);
    expect(stripAnsi(output)).not.toContain('\u001b');
    expect(summarizeProblems(problems)).toEqual({ errors: 1, warnings: 1 });
  });

  it('19. reads the names of the tests that failed, not just the file', () => {
    const vitest = parseCheckOutput(
      [
        'FAIL src/math.test.js > adding > adds two numbers',
        '  × adds two numbers',
        '  ✓ subtracts numbers',
        'Tests  1 failed | 1 passed (2)'
      ].join('\n')
    );

    expect(vitest.some((problem) => problem.message === 'Failed test: adding > adds two numbers')).toBe(true);
    expect(vitest.some((problem) => problem.message === 'Failed test: adds two numbers')).toBe(true);
    // The summary line mentions a number of failures but is not one itself.
    expect(vitest.every((problem) => !problem.message.startsWith('Tests'))).toBe(true);
    // The passing test is not a problem either.
    expect(vitest.every((problem) => !problem.message.includes('subtracts numbers'))).toBe(true);
  });

  it('7. keeps a bounded amount of output, head and tail', () => {
    const capped = capOutput('a'.repeat(1000), 100, 200);
    expect(capped.truncated).toBe(true);
    expect(capped.text.startsWith('a'.repeat(100))).toBe(true);
    expect(capped.text).toContain('characters omitted');
    expect(capOutput('short', 100, 200)).toEqual({ text: 'short', truncated: false });
  });
});

describe('Deciding what to run in a folder', () => {
  it('8. prefers the project’s own local binaries over package scripts', () => {
    writeProjectFile('package.json', JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit', build: 'vite build', test: 'vitest' },
      devDependencies: { typescript: '5.8.2', vitest: '4.1.10' }
    }));
    writeProjectFile('tsconfig.json', '{}');
    writeProjectFile('node_modules/typescript/bin/tsc', '// stub');
    writeProjectFile('node_modules/vitest/vitest.mjs', '// stub');

    const checks = detectChecks(projectRoot);
    const typecheck = checks.find((check) => check.kind === 'typecheck');
    const test = checks.find((check) => check.kind === 'test');
    const build = checks.find((check) => check.kind === 'build');

    // --pretty false is what keeps tsc's output parseable.
    expect(typecheck?.tokens).toEqual(['node', 'node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']);
    // "vitest" alone would sit in watch mode forever, so it is always run in one-shot form.
    expect(test?.tokens).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run', '--reporter', 'basic']);
    expect(build?.tokens).toEqual(['npm', 'run', 'build']);
  });

  it('9. respects the lockfile when picking a package manager', () => {
    writeProjectFile('package.json', JSON.stringify({ scripts: { build: 'vite build' } }));
    writeProjectFile('bun.lock', '');
    const checks = detectChecks(projectRoot);
    expect(checks.find((check) => check.kind === 'build')?.tokens).toEqual(['bun', 'run', 'build']);
  });

  it('10. finds C#, Rust and Go projects and reports nothing for an empty folder', () => {
    expect(detectChecks(projectRoot)).toHaveLength(0);

    writeProjectFile('Game.csproj', '<Project />');
    expect(detectChecks(projectRoot).some((check) => check.key === 'dotnet')).toBe(true);

    fs.rmSync(path.join(projectRoot, 'Game.csproj'));
    writeProjectFile('Cargo.toml', '[package]');
    writeProjectFile('go.mod', 'module demo');
    const checks = detectChecks(projectRoot).map((check) => check.key);
    expect(checks).toContain('cargo');
    expect(checks).toContain('go');
  });
});

describe('Running a check', () => {
  it('11. runs a custom command, keeps its output and parses the failure', async () => {
    writeProjectFile(
      'check.js',
      [
        "console.log('src/broken.ts(4,2): error TS2339: Property nope does not exist.');",
        'process.exitCode = 2;'
      ].join('\n')
    );

    const report = await runVerification({ root: projectRoot, customCommand: 'node check.js' });

    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].exitCode).toBe(2);
    expect(report.problems[0]).toMatchObject({ file: 'src/broken.ts', line: 4, code: 'TS2339' });
  });

  it('12. reports success when the command exits cleanly', async () => {
    writeProjectFile('check.js', "console.log('all good');\n");
    const report = await runVerification({ root: projectRoot, customCommand: 'node check.js' });
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(1);
    expect(report.problems).toHaveLength(0);
  });

  it('13. refuses a command that is not on the allowed list', async () => {
    const report = await runVerification({ root: projectRoot, customCommand: 'curl http://example.com' });
    expect(report.results[0].status).toBe('unavailable');
    expect(report.results[0].error).toContain('allowed list');
  });

  it('14. refuses shell chaining instead of pretending to run it', async () => {
    const parsed = parseCustomCommand('node check.js && rm -rf .');
    expect(parsed.error).toBe('unsafe');
    expect(parsed.tokens).toEqual([]);

    const report = await runVerification({ root: projectRoot, customCommand: 'node check.js | tee log.txt' });
    expect(report.results[0].status).toBe('unavailable');
  });

  it('15. stops a command that never finishes', async () => {
    writeProjectFile('hang.js', 'setTimeout(() => {}, 60_000);\n');
    // The runner’s own timeout is kind-specific, so the hanging case is exercised directly.
    const { runCommand } = await import('../../server/services/projectChecks');
    const run = await runCommand({ root: projectRoot, tokens: ['node', 'hang.js'], timeoutMs: 1_500 });
    expect(run.status).toBe('timeout');
    expect(run.error).toContain('Stopped after');
  }, 20_000);

  it('16. reports a missing tool instead of crashing', async () => {
    const report = await runVerification({ root: projectRoot, customCommand: 'dotnet build' });
    // Either dotnet exists on this machine (and fails on this empty folder) or it is missing.
    expect(['failed', 'unavailable']).toContain(report.results[0].status);
    /*
     * The assertion is about the outcome, never about the speed — but this one starts a real SDK
     * when the machine has one, and a cold release runner needs a few seconds before the CLI says
     * anything at all. The default five seconds measured the runner, not the app: it failed a
     * release run on a machine where dotnet is simply slower to start than on the machine the test
     * was written on.
     */
  }, 30_000);

  it('17. never reports an empty run as a passing run', async () => {
    writeProjectFile('package.json', JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }));

    // The screen re-checks a repair with the ids that failed, and a typed command has an id the
    // folder itself does not list: with no command sent along, nothing ran and the answer said ok.
    const empty = await runVerification({ root: projectRoot, ids: ['custom:user'] });
    expect(empty.ok).toBe(false);
    expect(empty.results).toHaveLength(1);
    expect(empty.results[0]).toMatchObject({ id: 'custom:user', status: 'unavailable' });
    expect(empty.skipped).toBe(1);

    // The same id plus the command itself is one real run, and it is the one that counts.
    writeProjectFile('check.js', 'process.exit(0);\n');
    const real = await runVerification({ root: projectRoot, ids: ['custom:user'], customCommand: 'node check.js' });
    expect(real.ok).toBe(true);
    expect(real.results).toHaveLength(1);
    expect(real.results[0]).toMatchObject({ id: 'custom:user', status: 'passed' });
    expect(real.skipped).toBe(0);
  });

  it('23. gives a command that asks a question end-of-file instead of the whole timeout', async () => {
    // A tool nobody can answer — a runner in its interactive mode, a script blocked on a prompt — must
    // read end-of-file and take its own default, because nobody is there to type at it. It used to sit
    // on an open pipe until the timeout (150–300 s in the real app) and then be reported as "stopped".
    writeProjectFile(
      'ask.js',
      [
        "process.stdin.on('end', () => {",
        "  console.log('stdin closed');",
        '  process.exit(3);',
        '});',
        'process.stdin.resume();',
        'setTimeout(() => process.exit(0), 30_000);'
      ].join('\n')
    );

    const { runCommand } = await import('../../server/services/projectChecks');
    const run = await runCommand({ root: projectRoot, tokens: ['node', 'ask.js'], timeoutMs: 8_000 });

    // Its own decision, its own exit code — not the runner's timeout.
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(3);
    expect(run.output).toContain('stdin closed');
    expect(run.error).toBeUndefined();
    expect(run.durationMs).toBeLessThan(5_000);
  }, 20_000);

  it('24. stops the checks still running when the app itself goes away', async () => {
    // A timeout only fires in the process that owns it. Closed while a build was running, the build
    // used to be orphaned and kept working in the user's folder with no screen left to report it on.
    writeProjectFile('long.js', 'setTimeout(() => {}, 60_000);\n');

    const { killRunningChecks, runCommand } = await import('../../server/services/projectChecks');
    const started = Date.now();
    const run = runCommand({ root: projectRoot, tokens: ['node', 'long.js'], timeoutMs: 60_000 });

    // Give it a moment to actually be running, then close the app, as the real shutdown hook does.
    await new Promise((resolve) => setTimeout(resolve, 700));
    killRunningChecks();

    const result = await run;
    expect(result.status).toBe('failed');
    expect(result.durationMs).toBeLessThan(30_000);
    expect(Date.now() - started).toBeLessThan(30_000);

    // Nothing is left over: a second call has nothing to do, and the folder is free again.
    expect(() => killRunningChecks()).not.toThrow();
  }, 40_000);

  it('18. reads node’s own syntax error down to the caret, as a folder-relative path', async () => {
    writeProjectFile(
      'src/game.js',
      ['function scoreFor(glasses) {', '  const base = glasses * 10;', '  return base +', '}', ''].join('\n')
    );

    const report = await runVerification({ root: projectRoot, customCommand: 'node --check src/game.js' });

    expect(report.ok).toBe(false);
    // The reason line below the caret is not added a second time as a location-less problem.
    expect(report.problems).toHaveLength(1);
    const problem = report.problems[0];
    // File, line and the caret column: exactly what the repair step needs to fix this file only.
    expect(problem.file).toBe('src/game.js');
    expect(problem.line).toBe(4);
    expect(problem.column).toBe(1);
    expect(problem.message).toContain('SyntaxError');
    // The path the tool printed is absolute, and the user must not be shown their own home folder.
    expect(problem.raw).not.toContain(projectRoot);
  });
});

/**
 * The verdict is the point of the whole loop: not "the check failed" but "the check that used to
 * pass is broken now". These tests run the same folder three times — green, broken, repaired —
 * and read the answer each time.
 */
describe('The verdict between runs', () => {
  const MARKER_CHECK = [
    "const fs = require('fs');",
    "const code = fs.readFileSync('src/math.js', 'utf8');",
    "if (code.includes('BROKEN')) {",
    "  console.log('src/math.js(3,1): error TS2322: the BROKEN marker is still there.');",
    '  process.exit(1);',
    '}',
    "console.log('all good');"
  ].join('\n');

  it('20. says what a change broke, and then what a repair fixed', async () => {
    writeProjectFile('check.js', MARKER_CHECK);
    writeProjectFile('src/math.js', 'export const two = 2;\n');

    // 1. A green run: it becomes the state later runs are compared against.
    const first = await runVerification({ root: projectRoot, customCommand: 'node check.js' });
    expect(first.ok).toBe(true);
    expect(first.delta?.compared).toBe(false);

    // 2. The change breaks it.
    writeProjectFile('src/math.js', 'export const two = 2;\nexport const broken = true; // BROKEN\n');
    const second = await runVerification({ root: projectRoot, customCommand: 'node check.js' });

    expect(second.ok).toBe(false);
    expect(second.delta?.compared).toBe(true);
    expect(second.delta?.regressedChecks.map((check) => check.id)).toEqual(['custom:user']);
    expect(second.delta?.regressedChecks[0]).toMatchObject({ from: 'passed', to: 'failed' });
    expect(second.delta?.newProblems).toHaveLength(1);
    expect(second.delta?.newProblems[0]).toMatchObject({ checkId: 'custom:user', file: 'src/math.js', line: 3 });
    expect(second.delta?.fixedProblems).toHaveLength(0);
    // The screen does not have to repeat the comparison: the report arrives already tagged.
    expect(second.problems[0].change).toBe('new');

    // 3. The repair brings it back.
    writeProjectFile('src/math.js', 'export const two = 2;\n');
    const third = await runVerification({ root: projectRoot, customCommand: 'node check.js' });

    expect(third.ok).toBe(true);
    expect(third.delta?.compared).toBe(true);
    expect(third.delta?.recoveredChecks.map((check) => check.id)).toEqual(['custom:user']);
    expect(third.delta?.newProblems).toHaveLength(0);
    expect(third.delta?.fixedProblems.map((problem) => problem.message)).toEqual([
      'the BROKEN marker is still there.'
    ]);

    // The history is on disk, so a restart does not lose the comparison.
    const stored = readVerificationBaseline(projectRoot);
    expect(stored?.checks[0]).toMatchObject({ id: 'custom:user', status: 'passed' });
    expect(stored?.problems).toHaveLength(0);
  });

  it('21. keeps an old error as "pre-existing" instead of blaming it on the change', async () => {
    writeProjectFile(
      'check.js',
      [
        "const fs = require('fs');",
        "const extra = fs.existsSync('src/extra.js');",
        "console.log('src/legacy.js(1,1): error TS2304: Cannot find name legacy.');",
        'if (extra) {',
        "  console.log('src/extra.js(2,1): error TS2322: extra file is broken.');",
        '}',
        'process.exit(1);'
      ].join('\n')
    );

    const first = await runVerification({ root: projectRoot, customCommand: 'node check.js' });
    expect(first.delta?.compared).toBe(false);
    expect(first.problems).toHaveLength(1);

    // The change adds a *second* failure while the first one is untouched.
    writeProjectFile('src/extra.js', 'export const extra = true;\n');
    const second = await runVerification({ root: projectRoot, customCommand: 'node check.js' });

    expect(second.delta?.compared).toBe(true);
    expect(second.delta?.newProblems.map((problem) => problem.file)).toEqual(['src/extra.js']);
    expect(second.delta?.persistentProblems.map((problem) => problem.file)).toEqual(['src/legacy.js']);

    const tagged = new Map(second.problems.map((problem) => [problem.file, problem.change]));
    expect(tagged.get('src/extra.js')).toBe('new');
    expect(tagged.get('src/legacy.js')).toBe('persistent');
  });

  it('22. keeps the warning a passing check printed, and calls it new after a change', async () => {
    // Nothing untidy yet: this run is the state later runs are compared against.
    writeProjectFile('check.js', "console.log('all good');\n");
    const first = await runVerification({ root: projectRoot, customCommand: 'node check.js' });
    expect(first.ok).toBe(true);
    expect(first.problems).toHaveLength(0);

    // The change adds a warning while every check still passes.
    writeProjectFile(
      'check.js',
      "console.log('src/math.js:3:5 warning: unused variable leftover');\n"
    );
    const second = await runVerification({ root: projectRoot, customCommand: 'node check.js' });

    // Green — and the finding is kept, tagged as this change's doing.
    expect(second.ok).toBe(true);
    expect(second.failed).toBe(0);
    expect(second.problems).toHaveLength(1);
    expect(second.problems[0]).toMatchObject({ file: 'src/math.js', severity: 'warning', change: 'new' });
    expect(second.delta?.compared).toBe(true);
    expect(second.delta?.regressedChecks).toEqual([]);
    expect(second.delta?.newProblems).toHaveLength(1);
    expect(summarizeProblems(second.problems)).toEqual({ errors: 0, warnings: 1 });
  });
});
