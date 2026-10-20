import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileMinus2,
  FilePen,
  FilePlus2,
  FileQuestion,
  GitBranch,
  GitCommit,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import { Button, IconButton } from './ui/Button';
import { HelpHint } from './ui/HelpHint';
import {
  GitBranchDiff,
  GitBranches,
  GitCommit as GitCommitResult,
  GitDiff,
  GitFileState,
  GitFileStatus,
  GitStatus,
  commitGitChangesApi,
  createGitBranchApi,
  fetchGitBranchDiffApi,
  fetchGitBranchesApi,
  fetchGitDiffApi,
  fetchGitStatusApi
} from '../services/api';
import { useFolderRevision } from '../services/folderFeed';

interface GitPanelProps {
  ru: boolean;
  root: string | null;
  language: string;
  /** Anything that marks "the folder was just written to", so the list is re-read. */
  refreshToken?: unknown;
}

/** The word and colour one changed file gets in the list. */
function stateLabel(state: GitFileState, ru: boolean): string {
  switch (state) {
    case 'untracked':
    case 'added':
      return ru ? 'новый' : 'new';
    case 'deleted':
      return ru ? 'удалён' : 'deleted';
    case 'renamed':
      return ru ? 'переименован' : 'renamed';
    case 'conflicted':
      return ru ? 'конфликт' : 'conflict';
    case 'typechange':
      return ru ? 'смена типа' : 'type changed';
    default:
      return ru ? 'изменён' : 'changed';
  }
}

/* One hairline badge for every file state; the word carries the meaning, not a filled plate. */
function stateStyle(state: GitFileState): string {
  const chip = 'border-slate-800/80 bg-slate-900/50';
  if (state === 'untracked' || state === 'added') return `text-emerald-300/90 ${chip}`;
  if (state === 'deleted') return `text-rose-300 ${chip}`;
  if (state === 'conflicted') return `text-amber-300 ${chip}`;
  return `text-sky-300/90 ${chip}`;
}

function stateIcon(state: GitFileState) {
  if (state === 'untracked' || state === 'added') return <FilePlus2 className="w-3.5 h-3.5" />;
  if (state === 'deleted') return <FileMinus2 className="w-3.5 h-3.5" />;
  if (state === 'conflicted' || state === 'typechange') return <FileQuestion className="w-3.5 h-3.5" />;
  return <FilePen className="w-3.5 h-3.5" />;
}

/**
 * A first draft of the commit message, written from the selection itself.
 *
 * It is deliberately plain and predictable: the user reviews and edits it, and it needs no
 * model — so saving a version never depends on an API key being configured.
 */
function draftMessage(ru: boolean, files: GitFileStatus[]): string {
  if (files.length === 0) return '';
  const names = files.slice(0, 3).map((file) => file.path).join(', ');
  const more = files.length > 3 ? (ru ? ` и ещё ${files.length - 3}` : ` and ${files.length - 3} more`) : '';

  const allNew = files.every((file) => file.untracked || file.state === 'added');
  const allDeleted = files.every((file) => file.state === 'deleted');

  if (allNew) return `${ru ? 'Добавить' : 'Add'}: ${names}${more}`;
  if (allDeleted) return `${ru ? 'Удалить' : 'Delete'}: ${names}${more}`;
  if (files.length <= 3) return `${ru ? 'Обновить' : 'Update'}: ${names}`;
  return ru ? `Обновить файлы (${files.length})` : `Update files (${files.length})`;
}

/**
 * What the current branch compares with, in one sentence.
 *
 * The app never fetches anything, so "two commits ahead" is a statement about the last known
 * state of the upstream on this computer. Saying that out loud is the difference between a
 * number the user can act on and a number they will misread as "my work is already on GitHub".
 * A branch that exists only here gets no counts at all — there is nothing to be ahead of.
 */
function trackingLine(status: GitStatus | null, ru: boolean): string {
  if (!status?.isRepo || !status.branch) return '';
  if (!status.upstream) {
    return ru
      ? 'Эта ветка есть только на этом компьютере: у неё нет ветки-источника, поэтому сравнивать не с чем. Наружу ничего не отправляется.'
      : 'This branch exists only on this computer: it has no upstream, so there is nothing to compare with. Nothing is sent anywhere.';
  }
  const parts: string[] = [];
  if (status.ahead) parts.push(ru ? `своих версий: ${status.ahead}` : `your own commits: ${status.ahead}`);
  if (status.behind) parts.push(ru ? `новых в источнике: ${status.behind}` : `new upstream: ${status.behind}`);
  const counts = parts.length
    ? ` — ${parts.join(', ')}`
    : ru
    ? ' — совпадает'
    : ' — in step';
  return ru
    ? `Источник ${status.upstream} (последнее известное на этом компьютере, обмена с интернетом нет)${counts}.`
    : `Upstream ${status.upstream} (last known on this computer, nothing is fetched)${counts}.`;
}

/** A first suggestion for a branch name: dated, so two attempts on different days do not clash. */
function draftBranchName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ai/work-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A list out of a reply, whatever the reply turned out to be.
 *
 * The panel draws a whole screen from one answer from the server, so an answer it does not fully
 * recognise — an older server, a reply cut short — must read as "nothing to show" instead of
 * taking the screen down with it. The list is also read again while the screen renders, and a value
 * that changes shape between those two reads is exactly how a crash reaches a render.
 */
function asList<T>(value: readonly T[] | undefined | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function branchStateLabel(state: GitBranchDiff['files'][number]['state'], ru: boolean): string {
  if (state === 'added') return ru ? 'новый' : 'new';
  if (state === 'deleted') return ru ? 'удалён' : 'deleted';
  return ru ? 'изменён' : 'changed';
}

/** One colour per kind of diff line, so a long diff is readable at a glance. */
function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-slate-400';
  if (line.startsWith('@@')) return 'text-indigo-300';
  if (line.startsWith('+')) return 'text-emerald-300 bg-emerald-950/30';
  if (line.startsWith('-')) return 'text-rose-300 bg-rose-950/30';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-slate-400';
  return 'text-slate-300';
}

/**
 * The Git half of the workspace: what changed in the connected folder, what exactly changed in
 * one file, and one button that saves the ticked files as a local commit.
 *
 * Everything here is local. The panel has no push, no pull and no remote: saving a version is
 * the same kind of private act as writing a file into the folder.
 */
export const GitPanel: React.FC<GitPanelProps> = ({ ru, root, language, refreshToken }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [selected, setSelected] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [typedMessage, setTypedMessage] = useState('');

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<GitCommitResult | null>(null);
  const [commitError, setCommitError] = useState('');
  const [commitHint, setCommitHint] = useState('');

  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [isBranchLoading, setIsBranchLoading] = useState(false);
  const [newBranch, setNewBranch] = useState(draftBranchName());
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [branchNotice, setBranchNotice] = useState('');
  const [branchError, setBranchError] = useState('');
  const [compareBase, setCompareBase] = useState('');
  const [branchDiff, setBranchDiff] = useState<GitBranchDiff | null>(null);
  const [isBranchDiffLoading, setIsBranchDiffLoading] = useState(false);
  /** The folder the server holds changed: this panel was reading the previous one. */
  const folderRevision = useFolderRevision();

  const files = status?.files || [];
  const selectedFiles = useMemo(
    () => files.filter((file) => selected.includes(file.path)),
    [files, selected]
  );
  const draft = useMemo(() => draftMessage(ru, selectedFiles), [ru, selectedFiles]);
  const message = touched ? typedMessage : draft;

  const loadStatus = async (announce = false) => {
    if (!root) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    setLoadError('');
    try {
      const result = await fetchGitStatusApi(language);
      const changed = asList(result?.files);
      setStatus({ ...result, files: changed });
      // New files are what the user means by "save this": they start ticked, unless they look
      // like a secret (those are listed, but never ticked for you).
      setSelected((previous) => {
        const stillThere = previous.filter((path) => changed.some((file) => file.path === path));
        if (stillThere.length > 0) return stillThere;
        return changed.filter((file) => !file.sensitive).map((file) => file.path);
      });
      if (announce) setCommitHint('');
    } catch (err: any) {
      setStatus(null);
      setLoadError(err?.userMessage || err?.message || (ru ? 'Не удалось прочитать состояние Git.' : 'Could not read the Git state.'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadBranches = async () => {
    if (!root) {
      setBranches(null);
      return;
    }
    setIsBranchLoading(true);
    try {
      const result = await fetchGitBranchesApi(language);
      const listed = asList(result?.branches);
      setBranches({ ...result, branches: listed });
      // The comparison starts on the branch this work came from, which is the useful default.
      setCompareBase((previous) =>
        previous && listed.some((branch) => branch.name === previous)
          ? previous
          : result.suggestedBase || ''
      );
    } catch (err: any) {
      setBranches(null);
      setBranchError(err?.userMessage || err?.message || (ru ? 'Не удалось прочитать список веток.' : 'Could not read the branch list.'));
    } finally {
      setIsBranchLoading(false);
    }
  };

  // A different folder, a freshly written file or a new commit all mean "read Git again".
  // `folderRevision` is the folder being connected or disconnected on another screen, while this
  // panel stays mounted: the branch and the changed files are re-read from the new folder.
  useEffect(() => {
    setCommitResult(null);
    setCommitError('');
    setOpenPath(null);
    setDiff(null);
    setBranchDiff(null);
    setBranchNotice('');
    setBranchError('');
    setNewBranch(draftBranchName());
    loadStatus();
    loadBranches();
  }, [root, refreshToken, language, folderRevision]);

  const toggle = (path: string) => {
    setCommitResult(null);
    setSelected((previous) =>
      previous.includes(path) ? previous.filter((entry) => entry !== path) : [...previous, path]
    );
  };

  const openDiff = async (path: string) => {
    if (openPath === path) {
      setOpenPath(null);
      setDiff(null);
      return;
    }
    setOpenPath(path);
    setDiff(null);
    setIsDiffLoading(true);
    try {
      setDiff(await fetchGitDiffApi(path, language));
    } catch (err: any) {
      setDiff({
        path,
        diff: err?.userMessage || err?.message || (ru ? 'Не удалось получить изменения.' : 'Could not read the diff.'),
        truncated: false,
        binary: false,
        note: null
      });
    } finally {
      setIsDiffLoading(false);
    }
  };

  const startBranch = async () => {
    const name = newBranch.trim();
    if (isCreatingBranch || !name) return;
    setIsCreatingBranch(true);
    setBranchError('');
    setBranchNotice('');
    setBranchDiff(null);
    try {
      const result = await createGitBranchApi({ name, language });
      setBranches(result.branches);
      setStatus(result.status);
      setNewBranch(draftBranchName());
      setCommitResult(null);
      setBranchNotice(
        ru
          ? `Теперь вы на ветке «${result.branch}»${result.previous ? ` (было «${result.previous}»)` : ''}. ` +
              `Ни одна сохранённая версия не потеряна — ветка начинается от того же коммита ${result.fromCommit}.` +
              (result.carriedChanges > 0
                ? ` Незакоммиченных файлов перешло с вами: ${result.carriedChanges}.`
                : ' Незакоммиченных файлов нет.')
          : `You are now on branch "${result.branch}"${result.previous ? ` (was "${result.previous}")` : ''}. ` +
              `No saved version is lost — the branch starts at the same commit ${result.fromCommit}.` +
              (result.carriedChanges > 0
                ? ` Uncommitted files came along: ${result.carriedChanges}.`
                : ' There are no uncommitted files.')
      );
    } catch (err: any) {
      setBranchError(
        err?.userMessage || err?.message || (ru ? 'Git не смог создать ветку.' : 'Git could not create the branch.')
      );
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const compareBranches = async () => {
    if (!compareBase || isBranchDiffLoading) return;
    setIsBranchDiffLoading(true);
    setBranchError('');
    try {
      setBranchDiff(await fetchGitBranchDiffApi(compareBase, language));
    } catch (err: any) {
      setBranchDiff(null);
      setBranchError(
        err?.userMessage || err?.message || (ru ? 'Не удалось сравнить ветки.' : 'Could not compare the branches.')
      );
    } finally {
      setIsBranchDiffLoading(false);
    }
  };

  const commit = async () => {
    if (isCommitting || selected.length === 0 || !message.trim()) return;
    setIsCommitting(true);
    setCommitError('');
    setCommitHint('');
    try {
      const result = await commitGitChangesApi({ files: selected, message, language });
      setCommitResult(result);
      setTouched(false);
      setTypedMessage('');
      setOpenPath(null);
      setDiff(null);
      await loadStatus();
    } catch (err: any) {
      setCommitError(err?.userMessage || err?.message || (ru ? 'Git не смог создать коммит.' : 'Git could not create the commit.'));
      setCommitHint(err?.details?.detail || '');
    } finally {
      setIsCommitting(false);
    }
  };

  if (!root) return null;

  return (
    /* A section of the screen's one surface, not a card on it. */
    <div className="space-y-3 border-t border-slate-800/70 pt-5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
          <GitBranch className="w-4 h-4 shrink-0 text-slate-500" />
          <span className="truncate">{ru ? 'Сохранение версий' : 'Saving versions'}</span>
          <HelpHint
            text={
              ru
                ? 'Выбранные файлы сохраняются как версия у вас на компьютере. Отправки на GitHub здесь нет — наружу ничего не уходит.'
                : 'The selected files are saved as a version on your own computer. There is no upload to GitHub here — nothing leaves your machine.'
            }
          />
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          {status?.isRepo && status.branch && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-lg border text-slate-300 bg-slate-950 border-slate-700 font-mono">
              {status.branch}
            </span>
          )}
          <IconButton
            label={ru ? 'Обновить' : 'Refresh'}
            icon={isLoading ? () => <Loader2 className="h-3.5 w-3.5 animate-spin" /> : RefreshCw}
            size="xs"
            disabled={isLoading}
            onClick={() => loadStatus(true)}
          />
        </div>
      </div>

      {loadError && (
        <div className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-2.5 text-[11px] text-rose-200">
          {loadError}
        </div>
      )}

      {status && !status.available && (
        <div className="bg-amber-950/50 border border-amber-800/60 rounded-xl p-3 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {ru
              ? 'Git не найден на этом компьютере. Установите Git с git-scm.com и перезапустите приложение — тогда появится сохранение версий.'
              : 'Git was not found on this computer. Install Git from git-scm.com and restart the app to get version saving.'}
          </span>
        </div>
      )}

      {status?.available && !status.isRepo && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
          <span className="text-slate-400">
            {ru ? 'Эта папка пока не под Git.' : 'This folder is not under Git yet.'}
          </span>
          <code
            className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 ring-1 ring-inset ring-slate-800"
            title={ru ? 'Выполните в папке проекта' : 'Run it in the project folder'}
          >
            git init
          </code>
        </div>
      )}

      {status?.isRepo && trackingLine(status, ru) && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[10px] text-slate-300 flex items-start gap-2">
          <GitBranch className="w-3 h-3 shrink-0 mt-0.5 text-slate-500" />
          <span>{trackingLine(status, ru)}</span>
        </div>
      )}

      {status?.isRepo && status.identityMissing && (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
            <span>{ru ? 'Git ещё не знает имя и почту.' : 'Git does not know your name and email yet.'}</span>
          </div>
          <code className="block whitespace-pre-wrap rounded bg-slate-950 px-2 py-1.5 font-mono text-[10px] text-slate-300 ring-1 ring-inset ring-slate-800">
            git config --global user.name "Ваше имя"{'\n'}git config --global user.email "ваша@почта"
          </code>
        </div>
      )}

      {status?.isRepo && (
        <>
          {status.clean ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/90" />
              <span>
                {ru
                  ? 'Все изменения уже сохранены — новых нет.'
                  : 'Everything is already saved — there are no new changes.'}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {ru ? `Изменённые файлы (${files.length})` : `Changed files (${files.length})`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(files.filter((file) => !file.sensitive).map((file) => file.path))}
                    className="h-6 cursor-pointer rounded-md px-1.5 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                  >
                    {ru ? 'Выбрать все' : 'Select all'}
                  </button>
                  <button
                    onClick={() => setSelected([])}
                    className="h-6 cursor-pointer rounded-md px-1.5 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                  >
                    {ru ? 'Снять все' : 'Clear'}
                  </button>
                </div>
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => {
                  const isOpen = openPath === file.path;
                  return (
                    <div key={file.path} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(file.path)}
                          onChange={() => toggle(file.path)}
                          className="w-3.5 h-3.5 accent-sky-500 cursor-pointer shrink-0"
                        />
                        <button
                          onClick={() => openDiff(file.path)}
                          className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-2"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="font-mono text-[11px] text-slate-200 truncate">{file.path}</span>
                        </button>
                        {file.sensitive && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 inline-flex items-center gap-1 shrink-0"
                            title={
                              ru
                                ? 'Похоже на секрет: файл можно сохранить, но его содержимое здесь не показывается.'
                                : 'Looks like a secret: it can be saved, but its contents are never shown here.'
                            }
                          >
                            <ShieldAlert className="w-3 h-3" />
                            {ru ? 'секрет' : 'secret'}
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 shrink-0 ${stateStyle(
                            file.state
                          )}`}
                        >
                          {stateIcon(file.state)}
                          {stateLabel(file.state, ru)}
                        </span>
                      </div>

                      {isOpen && (
                        <div className="border-t border-slate-800">
                          {isDiffLoading ? (
                            <div className="px-3 py-2 text-[10px] text-slate-400 flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              {ru ? 'Читаю изменения…' : 'Reading the diff…'}
                            </div>
                          ) : diff?.note === 'sensitive' ? (
                            <div className="px-3 py-2.5 text-[10px] text-amber-200">
                              {ru
                                ? 'Содержимое не показывается: файл похож на секрет (ключ, пароль, .env).'
                                : 'Contents are hidden: this file looks like a secret (key, password, .env).'}
                            </div>
                          ) : diff ? (
                            <div className="max-h-72 overflow-auto">
                              {diff.binary && (
                                <div className="px-3 py-1.5 text-[10px] text-slate-400">
                                  {ru ? 'Двоичный файл — показываю только пометку Git.' : 'Binary file — showing Git’s note only.'}
                                </div>
                              )}
                              <pre className="text-[10px] font-mono leading-relaxed px-3 py-2">
                                {diff.diff.split('\n').map((line, index) => (
                                  <div key={index} className={diffLineClass(line)}>
                                    {line || ' '}
                                  </div>
                                ))}
                              </pre>
                              {diff.truncated && (
                                <div className="px-3 py-1.5 text-[10px] text-amber-300">
                                  {ru ? 'Изменения большие — показана только часть.' : 'The diff is large — only part of it is shown.'}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="px-3 py-2 text-[10px] text-slate-400">
                              {ru ? 'У этого файла нет текстовых изменений.' : 'This file has no text changes.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {ru ? 'Описание версии' : 'Version description'}
                  </label>
                  {touched && (
                    <button
                      onClick={() => setTouched(false)}
                      className="text-[10px] font-medium text-slate-400 hover:text-white cursor-pointer inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      {ru ? 'Придумать заново' : 'Suggest again'}
                    </button>
                  )}
                </div>
                <textarea
                  value={message}
                  onChange={(event) => {
                    setTouched(true);
                    setTypedMessage(event.target.value);
                  }}
                  rows={2}
                  aria-label={ru ? 'Описание версии' : 'Version description'}
                  placeholder={ru ? 'Например: Обновить экран напитков' : 'For example: Update the drinks screen'}
                  className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-600"
                />
                <Button
                  variant="primary"
                  size="md"
                  icon={isCommitting ? Loader2 : Save}
                  className="w-full"
                  onClick={commit}
                  disabled={isCommitting || selected.length === 0 || !message.trim()}
                >
                  {ru
                    ? `Сохранить версию (${selected.length})`
                    : `Save this version (${selected.length})`}
                </Button>
              </div>
            </div>
          )}

          {commitResult && (
            <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-200">
                <GitCommit className="w-3.5 h-3.5 shrink-0 text-emerald-400/90" />
                <span className="font-mono">{commitResult.hash}</span>
                <span className="truncate">{commitResult.subject}</span>
              </div>
              <div className="text-[10px] text-slate-300">
                {ru
                  ? `Сохранено файлов: ${commitResult.committed.length}`
                  : `Files saved: ${commitResult.committed.length}`}
                {commitResult.remaining.length > 0 &&
                  (ru
                    ? ` • ещё не сохранено: ${commitResult.remaining.length}`
                    : ` • still unsaved: ${commitResult.remaining.length}`)}
              </div>
            </div>
          )}

          {commitError && (
            <div className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-2.5 space-y-1 text-[11px] text-rose-200">
              <div>{commitError}</div>
              {commitHint && (
                <pre className="text-[10px] text-rose-300/80 whitespace-pre-wrap max-h-32 overflow-auto">{commitHint}</pre>
              )}
            </div>
          )}

          {commitHint && !commitError && <div className="text-[10px] text-slate-400">{commitHint}</div>}

          {/*
            * Branches: which one this work is on, starting one for what comes next, and what one
            * branch has that another does not. Nothing here touches a remote — the app has no
            * switch, no merge and no delete, and starting a branch moves no commit.
            */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                {ru ? 'Ветки' : 'Branches'}
                <HelpHint
                  text={
                    ru
                      ? 'Новая ветка начинается от текущей версии: ничего сохранённого не теряется, а незакоммиченные файлы остаются с вами. Переключения, слияния и удаления веток здесь нет.'
                      : 'A new branch starts from the current version: nothing saved is lost, and uncommitted files stay with you. There is no switching, merging or deleting here.'
                  }
                />
              </span>
              {isBranchLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
            </div>

            {(branches?.branches.length || 0) > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {branches!.branches.map((branch) => (
                  <span
                    key={branch.name}
                    className={`text-[10px] font-mono px-2 py-1 rounded-lg border ${
                      branch.current
                        ? 'text-sky-200 bg-sky-950/60 border-sky-800/60'
                        : 'text-slate-300 bg-slate-950 border-slate-800'
                    }`}
                    title={
                      branch.upstream
                        ? `${branch.upstream}${branch.ahead ? ` • ${ru ? 'своих версий' : 'ahead'}: ${branch.ahead}` : ''}${branch.behind ? ` • ${ru ? 'новых в источнике' : 'behind'}: ${branch.behind}` : ''}`
                        : ru
                        ? 'Только на этом компьютере'
                        : 'On this computer only'
                    }
                  >
                    {branch.name}
                    {branch.current ? (ru ? ' • вы здесь' : ' • you are here') : ''}
                    {branch.ahead ? ` ↑${branch.ahead}` : ''}
                    {branch.behind ? ` ↓${branch.behind}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              !isBranchLoading && (
                <p className="text-[10px] text-slate-400">
                  {ru
                    ? 'Сохранённых версий ещё нет: ветку можно начать, она появится после первой сохранённой версии.'
                    : 'There are no saved versions yet: a branch can be started, and it will appear with the first saved version.'}
                </p>
              )
            )}

            {branches?.operationInProgress && (
              <div className="bg-amber-950/50 border border-amber-800/60 rounded-xl p-2.5 text-[10px] text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {ru
                    ? `Git сейчас в середине операции «${branches.operationInProgress}». Закончите или отмените её в терминале — до этого новую ветку начинать нельзя.`
                    : `Git is in the middle of a ${branches.operationInProgress}. Finish or abort it in a terminal first — until then a new branch cannot be started.`}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                aria-label={ru ? 'Имя новой ветки' : 'New branch name'}
                spellCheck={false}                  className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-200 focus:border-indigo-600"
              />
              <button
                onClick={startBranch}
                disabled={isCreatingBranch || !newBranch.trim() || Boolean(branches?.operationInProgress)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 text-[11px] font-medium text-slate-200 ring-1 ring-inset ring-slate-700/80 transition-colors enabled:hover:bg-slate-700/80 enabled:hover:text-white disabled:pointer-events-none disabled:opacity-50"
              >
                {isCreatingBranch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                <span>{ru ? 'Начать ветку' : 'Start a branch'}</span>
              </button>
            </div>

            {branchNotice && (
              <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] text-slate-400">
                <GitCommit className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400/90" />
                <span>{branchNotice}</span>
              </div>
            )}
            {branchError && (
              <div className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-2.5 text-[10px] text-rose-200">
                {branchError}
              </div>
            )}

            {(branches?.branches.filter((branch) => !branch.current).length || 0) > 0 && (
              <div className="space-y-2 pt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {ru ? 'Что эта ветка добавила' : 'What this branch added'}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={compareBase}
                    onChange={(event) => {
                      setCompareBase(event.target.value);
                      setBranchDiff(null);
                    }}
                    aria-label={ru ? 'С какой веткой сравнить' : 'Compare with'}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-[11px] font-mono text-slate-200 cursor-pointer"
                  >
                    {branches!.branches
                      .filter((branch) => !branch.current)
                      .map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={compareBranches}
                    disabled={isBranchDiffLoading || !compareBase}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 text-[11px] font-medium text-slate-200 ring-1 ring-inset ring-slate-700/80 transition-colors enabled:hover:bg-slate-700/80 enabled:hover:text-white disabled:pointer-events-none disabled:opacity-50"
                  >
                    {isBranchDiffLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>{ru ? 'Сравнить' : 'Compare'}</span>
                  </button>
                </div>

                {branchDiff &&
                  (branchDiff.same ? (
                    <div className="text-[10px] text-slate-400">
                      {ru
                        ? `Ветки «${branchDiff.base}» и «${branchDiff.head}» указывают на одну версию — отличай нет.`
                        : `"${branchDiff.base}" and "${branchDiff.head}" point at the same version, so there is nothing different.`}
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-2.5 py-2 text-[10px] text-slate-300">
                        {ru
                          ? `«${branchDiff.head}» против «${branchDiff.base}»: файлов ${branchDiff.files.length}, добавлено строк +${branchDiff.additions}, удалено −${branchDiff.deletions}`
                          : `"${branchDiff.head}" against "${branchDiff.base}": ${branchDiff.files.length} file(s), +${branchDiff.additions} added, −${branchDiff.deletions} removed`}
                      </div>
                      <div className="max-h-40 overflow-y-auto border-t border-slate-800">
                        {branchDiff.files.map((file) => (
                          <div key={file.path} className="flex items-center gap-2 px-2.5 py-1.5">
                            <span className="font-mono text-[10px] text-slate-200 truncate flex-1">{file.path}</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-300 shrink-0">
                              {branchStateLabel(file.state, ru)}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 shrink-0">
                              +{file.additions} −{file.deletions}
                            </span>
                          </div>
                        ))}
                      </div>
                      {branchDiff.patch.trim() && (
                        <details className="border-t border-slate-800">
                          <summary className="px-2.5 py-2 text-[10px] text-slate-400 cursor-pointer">
                            {ru ? 'Показать сами изменения' : 'Show the changes themselves'}
                          </summary>
                          <pre className="text-[10px] font-mono leading-relaxed px-3 py-2 max-h-72 overflow-auto">
                            {branchDiff.patch.split('\n').map((line, index) => (
                              <div key={index} className={diffLineClass(line)}>
                                {line || ' '}
                              </div>
                            ))}
                          </pre>
                        </details>
                      )}
                      {branchDiff.truncated && (
                        <div className="px-2.5 py-1.5 text-[10px] text-amber-300 border-t border-slate-800">
                          {ru ? 'Изменения большие — показана только часть.' : 'The diff is large — only part of it is shown.'}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
