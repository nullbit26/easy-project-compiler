import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { EVAL_CASES, type EvalCase } from './cases';
import { legacySections, type SectionPlan } from './legacyContext';
import { assembleTaskPrompt } from '../../server/services/autonomousLoop';
import { planTaskContext } from '../../server/services/contextPlan';
import { bindWorkspace, unbindWorkspace } from '../../server/store/workspaceStore';

/**
 * The eval: two context strategies, one answerer, one pass@1.
 *
 * It answers a question the feature cannot answer by itself — does the extra context change the
 * outcome? — without pretending to benchmark a model it did not call. By default the answerer is
 * `answerFromVisibleFiles`: it reproduces the reference patch for the files the prompt actually
 * showed, and for nothing else. That is a simulated model with one honest limitation (it cannot
 * edit what it never saw), and it makes the measurement deterministic. `--live` swaps in the
 * app's own provider for a real model, same prompts, same scorer.
 */

export type Strategy = 'legacy' | 'graph';
export const STRATEGIES: Strategy[] = ['legacy', 'graph'];

export interface EvalAnswer {
  summary?: string;
  changes: Array<{ path: string; content: string }>;
}

export type AnswerFn = (prompt: string, evalCase: EvalCase) => Promise<EvalAnswer> | EvalAnswer;

export interface EvalOptions {
  cases?: EvalCase[];
  strategies?: Strategy[];
  answer?: AnswerFn;
  /** Off for a fast run that only checks the declared assertions. */
  typecheck?: boolean;
  budgetChars?: number;
  perFileChars?: number;
  /** Keep the temp folders, for looking at a failure by hand. */
  keep?: boolean;
}

export interface CaseRow {
  caseId: string;
  strategy: Strategy;
  contextFiles: number;
  contextChars: number;
  recall: boolean;
  missing: string[];
  pass: boolean;
  note?: string;
}

export interface StrategySummary {
  strategy: Strategy;
  cases: number;
  passed: number;
  passAt1: number;
  recall: number;
  avgContextFiles: number;
  avgContextChars: number;
}

export interface EvalReport {
  answer: 'offline' | 'live';
  cases: number;
  rows: CaseRow[];
  strategies: StrategySummary[];
}

/**
 * The offline stand-in: a model that can only rewrite the files it was shown.
 *
 * `solution` is complete file content, so a file is "seen" when its current body is in the
 * prompt. A patch whose other half lives in a file the prompt omitted simply is not written —
 * and the checks say so.
 */
export function answerFromVisibleFiles(prompt: string, evalCase: EvalCase): EvalAnswer {
  const changes: EvalAnswer['changes'] = [];
  for (const [filePath, content] of Object.entries(evalCase.solution)) {
    const current = evalCase.files[filePath];
    if (current === undefined) continue;
    if (!prompt.includes(current.trim())) continue;
    changes.push({ path: filePath, content });
  }
  return { summary: 'offline answerer', changes };
}

/** Writes a case's files into a folder. Exported for the harness's own tests. */
export function materializeFixture(dir: string, evalCase: EvalCase): void {
  for (const [filePath, content] of Object.entries(evalCase.files)) {
    const absolute = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  },
  include: ['**/*.ts']
};

const TSC_BIN = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');

/** Writes the shared tsconfig and runs `tsc --noEmit` over a folder. */
export function typecheckFixture(dir: string): { ok: boolean; note?: string } {
  if (!fs.existsSync(TSC_BIN)) {
    throw new Error('TypeScript is not installed: the eval needs it to verify its own fixtures.');
  }
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`, 'utf8');
  try {
    execFileSync(process.execPath, [TSC_BIN, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true };
  } catch (err: any) {
    const detail = `${err?.stdout || ''}${err?.stderr || ''}`.trim().split('\n')[0];
    return { ok: false, note: `typecheck: ${detail || `exit ${err?.status ?? '?'}`}` };
  }
}

function applyAnswer(dir: string, answer: EvalAnswer): void {
  const root = path.resolve(dir);
  for (const change of answer.changes) {
    const absolute = path.resolve(root, change.path);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, change.content, 'utf8');
  }
}

/** Checks and (optionally) `tsc` on a folder that already holds the answer. */
export function scoreFixture(
  dir: string,
  evalCase: EvalCase,
  runTypecheck: boolean
): { pass: boolean; note?: string } {
  for (const check of evalCase.checks) {
    const absolute = path.join(dir, check.path);
    if (!fs.existsSync(absolute)) return { pass: false, note: `missing ${check.path}` };
    const text = fs.readFileSync(absolute, 'utf8');
    for (const wanted of check.includes || []) {
      if (!text.includes(wanted)) return { pass: false, note: `${check.path} lacks ${JSON.stringify(wanted)}` };
    }
    for (const unwanted of check.excludes || []) {
      if (text.includes(unwanted)) return { pass: false, note: `${check.path} still has ${JSON.stringify(unwanted)}` };
    }
  }
  if (runTypecheck && evalCase.typecheck) {
    const result = typecheckFixture(dir);
    if (!result.ok) return { pass: false, note: result.note };
  }
  return { pass: true };
}

function planFor(
  strategy: Strategy,
  evalCase: EvalCase,
  options: { budgetChars?: number; perFileChars?: number }
): SectionPlan & { files: number } {
  if (strategy === 'legacy') {
    const plan = legacySections(evalCase.task.targetFiles);
    return { ...plan, files: plan.paths.length };
  }
  const plan = planTaskContext({
    seeds: evalCase.task.targetFiles,
    budgetChars: options.budgetChars,
    perFileChars: options.perFileChars
  });
  const shown = plan.entries.filter((entry) => entry.chars > 0);
  return {
    blocks: plan.blocks,
    indexPath: plan.indexPath.join('\n'),
    paths: shown.map((entry) => entry.path),
    chars: plan.blocks.length,
    files: shown.length
  };
}

function summarize(strategy: Strategy, rows: CaseRow[]): StrategySummary {
  const own = rows.filter((row) => row.strategy === strategy);
  const passed = own.filter((row) => row.pass).length;
  const recalled = own.filter((row) => row.recall).length;
  const mean = (pick: (row: CaseRow) => number) =>
    own.length ? own.reduce((sum, row) => sum + pick(row), 0) / own.length : 0;
  return {
    strategy,
    cases: own.length,
    passed,
    passAt1: own.length ? passed / own.length : 0,
    recall: own.length ? recalled / own.length : 0,
    avgContextFiles: mean((row) => row.contextFiles),
    avgContextChars: mean((row) => row.contextChars)
  };
}

/**
 * Runs every case through every strategy and returns the rows, not a verdict.
 *
 * The environment is pointed at the run's own `workspace.json` for the duration: an eval must
 * never read — or worse, write — the folder the user actually has connected.
 */
export async function runEval(options: EvalOptions = {}): Promise<EvalReport> {
  const cases = options.cases || EVAL_CASES;
  const strategies = options.strategies || STRATEGIES;
  const answer = options.answer || answerFromVisibleFiles;
  const runTypecheck = options.typecheck !== false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-eval-'));
  const previousWorkspaceFile = process.env.EPC_WORKSPACE_FILE;
  process.env.EPC_WORKSPACE_FILE = path.join(root, 'workspace.json');

  const rows: CaseRow[] = [];
  try {
    for (const evalCase of cases) {
      const source = path.join(root, `${evalCase.id}-source`);
      fs.mkdirSync(source, { recursive: true });
      materializeFixture(source, evalCase);
      bindWorkspace(source);

      for (const strategy of strategies) {
        const plan = planFor(strategy, evalCase, options);
        const prompt = assembleTaskPrompt(
          {
            taskTitle: evalCase.task.title,
            goal: evalCase.task.goal,
            acceptanceCriteria: evalCase.task.acceptanceCriteria,
            targetFiles: evalCase.task.targetFiles,
            projectName: 'Eval',
            ru: false
          },
          { fileIndex: plan.indexPath, context: plan.blocks }
        );

        const work = path.join(root, `${evalCase.id}-${strategy}`);
        fs.mkdirSync(work, { recursive: true });
        materializeFixture(work, evalCase);
        applyAnswer(work, await answer(prompt, evalCase));
        const result = scoreFixture(work, evalCase, runTypecheck);
        const missing = evalCase.needsContext.filter((needed) => !plan.paths.includes(needed));

        rows.push({
          caseId: evalCase.id,
          strategy,
          contextFiles: plan.files,
          contextChars: plan.chars,
          recall: missing.length === 0,
          missing,
          pass: result.pass,
          note: result.note
        });
        if (!options.keep) fs.rmSync(work, { recursive: true, force: true });
      }
      if (!options.keep) fs.rmSync(source, { recursive: true, force: true });
    }
  } finally {
    unbindWorkspace();
    if (previousWorkspaceFile === undefined) delete process.env.EPC_WORKSPACE_FILE;
    else process.env.EPC_WORKSPACE_FILE = previousWorkspaceFile;
    if (!options.keep) fs.rmSync(root, { recursive: true, force: true });
  }

  return {
    answer: answer === answerFromVisibleFiles ? 'offline' : 'live',
    cases: cases.length,
    rows,
    strategies: strategies.map((strategy) => summarize(strategy, rows))
  };
}

export function formatReport(report: EvalReport): string {
  const label = report.answer === 'live' ? 'live model' : 'offline stand-in (can only edit what it saw)';
  const lines: string[] = [`eval: ${report.cases} cases · answerer: ${label}`];
  for (const summary of report.strategies) {
    lines.push(
      `${summary.strategy.padEnd(6)} pass@1 ${summary.passed}/${summary.cases} ` +
        `· recall ${Math.round(summary.recall * 100)}% ` +
        `· ${summary.avgContextFiles.toFixed(1)} files ` +
        `· ${Math.round(summary.avgContextChars)} chars`
    );
  }
  lines.push('');
  for (const row of report.rows) {
    const mark = row.pass ? 'pass' : 'FAIL';
    const recall = row.recall ? '' : ` · missed ${row.missing.join(', ')}`;
    const note = row.note ? ` · ${row.note}` : '';
    lines.push(`${row.caseId.padEnd(24)} ${row.strategy.padEnd(6)} ${mark}${recall}${note}`);
  }
  return lines.join('\n');
}
