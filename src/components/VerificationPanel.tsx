import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  PlayCircle,
  Terminal,
  Wand2,
  XCircle
} from 'lucide-react';
import type {
  CheckProblem,
  CheckRunResult,
  ProjectCheckDefinition,
  VerificationDelta,
  VerificationProblemRef,
  VerificationReport,
  WeightBudget
} from '../services/api';
import { budgetLine, buildWeightLine, formatBytes } from '../utils/byteSize';
import { Button } from './ui/Button';

interface VerificationPanelProps {
  ru: boolean;
  checks: ProjectCheckDefinition[];
  checksLoading: boolean;
  verification: VerificationReport | null;
  isVerifying: boolean;
  isFixing: boolean;
  autoVerify: boolean;
  fixHint?: string;
  /**
   * The ceiling this project has and what the last measured build makes of it.
   *
   * Kept apart from the report on purpose: a budget is worth setting before anything is built —
   * especially in a folder with no checks to run — and the report only arrives after a run.
   */
  budget?: WeightBudget | null;
  /** True while the weight budget is being written down. */
  budgetSaving?: boolean;
  budgetHint?: string;
  onToggleAutoVerify: (value: boolean) => void;
  onVerify: (ids: string[], customCommand?: string) => void;
  onFix: () => void;
  onSaveBudget: (value: string) => void;
  onOpenProblem: (problem: CheckProblem) => void;
}

/** What colour and icon one check's outcome gets. */
function statusStyle(status: CheckRunResult['status']): string {
  if (status === 'passed') return 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60';
  if (status === 'failed') return 'text-rose-300 bg-rose-950/60 border-rose-800/60';
  if (status === 'timeout') return 'text-amber-300 bg-amber-950/60 border-amber-800/60';
  return 'text-slate-400 bg-slate-900 border-slate-700';
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function problemLine(problem: VerificationProblemRef, ru: boolean): string {
  const where = problem.file
    ? `${problem.file}${problem.line ? `:${problem.line}` : ''}`
    : ru
    ? 'место не указано'
    : 'no location';
  return `${where} — ${problem.message}`;
}

interface Verdict {
  tone: 'bad' | 'good' | 'quiet';
  title: string;
  lines: string[];
  note: string;
}

/**
 * The sentence the user actually needs: not "the tests failed" but "this change broke the tests
 * that used to pass" — and, just as important, "the errors below were already there before".
 */
function buildVerdict(ru: boolean, delta: VerificationDelta | null | undefined): Verdict | null {
  if (!delta || !delta.compared) return null;
  const at = delta.baselineRanAt ? new Date(delta.baselineRanAt).toLocaleTimeString() : '';
  const note = ru
    ? `Сравнение с прошлым прогоном проверок${at ? ` (${at})` : ''}`
    : `Compared with the previous check run${at ? ` (${at})` : ''}`;

  if (delta.regressedChecks.length > 0 || delta.newProblems.length > 0) {
    const lines: string[] = delta.regressedChecks.map((check) =>
      ru
        ? `${check.labelRu}: раньше проходила, теперь ${check.to === 'timeout' ? 'остановлена по времени' : 'упала'}`
        : `${check.labelEn}: used to pass, now ${check.to === 'timeout' ? 'timed out' : 'failed'}`
    );
    for (const problem of delta.newProblems.slice(0, 5)) lines.push(problemLine(problem, ru));

    // Warnings in a run where everything passed are findings, not breakage: calling them "errors"
    // is how a beginner learns to ignore the panel.
    const onlyWarnings =
      delta.regressedChecks.length === 0 && delta.newProblems.every((problem) => problem.severity === 'warning');

    return {
      tone: 'bad',
      title:
        delta.regressedChecks.length > 0
          ? ru
            ? 'Эта правка сломала проверки, которые раньше проходили'
            : 'This change broke checks that used to pass'
          : onlyWarnings
          ? ru
            ? 'Эта правка добавила новые замечания'
            : 'This change added new findings'
          : ru
          ? 'Эта правка добавила новые ошибки'
          : 'This change added new problems',
      lines,
      note
    };
  }

  if (delta.fixedProblems.length > 0 || delta.recoveredChecks.length > 0) {
    const lines: string[] = delta.recoveredChecks.map((check) =>
      ru ? `${check.labelRu}: снова проходит` : `${check.labelEn}: passing again`
    );
    for (const problem of delta.fixedProblems.slice(0, 5)) lines.push(problemLine(problem, ru));
    return {
      tone: 'good',
      title: ru ? 'Ничего нового не сломалось — стало лучше' : 'Nothing new broke — and some things are fixed',
      lines,
      note
    };
  }

  return {
    tone: 'quiet',
    title: ru ? 'Ничего нового не сломалось' : 'Nothing new broke',
    lines: delta.persistentProblems.length
      ? [
          ru
            ? `Ошибки ниже были и в прошлом прогоне: ${delta.persistentProblems.length}`
            : `The problems below were already there in the previous run: ${delta.persistentProblems.length}`
        ]
      : [],
    note
  };
}

/**
 * The screen half of the verification loop: it shows which checks this project has, runs them
 * inside the real folder, and lists what broke with the file and line — so "written" and
 * "working" stop being the same thing.
 */
export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  ru,
  checks,
  checksLoading,
  verification,
  isVerifying,
  isFixing,
  autoVerify,
  fixHint,
  budget,
  budgetSaving,
  budgetHint,
  onToggleAutoVerify,
  onVerify,
  onFix,
  onSaveBudget,
  onOpenProblem
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [customCommand, setCustomCommand] = useState('');
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const [budgetField, setBudgetField] = useState('');
  const [budgetTouched, setBudgetTouched] = useState(false);

  // The field follows the saved ceiling until the user starts typing in it.
  const savedBudgetBytes = budget?.bytes ?? null;
  useEffect(() => {
    if (budgetTouched) return;
    setBudgetField(savedBudgetBytes === null ? '' : `${Math.round(savedBudgetBytes / 1024)} KB`);
  }, [savedBudgetBytes, budgetTouched]);

  // Every discovered check starts selected: the usual answer is "check everything".
  useEffect(() => {
    setSelected(checks.map((check) => check.id));
  }, [checks]);

  const failing = verification?.results.filter(
    (result) => result.status === 'failed' || result.status === 'timeout'
  ) || [];
  const canRun = selected.length > 0 || customCommand.trim().length > 0;
  const problems = verification?.problems || [];
  const verdict = buildVerdict(ru, verification?.delta);
  const newProblems = problems.filter((problem) => problem.change === 'new');
  const preExistingProblems = problems.filter((problem) => problem.change === 'persistent');
  // "Show me only what this change broke" is the question behind the verdict, and the answer is
  // often one problem among thirty old ones.
  const visibleProblems = onlyNew && newProblems.length > 0 ? newProblems : problems;

  return (
    /* A section of the screen's one surface, not a card on it. */
    <div className="space-y-3 border-t border-slate-800/70 pt-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
            {ru ? 'Цикл проверки' : 'Verification loop'}
          </span>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>{ru ? 'Проверка проекта' : 'Project checks'}</span>
          </h4>
        </div>
        {verification && (
          <span
            className={`text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 ${
              verification.ok
                ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                : 'text-rose-300 bg-rose-950/60 border-rose-800/60'
            }`}
          >
            {verification.ok
              ? ru
                ? 'всё проходит'
                : 'all green'
              : verification.failed > 0
              ? ru
                ? `ошибок: ${verification.failed}`
                : `failing: ${verification.failed}`
              : ru
              ? `не запустилось: ${verification.skipped}`
              : `not run: ${verification.skipped}`}
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        {ru
          ? 'Приложение запускает команды вашего проекта в подключённой папке — без установки пакетов и без выхода в интернет. Ошибки показываются с файлом и строкой.'
          : 'The app runs your project’s own commands inside the connected folder — no installs, no network. Failures are shown with the file and line.'}
      </p>

      {checksLoading ? (
        <div className="text-[11px] text-slate-400 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{ru ? 'Ищу проверки в папке…' : 'Looking for checks in the folder…'}</span>
        </div>
      ) : checks.length > 0 ? (
        <div className="space-y-1.5">
          {checks.map((check) => {
            const isOn = selected.includes(check.id);
            return (
              <label
                key={check.id}
                className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(check.id) ? prev.filter((id) => id !== check.id) : [...prev, check.id]
                    )
                  }
                  className="accent-emerald-500 cursor-pointer shrink-0"
                />
                <span className="text-[11px] text-slate-200 font-bold shrink-0">
                  {ru ? check.labelRu : check.labelEn}
                </span>
                <code className="text-[10px] text-slate-400 font-mono truncate">{check.commandLine}</code>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {ru
              ? 'Готовых проверок не нашлось (в папке нет package.json/тестов/сборки). Впишите свою команду — например «node scripts/check.js» или «pytest -q».'
              : 'No ready-made checks were found (no package.json, tests or build). Type your own command — e.g. "node scripts/check.js" or "pytest -q".'}
          </span>
        </div>
      )}

      <input
        value={customCommand}
        onChange={(e) => setCustomCommand(e.target.value)}
        aria-label={ru ? 'Своя команда проверки' : 'Custom check command'}
        placeholder={ru ? 'Своя команда (не обязательно): node scripts/check.js' : 'Custom command (optional): node scripts/check.js'}
        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-200 focus:border-emerald-600"
      />

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoVerify}
            onChange={(e) => onToggleAutoVerify(e.target.checked)}
            className="accent-emerald-500 cursor-pointer"
          />
          <span>{ru ? 'Проверять сразу после записи' : 'Verify right after writing'}</span>
        </label>
        <Button
          variant="success"
          size="sm"
          icon={isVerifying ? Loader2 : PlayCircle}
          className="shrink-0"
          onClick={() => onVerify(selected, customCommand.trim() || undefined)}
          disabled={isVerifying || !canRun}
        >
          {isVerifying ? (ru ? 'Проверяю…' : 'Checking…') : ru ? 'Проверить проект' : 'Check the project'}
        </Button>
      </div>

      {/*
        * The budget: the same measurement, but in front of a ceiling. A size nobody judges is a
        * report; a size in front of a limit is a check — one that can be handed back to the model
        * the same way a failed test is. It is drawn whether or not a run has happened yet: a
        * ceiling is worth writing down before the first build, not only after one.
        */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 space-y-2">
        <div
          className={`text-[10px] flex items-start gap-2 ${
            budget?.verdict?.over ? 'text-amber-200' : 'text-slate-300'
          }`}
        >
          <HardDrive className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            {budgetLine(budget?.verdict, ru) ||
              (budget?.bytes == null
                ? ru
                  ? 'Бюджет веса не задан: размер сборки ни с чем не сравнивается.'
                  : 'No weight budget is set: the build size is compared with nothing.'
                : ru
                ? `Бюджет ${formatBytes(budget.bytes)}: в этой папке сборку ещё не измеряли — проверю после первой сборки.`
                : `Budget ${formatBytes(budget.bytes)}: no build has been measured in this folder yet — it will be judged after the first one.`)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={budgetField}
            onChange={(event) => {
              setBudgetTouched(true);
              setBudgetField(event.target.value);
            }}
            aria-label={ru ? 'Бюджет веса' : 'Weight budget'}
            placeholder={ru ? 'например 500 KB' : 'for example 500 KB'}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 focus:border-emerald-600 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200"
          />
          <button
            onClick={() => {
              setBudgetTouched(false);
              onSaveBudget(budgetField);
            }}
            disabled={budgetSaving}
            className="h-7 shrink-0 rounded-lg px-2.5 text-[11px] font-medium text-slate-200 ring-1 ring-inset ring-slate-700 transition-colors enabled:hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
          >
            {budgetSaving && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{ru ? 'Задать бюджет' : 'Set the budget'}</span>
          </button>
        </div>
        <p className="text-[10px] text-slate-400">
          {ru
            ? 'Предел для папки сборки: проверяется после собственной сборки проекта. Если результат тяжелее, приложение предлагает уменьшить его так же, как предлагает исправить упавший тест. Пустое поле убирает бюджет.'
            : 'A ceiling for the build output folder, judged after the project’s own build. If the result is heavier, the app offers to shrink it the same way it offers to fix a failed test. An empty field removes the budget.'}
        </p>
        {budget?.verdict?.over && (
          <button
            onClick={onFix}
            disabled={isFixing}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] text-xs font-medium text-white transition-colors enabled:hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
          >
            {isFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            <span>
              {ru ? 'ИИ: вернуть сборку в бюджет' : 'AI: bring the build back under its budget'}
            </span>
          </button>
        )}
        {budgetHint && <div className="text-[10px] text-indigo-300">{budgetHint}</div>}
      </div>

      {verification && (
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>
              {new Date(verification.ranAt).toLocaleTimeString()} •{' '}
              {ru ? 'проверок' : 'checks'}: {verification.results.length} •{' '}
              {ru ? 'всего' : 'total'} {formatMs(verification.durationMs)}
            </span>
          </div>

          {verdict && (
            <div
              className={`rounded-xl border px-3 py-2.5 space-y-1 ${
                verdict.tone === 'bad'
                  ? 'bg-rose-950/50 border-rose-800/60'
                  : verdict.tone === 'good'
                  ? 'bg-emerald-950/40 border-emerald-800/50'
                  : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div
                className={`text-[11px] font-bold flex items-center gap-2 ${
                  verdict.tone === 'bad'
                    ? 'text-rose-200'
                    : verdict.tone === 'good'
                    ? 'text-emerald-200'
                    : 'text-slate-300'
                }`}
              >
                {verdict.tone === 'bad' ? (
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                ) : verdict.tone === 'good' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{verdict.title}</span>
              </div>
              {verdict.lines.length > 0 && (
                <ul className="space-y-0.5 pl-5">
                  {verdict.lines.map((line, index) => (
                    <li key={index} className="text-[11px] text-slate-300 break-words list-disc">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-[10px] text-slate-400">{verdict.note}</div>
            </div>
          )}

          {buildWeightLine(verification.build, ru) && (
            <div
              className={`rounded-lg border px-3 py-2 text-[10px] flex items-center gap-2 ${
                verification.build?.heavy
                  ? 'bg-amber-950/50 border-amber-800/60 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <HardDrive className="w-3 h-3 shrink-0" />
              <span>{buildWeightLine(verification.build, ru)}</span>
            </div>
          )}

          {!verdict && verification.problems.length > 0 && (
            <div className="text-[10px] text-slate-400">
              {ru
                ? 'Это первый прогон проверок в этой папке — сравнивать не с чем. Следующий прогон покажет, что именно сломалось после правки.'
                : 'This is the first check run in this folder, so there is nothing to compare with. The next run will show what a change broke.'}
            </div>
          )}

          <div className="space-y-1">
            {verification.results.map((result) => {
              const isOpen = expandedOutput === result.id;
              return (
                <div key={result.id} className="bg-slate-950 border border-slate-800 rounded-lg">
                  <div className="flex items-center gap-2 p-2">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${statusStyle(result.status)}`}>
                      {result.status}
                    </span>
                    <span className="text-[11px] text-slate-200 font-bold truncate">
                      {ru ? result.labelRu : result.labelEn}
                    </span>
                    <code className="text-[10px] text-slate-400 font-mono truncate flex-1">{result.commandLine}</code>
                    <span className="text-[10px] text-slate-400 shrink-0">{formatMs(result.durationMs)}</span>
                    <button
                      onClick={() => setExpandedOutput(isOpen ? null : result.id)}
                      className="text-slate-400 hover:text-white cursor-pointer shrink-0"
                      title={ru ? 'Показать вывод команды' : 'Show the command output'}
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {result.error && (
                    <div className="px-3 pb-2 text-[10px] text-amber-300">{result.error}</div>
                  )}
                  {isOpen && (
                    <pre className="text-[10px] font-mono text-slate-400 border-t border-slate-800 p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                      {result.output.trim() || (ru ? '(команда ничего не вывела)' : '(the command printed nothing)')}
                      {result.outputTruncated ? `\n\n${ru ? '… вывод обрезан' : '… output truncated'}` : ''}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          {problems.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {failing.length === 0
                    ? ru
                      ? `Замечания проверок (${problems.length})`
                      : `Check findings (${problems.length})`
                    : ru
                    ? `Что именно сломалось (${problems.length})`
                    : `What broke (${problems.length})`}
                  {verdict?.tone === 'bad' &&
                    (ru
                      ? ` • новых: ${newProblems.length}, было и раньше: ${preExistingProblems.length}`
                      : ` • new: ${newProblems.length}, pre-existing: ${preExistingProblems.length}`)}
                </span>
                {newProblems.length > 0 && preExistingProblems.length > 0 && (
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={onlyNew}
                      onChange={(event) => setOnlyNew(event.target.checked)}
                      className="accent-rose-500 cursor-pointer"
                    />
                    <span>{ru ? 'только новые' : 'only new'}</span>
                  </label>
                )}
              </div>
              {visibleProblems.map((problem, index) => (
                <button
                  key={`${problem.file}-${problem.line}-${index}`}
                  onClick={() => onOpenProblem(problem)}
                  disabled={!problem.file}
                  className="w-full text-left bg-slate-950/60 border border-slate-800 enabled:hover:border-rose-700/60 rounded-lg px-2.5 py-2 space-y-0.5 transition-colors enabled:cursor-pointer disabled:cursor-default"
                  title={problem.raw}
                >
                  <div className="flex items-center gap-2">
                    {problem.severity === 'warning' ? (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                    )}
                    <span className="text-[10px] font-mono text-indigo-300 truncate">
                      {problem.file || (ru ? 'место не указано' : 'no location')}
                      {problem.line ? `:${problem.line}` : ''}
                      {problem.column ? `:${problem.column}` : ''}
                    </span>
                    {problem.code && (
                      <span className="text-[9px] font-mono text-slate-400 shrink-0">{problem.code}</span>
                    )}
                    {problem.change === 'new' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 shrink-0">
                        {ru ? 'новое' : 'new'}
                      </span>
                    )}
                    {problem.change === 'persistent' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 shrink-0">
                        {ru ? 'было и раньше' : 'pre-existing'}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-300 pl-5 break-words">{problem.message}</div>
                </button>
              ))}
            </div>
          )}

          {failing.length > 0 ? (
            <button
              onClick={onFix}
              disabled={isFixing}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] text-xs font-medium text-white transition-colors enabled:hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
            >
              {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              <span>
                {isFixing
                  ? ru
                    ? 'Модель готовит исправление…'
                    : 'The model is preparing a fix…'
                  : verdict?.tone === 'bad'
                  ? ru
                    ? 'ИИ: исправить то, что сломала эта правка'
                    : 'AI: fix what this change broke'
                  : ru
                  ? 'ИИ: исправить ошибки проверки'
                  : 'AI: fix the failing checks'}
              </span>
            </button>
          ) : verification.results.length === 0 ? (
            // Nothing ran, so there is nothing to congratulate: an empty run is not a green run.
            <div className="text-[11px] text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{ru ? 'Ни одна проверка не запустилась.' : 'No check ran.'}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[11px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{ru ? 'Все проверки прошли.' : 'Every check passed.'}</span>
              </div>
              {/*
                * A green run with new lint findings is still work: the report is where the app
                * used to stop, and handing those findings to the model is what turns "the checks
                * pass" into "the checks pass and the mess you just made is gone".
                */}
              {newProblems.length > 0 && (
                <button
                  onClick={onFix}
                  disabled={isFixing}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] text-xs font-medium text-white transition-colors enabled:hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
                >
                  {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  <span>
                    {isFixing
                      ? ru
                        ? 'Модель готовит исправление…'
                        : 'The model is preparing a fix…'
                      : ru
                      ? `ИИ: убрать замечания, которые добавила эта правка (${newProblems.length})`
                      : `AI: clear the findings this change added (${newProblems.length})`}
                  </span>
                </button>
              )}
            </div>
          )}

          {fixHint && <div className="text-[10px] text-indigo-300">{fixHint}</div>}
        </div>
      )}
    </div>
  );
};
