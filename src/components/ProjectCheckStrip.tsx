import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import {
  ProjectCheckDefinition,
  VerificationResponse,
  fetchChecksApi,
  runVerificationApi
} from '../services/api';
import { useFolderRevision } from '../services/folderFeed';
import { checkEvidenceHeadline, toCheckEvidence } from '../utils/checkEvidence';
import { Button } from './ui/Button';

interface ProjectCheckStripProps {
  /** The connected folder. Without one there is nothing to run, and nothing is shown. */
  root: string | null;
  /**
   * Changes whenever the code in the folder changes — the key of the last write, for instance.
   * A new value runs the checks again on the new code; the same value never runs twice.
   */
  autoRunKey?: string | number | null;
  /** The last run, handed to the screen that needs to judge the result. */
  onReport?: (report: VerificationResponse | null) => void;
  /** True while a run is in flight, so a screen can say so outside this card. */
  onRunningChange?: (running: boolean) => void;
  className?: string;
}

function formatMs(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The commands this folder already knows how to run — typecheck, lint, tests, build — run by the
 * app, with a visible indicator per check.
 *
 * This is the answer to a wrong division of labour the beginner loop used to make: the reviewer,
 * reading only the agent's prose, asked the user to run `npm install` and `tsc --noEmit` and to add
 * packages to devDependencies. None of that is the agent's job here — the folder is on this machine,
 * `projectChecks.ts` already detects the real commands, and the machine can run them. What was
 * missing was a place in the guided flow that says so and shows it happening.
 *
 * A run is one request for all checks, deliberately: the server compares this run against the
 * previous one in the same folder (see `verificationBaseline`), and splitting it into one call per
 * check would overwrite that baseline with every partial run.
 */
export const ProjectCheckStrip: React.FC<ProjectCheckStripProps> = ({
  root,
  autoRunKey = null,
  onReport,
  onRunningChange,
  className = ''
}) => {
  const { language, t } = useLanguage();
  const s = t.simple;
  const ru = language === 'ru';

  const [checks, setChecks] = useState<ProjectCheckDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<VerificationResponse | null>(null);
  const [error, setError] = useState('');
  const lastAutoKey = useRef<string | number | null>(null);
  const runToken = useRef(0);
  /** Another folder was connected: what this strip knows may be about the previous one. */
  const folderRevision = useFolderRevision();

  const evidence = useMemo(() => (report ? toCheckEvidence(report, ru) : null), [report, ru]);

  // What this folder can check at all. Asked again when another folder is connected — whether that
  // happened through this screen (`root` changes) or on another one while this strip stayed mounted
  // (`folderRevision` changes).
  useEffect(() => {
    // The last run belongs to the folder that was connected when it ran; a new folder starts
    // without a verdict rather than with someone else's.
    setReport(null);
    onReport?.(null);
    if (!root) {
      setChecks([]);
      setReport(null);
      onReport?.(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchChecksApi()
      .then((answer) => {
        if (cancelled) return;
        setChecks(answer.checks || []);
      })
      .catch(() => {
        // A folder with no manifest, or no folder at all, is not an error here: there is simply
        // nothing to run, and the quiet hint below says so.
        if (!cancelled) setChecks([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, folderRevision]);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  const run = useCallback(async () => {
    if (!root || checks.length === 0 || isRunning) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setIsRunning(true);
    setError('');
    try {
      const result = await runVerificationApi({
        ids: checks.map((check) => check.id),
        language
      });
      if (runToken.current !== token) return;
      setReport(result);
      onReport?.(result);
    } catch (err: any) {
      if (runToken.current !== token) return;
      setError(err?.userMessage || err?.message || (ru ? 'Не удалось запустить проверки.' : 'Could not run the checks.'));
      onReport?.(null);
    } finally {
      if (runToken.current === token) setIsRunning(false);
    }
  }, [root, checks, isRunning, language, ru, onReport]);

  // The code changed under us: run the checks on the code that is really on disk, without asking.
  useEffect(() => {
    if (!root || checks.length === 0) return;
    if (autoRunKey === null || autoRunKey === undefined) return;
    if (lastAutoKey.current === autoRunKey) return;
    lastAutoKey.current = autoRunKey;
    void run();
  }, [root, checks, autoRunKey, run]);

  if (!root) return null;

  const statusIcon = (status: string) => {
    if (status === 'passed') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
    if (status === 'timeout') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    return <MinusCircle className="w-4 h-4 text-slate-500 shrink-0" />;
  };

  const failed = (report?.results || []).filter((result) => result.status === 'failed' || result.status === 'timeout');

  return (
    <div
      data-check-strip
      className={`bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <ShieldCheck className={`w-4 h-4 ${isRunning ? 'text-indigo-300 animate-pulse' : 'text-indigo-400'}`} />
          {s.checksTitle}
        </span>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <span data-check-running className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {s.checksRunning}
            </span>
          ) : (
            <Button
              data-check-run
              variant="secondary"
              size="xs"
              icon={report ? RefreshCw : PlayCircle}
              onClick={() => void run()}
              disabled={isLoading || checks.length === 0}
            >
              {report ? s.checksAgain : s.checksRun}
            </Button>
          )}
        </div>
      </div>

      {checks.length === 0 ? (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {isLoading ? s.checksLoading : s.checksNothing}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((check) => {
            const result = report?.results.find((item) => item.id === check.id) || null;
            return (
              <li
                key={check.id}
                data-check-row={check.id}
                data-check-status={isRunning ? 'running' : result?.status || 'idle'}
                className="flex items-center gap-2 text-[11px]"
              >
                {isRunning ? (
                  <Loader2 className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
                ) : (
                  statusIcon(result?.status || 'idle')
                )}
                <span className="text-slate-200 font-semibold">{ru ? check.labelRu : check.labelEn}</span>
                <code className="text-slate-500 font-mono truncate">{check.commandLine}</code>
                {result && (
                  <span className="ml-auto shrink-0 text-slate-400 font-mono">
                    {formatMs(result.durationMs)}
                    {result.problems.length > 0 ? ` • ${result.problems.length}` : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isRunning && <p className="text-[11px] text-slate-400">{s.checksRunningHint}</p>}

      {!isRunning && evidence && (
        <div className="space-y-2">
          <p
            data-check-headline
            className={`text-[11px] font-semibold leading-relaxed ${
              failed.length ? 'text-amber-300' : 'text-emerald-300'
            }`}
          >
            {checkEvidenceHeadline(evidence, ru)}
          </p>
          {failed.slice(0, 2).map((result) => (
            <ul key={result.id} className="text-[10px] font-mono text-rose-200/90 space-y-0.5">
              {(result.problems || []).slice(0, 3).map((problem, index) => (
                <li key={`${result.id}-${index}`} className="truncate">
                  {problem.raw || problem.message}
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
};
