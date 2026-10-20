import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { EVAL_CASES } from '../../tools/eval/cases';
import {
  answerFromVisibleFiles,
  formatReport,
  materializeFixture,
  runEval,
  scoreFixture,
  typecheckFixture
} from '../../tools/eval/run';
import { getWorkspaceRoot } from '../../server/store/workspaceStore';

/**
 * An eval is only worth its runtime if its own house is in order, so these tests check the
 * harness before they check the feature:
 *   - every fixture starts as a compiling project and its reference patch passes its own checks;
 *   - the task never names the file the case needs, which is the whole design;
 *   - legacy and graph are held against the same answerer, and the difference is visible;
 *   - a run leaves the user's connected folder and environment exactly as it found them.
 *
 * Most comparison runs use `typecheck: false`; the fixture test is the one that runs `tsc` for
 * every case, so a broken patch fails there instead of quietly scoring as a pass.
 */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-eval-test-'));

beforeAll(() => {
  // The developer's real folder must never be read by these runs.
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeSolution(dir: string, evalCase: (typeof EVAL_CASES)[number]): void {
  for (const [filePath, content] of Object.entries(evalCase.solution)) {
    const absolute = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

describe('the fixtures', () => {
  it('never let the task name the file the case is about', () => {
    for (const evalCase of EVAL_CASES) {
      expect(evalCase.needsContext.length).toBeGreaterThan(0);
      for (const needed of evalCase.needsContext) {
        expect(Object.keys(evalCase.files)).toContain(needed);
        expect(evalCase.task.targetFiles).not.toContain(needed);
      }
    }
  });

  it('start as a compiling project and end as one that passes the case checks', () => {
    for (const evalCase of EVAL_CASES) {
      const initial = path.join(sandbox, `${evalCase.id}-initial`);
      fs.mkdirSync(initial, { recursive: true });
      materializeFixture(initial, evalCase);
      if (evalCase.typecheck) {
        const compiled = typecheckFixture(initial);
        expect(compiled, `${evalCase.id} does not compile before the task: ${compiled.note || ''}`).toMatchObject({
          ok: true
        });
      }

      const fixed = path.join(sandbox, `${evalCase.id}-fixed`);
      fs.mkdirSync(fixed, { recursive: true });
      materializeFixture(fixed, evalCase);
      writeSolution(fixed, evalCase);
      const score = scoreFixture(fixed, evalCase, true);
      expect(score, `${evalCase.id}: ${score.note || ''}`).toMatchObject({ pass: true });

      // …and the untouched project is not already passing the case's assertions.
      expect(scoreFixture(initial, evalCase, false).pass, `${evalCase.id} passes untouched`).toBe(false);
    }
  }, 120_000);
});

describe('runEval', () => {
  it('shows what the graph buys: recall and pass@1 over the same answerer', async () => {
    const report = await runEval({ typecheck: false });

    const legacy = report.strategies.find((s) => s.strategy === 'legacy')!;
    const graph = report.strategies.find((s) => s.strategy === 'graph')!;

    expect(report.cases).toBe(EVAL_CASES.length);
    expect(graph.recall).toBe(1);
    expect(graph.passAt1).toBe(1);
    // The old selection only ever saw the files the task named, so it cannot carry the one that
    // matters — this is the measurement the feature exists to move.
    expect(legacy.recall).toBe(0);
    expect(legacy.passAt1).toBeLessThan(graph.passAt1);
    expect(report.rows.filter((row) => row.strategy === 'legacy').every((row) => row.missing.length > 0)).toBe(true);
  });

  it('passes with a complete answer regardless of context, which is what a working check means', async () => {
    // `tsc` is left to the fixture test above; here the question is the scorer, not the compiler.
    const report = await runEval({
      typecheck: false,
      answer: (prompt, evalCase) => ({
        changes: Object.entries(evalCase.solution).map(([filePath, content]) => ({ path: filePath, content }))
      })
    });

    for (const summary of report.strategies) expect(summary.passAt1).toBe(1);
  }, 180_000);

  it('reports an answerer that changes nothing as a failure, without throwing', async () => {
    const report = await runEval({ typecheck: false, answer: () => ({ changes: [] }) });
    expect(report.rows.every((row) => row.pass === false)).toBe(true);
  });

  it('crops the graph when the budget is tiny, and says which file it missed', async () => {
    const report = await runEval({
      typecheck: false,
      strategies: ['graph'],
      budgetChars: 10
    });

    expect(report.strategies[0].recall).toBe(0);
    for (const row of report.rows) expect(row.missing.length).toBeGreaterThan(0);
  });

  it('gives the same numbers twice in a row', async () => {
    const first = await runEval({ typecheck: false });
    const second = await runEval({ typecheck: false });
    expect(first.rows).toEqual(second.rows);
  });

  it('leaves the workspace and its environment as it found them', async () => {
    const before = process.env.EPC_WORKSPACE_FILE;
    expect(getWorkspaceRoot()).toBeNull();

    await runEval({ typecheck: false, strategies: ['graph'], cases: [EVAL_CASES[0]] });

    expect(process.env.EPC_WORKSPACE_FILE).toBe(before);
    expect(getWorkspaceRoot()).toBeNull();
  });

  it('prints a table, not a paragraph', async () => {
    const report = await runEval({ typecheck: false });
    const text = formatReport(report);
    expect(text).toContain('legacy');
    expect(text).toContain('graph');
    expect(text).toContain('pass@1');
    expect(text.split('\n').length).toBeLessThan(20);
  });
});

describe('answerFromVisibleFiles', () => {
  it('edits only the files whose current body is in the prompt', () => {
    const evalCase = EVAL_CASES[0];
    const visible = `### FILE: src/service.ts\n\`\`\`\n${evalCase.files['src/service.ts']}\n\`\`\``;

    const answer = answerFromVisibleFiles(visible, evalCase);
    expect(answer.changes.map((change) => change.path)).toEqual(['src/service.ts']);
  });
});
