import React, { useState } from 'react';
import { Button, IconButton } from './ui/Button';
import { HelpHint } from './ui/HelpHint';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Flag,
  HardDrive,
  History,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  XCircle
} from 'lucide-react';
import type { WorkspaceChangeset, WorkspaceCheckpoint } from '../services/api';
import { formatSignedBytes, weightTitle } from '../utils/byteSize';

interface CheckpointTimelineProps {
  ru: boolean;
  checkpoints: WorkspaceCheckpoint[];
  timeline: WorkspaceChangeset[];
  /** Ids currently busy (creating, rolling back, undoing). */
  busy: boolean;
  busyId: string | null;
  onCreate: (name: string) => void;
  onRollback: (checkpointId: string) => void;
  onDelete: (checkpointId: string) => void;
  onUndoChangeset: (changesetId: string) => void;
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

/**
 * The history of everything the app wrote into the folder, with named checkpoints you can jump
 * back to.
 *
 * It used to be two lists one under the other — «Чекпоинты и откат» and «Что было записано» —
 * which were the same story told twice: a checkpoint is a name attached to one of the writes, not
 * a second history. Now there is one feed, newest first, and a checkpoint appears on the row it
 * marks. The whole section is closed by default: history is something you consult, not the part of
 * the screen you work in, and it keeps its count in the header so it never hides that something
 * happened.
 */
export const CheckpointTimeline: React.FC<CheckpointTimelineProps> = ({
  ru,
  checkpoints,
  timeline,
  busy,
  busyId,
  onCreate,
  onRollback,
  onDelete,
  onUndoChangeset
}) => {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const checkpointFor = (changesetId: string | null) =>
    checkpoints.find((checkpoint) => checkpoint.changesetId === changesetId) || null;
  const startCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.changesetId);
  /* A point can outlive the 25 writes the screen lists: it still has to stay reachable, or a
     checkpoint silently stops being a way back. */
  const olderCheckpoints = checkpoints.filter(
    (checkpoint) =>
      checkpoint.changesetId && !timeline.some((changeset) => changeset.id === checkpoint.changesetId)
  );
  const hasAnything = timeline.length > 0 || startCheckpoints.length > 0 || olderCheckpoints.length > 0;

  /** Rollback and the way out of it, drawn the same on a write row and on the very first state. */
  const rollbackMark = (checkpoint: WorkspaceCheckpoint) => {
    if (confirmRollback === checkpoint.id) {
      return (
        <div className="space-y-1.5">
          <div className="text-[10px] text-amber-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              {ru
                ? 'Все записи после этой точки будут отменены. Продолжить?'
                : 'Every write after this point will be undone. Continue?'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onRollback(checkpoint.id);
                setConfirmRollback(null);
              }}
              disabled={busy}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-rose-600 px-2 text-[10px] font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-rose-500 disabled:pointer-events-none disabled:opacity-50"
            >
              {busyId === checkpoint.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              <span>{ru ? 'Да, откатить' : 'Yes, roll back'}</span>
            </button>
            <button
              onClick={() => setConfirmRollback(null)}
              className="h-6 cursor-pointer rounded-md px-2 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              {ru ? 'Отмена' : 'Cancel'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setConfirmRollback(checkpoint.id)}
          disabled={busy}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-slate-400 transition-colors enabled:cursor-pointer enabled:hover:bg-rose-950/60 enabled:hover:text-rose-200 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" />
          <span>{ru ? 'Откатить сюда' : 'Roll back here'}</span>
        </button>
        <IconButton
          label={ru ? 'Удалить точку (история останется)' : 'Delete the point (history stays)'}
          icon={Trash2}
          size="xs"
          disabled={busy}
          onClick={() => onDelete(checkpoint.id)}
        />
      </div>
    );
  };

  /* One chip for everything the history says about a write: a hairline, a quiet label, and the
     colour only on the icon. Filled green and indigo pills on every row made a list of facts look
     like a row of controls. */
  const CHIP =
    'inline-flex min-w-0 items-center gap-1 rounded border border-slate-800/80 bg-slate-900/50 px-1.5 py-0.5 text-[9px] font-medium';

  const checkpointBadge = (checkpoint: WorkspaceCheckpoint) => (
    <span className={`${CHIP} text-slate-400`}>
      <Flag className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
      <span className="truncate">{checkpoint.name}</span>
    </span>
  );

  return (
    /* A section of the screen's one surface, not a card on it. */
    <div className="border-t border-slate-800/70 pt-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          data-history-toggle
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <History className="w-4 h-4 shrink-0 text-slate-500" />
          <span className="text-sm font-bold text-white">{ru ? 'История' : 'History'}</span>
          {hasAnything && (
            <span
              className="text-[10px] tabular-nums text-slate-500"
              title={ru ? `Записей: ${timeline.length}` : `Writes: ${timeline.length}`}
            >
              {timeline.length}
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <HelpHint
          text={
            ru
              ? 'Здесь всё, что приложение записало в папку. Точка — это «здесь всё работало»: откат возвращает папку ровно в неё, отменяя все записи после.'
              : 'Everything the app wrote into the folder. A checkpoint means “everything worked here”: rolling back returns the folder to exactly that point by undoing every write after it.'
          }
        />
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {/* One line: a name for the point, and the act of marking it. */}
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || busy) return;
                onCreate(name.trim());
                setName('');
              }}
              aria-label={ru ? 'Название точки' : 'Checkpoint name'}
              placeholder={ru ? 'Название точки' : 'Checkpoint name'}
              className="h-7 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-[11px] text-slate-100 focus:border-indigo-600"
            />
            <Button
              variant="primary"
              size="xs"
              icon={busyId === 'create' ? Loader2 : Flag}
              className="shrink-0"
              onClick={() => {
                onCreate(name.trim());
                setName('');
              }}
              disabled={busy}
            >
              {ru ? 'Отметить точку' : 'Mark a point'}
            </Button>
          </div>

          {!hasAnything ? (
            <p className="text-[11px] text-slate-400">
              {ru ? 'Пока ничего не записывали.' : 'Nothing has been written yet.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {timeline.map((changeset) => {
                const checkpoint = checkpointFor(changeset.id);
                const rolledBack = Boolean(changeset.rolledBackAt);
                const verification = changeset.verification;
                return (
                  <div
                    key={changeset.id}
                    data-history-row
                    className={`space-y-1 py-2 ${rolledBack ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                        {formatTime(changeset.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                        {changeset.label
                          ? changeset.label
                          : ru
                          ? `файлов: ${changeset.fileCount}`
                          : `${changeset.fileCount} file(s)`}
                      </span>
                      {checkpoint && checkpointBadge(checkpoint)}
                      {!rolledBack && (
                        <IconButton
                          label={ru ? 'Отменить только эту запись' : 'Undo just this write'}
                          icon={Undo2}
                          size="xs"
                          disabled={busy}
                          onClick={() => onUndoChangeset(changeset.id)}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {rolledBack && (
                        <span className={`${CHIP} text-slate-500`}>{ru ? 'отменено' : 'undone'}</span>
                      )}
                      {changeset.formatting && (
                        <span
                          className={`${CHIP} text-slate-400`}
                          title={changeset.formatting.error || undefined}
                        >
                          <Sparkles className="w-2.5 h-2.5 shrink-0 text-sky-400/80" />
                          {ru
                            ? `приведено в порядок: ${changeset.formatting.tool} (${changeset.formatting.changed})`
                            : `tidied: ${changeset.formatting.tool} (${changeset.formatting.changed})`}
                        </span>
                      )}
                      {changeset.weight && (
                        <span className={`${CHIP} text-slate-400`} title={weightTitle(changeset.weight, ru)}>
                          <HardDrive
                            className={`w-2.5 h-2.5 shrink-0 ${changeset.weight.heavy ? 'text-amber-400' : 'text-slate-500'}`}
                          />
                          {formatSignedBytes(changeset.weight.netBytes)}
                        </span>
                      )}
                      {verification &&
                        (verification.ok ? (
                          <span
                            className={`${CHIP} text-slate-400`}
                            title={ru ? 'Проверки проекта прошли' : 'The project checks passed'}
                          >
                            <CheckCircle2 className="w-2.5 h-2.5 shrink-0 text-emerald-400/90" />
                            {ru ? 'прошли' : 'passed'}
                          </span>
                        ) : (
                          <span
                            className={`${CHIP} text-slate-400`}
                            title={ru ? 'Проверки проекта не прошли' : 'The project checks did not pass'}
                          >
                            <XCircle className="w-2.5 h-2.5 shrink-0 text-rose-400" />
                            {ru ? `упали: ${verification.errors}` : `failed: ${verification.errors}`}
                          </span>
                        ))}
                      {changeset.paths.length > 0 && (
                        <span
                          className="min-w-0 truncate font-mono text-[10px] text-slate-500"
                          title={changeset.paths.join('\n')}
                        >
                          {changeset.paths.slice(0, 3).join(', ')}
                          {changeset.paths.length > 3 ? ` +${changeset.paths.length - 3}` : ''}
                        </span>
                      )}
                    </div>

                    {checkpoint && rollbackMark(checkpoint)}
                  </div>
                );
              })}

              {olderCheckpoints.length > 0 && (
                <div className="space-y-1 py-2" data-history-older>
                  {olderCheckpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                          {formatTime(checkpoint.createdAt)}
                        </span>
                        {checkpointBadge(checkpoint)}
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">
                          {ru ? 'точка старше показанных записей' : 'older than the writes shown here'}
                        </span>
                      </div>
                      {rollbackMark(checkpoint)}
                    </div>
                  ))}
                </div>
              )}

              {startCheckpoints.length > 0 && (
                <div className="space-y-1 py-2" data-history-start>
                  {startCheckpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 text-[11px] text-slate-400">
                          {ru ? 'Состояние до первой записи' : 'The state before the first write'}
                        </span>
                        {checkpointBadge(checkpoint)}
                      </div>
                      {rollbackMark(checkpoint)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
