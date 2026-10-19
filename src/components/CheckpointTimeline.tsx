import React, { useState } from 'react';
import { IconButton } from './ui/Button';
import { AlertTriangle,
  CheckCircle2,
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
 * back to. Undo has existed per batch for a while — this is what makes it a story you can read
 * and rewind, instead of a list of anonymous copies.
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
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null);

  const checkpointFor = (changesetId: string | null) =>
    checkpoints.find((checkpoint) => checkpoint.changesetId === changesetId) || null;

  return (
    /* A section of the screen's one surface, not a card on it. */
    <div className="space-y-3 border-t border-slate-800/70 pt-5">
      <div>
        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
          {ru ? 'История изменений' : 'Change history'}
        </span>
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" />
          <span>{ru ? 'Чекпоинты и откат' : 'Checkpoints and rollback'}</span>
        </h4>
      </div>

      <p className="text-[11px] text-slate-400">
        {ru
          ? 'Чекпоинт — это «здесь всё работало». Откат возвращает папку ровно в это состояние, отменяя все записи после него.'
          : 'A checkpoint means “everything worked here”. Rolling back returns the folder to exactly that state by undoing every write after it.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={ru ? 'Название чекпоинта' : 'Checkpoint name'}
          placeholder={ru ? 'Название: например «Меню работает»' : 'Name: e.g. "Menu works"'}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-indigo-600"
        />
        <button
          onClick={() => {
            onCreate(name.trim());
            setName('');
          }}
          disabled={busy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500/15 px-2.5 text-[11px] font-medium text-indigo-100 ring-1 ring-inset ring-indigo-400/40 transition-colors enabled:hover:bg-indigo-500/25 enabled:hover:text-white disabled:pointer-events-none disabled:opacity-50"
        >
          {busyId === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
          <span>{ru ? 'Создать чекпоинт' : 'Create checkpoint'}</span>
        </button>
      </div>

      {checkpoints.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {ru ? `Чекпоинты (${checkpoints.length})` : `Checkpoints (${checkpoints.length})`}
          </span>
          {checkpoints.map((checkpoint) => (
            <div
              key={checkpoint.id}
              className="bg-slate-950/60 rounded-lg px-2.5 py-2 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Flag className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-[11px] font-bold text-white truncate flex-1">{checkpoint.name}</span>
                <IconButton
                  label={ru ? 'Удалить чекпоинт (история останется)' : 'Delete the checkpoint (history stays)'}
                  icon={Trash2}
                  size="xs"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => onDelete(checkpoint.id)}
                />
              </div>
              <div className="text-[10px] text-slate-400 pl-5">{formatTime(checkpoint.createdAt)}</div>

              {confirmRollback === checkpoint.id ? (
                <div className="pl-5 space-y-1.5">
                  <div className="text-[10px] text-amber-300 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>
                      {ru
                        ? 'Все записи после этого чекпоинта будут отменены. Продолжить?'
                        : 'Every write after this checkpoint will be undone. Continue?'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onRollback(checkpoint.id);
                        setConfirmRollback(null);
                      }}
                      disabled={busy}
                      className="inline-flex h-6 items-center gap-1 rounded-md bg-rose-600 px-2 text-[10px] font-medium text-white transition-colors enabled:hover:bg-rose-500 disabled:pointer-events-none disabled:opacity-50"
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
              ) : (
                <button
                  onClick={() => setConfirmRollback(checkpoint.id)}
                  disabled={busy}
                  className="ml-5 inline-flex h-6 items-center gap-1 rounded-md bg-slate-800 px-2 text-[10px] font-medium text-slate-200 ring-1 ring-inset ring-slate-700 transition-colors enabled:hover:bg-rose-950/60 enabled:hover:text-rose-200 disabled:pointer-events-none disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{ru ? 'Откатить сюда' : 'Roll back here'}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 pt-2 border-t border-slate-800">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {ru ? `Что было записано (${timeline.length})` : `What was written (${timeline.length})`}
        </span>

        {timeline.length === 0 ? (
          <div className="text-[11px] text-slate-400">
            {ru ? 'Пока ничего не записывали.' : 'Nothing has been written yet.'}
          </div>
        ) : (
          timeline.map((changeset) => {
            const checkpoint = checkpointFor(changeset.id);
            const rolledBack = Boolean(changeset.rolledBackAt);
            const verification = changeset.verification;
            return (
              <div
                key={changeset.id}
                className={`rounded-lg px-2.5 py-2 space-y-1 ${
                  rolledBack ? 'bg-slate-950/40 opacity-70' : 'bg-slate-950/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 shrink-0">{formatTime(changeset.createdAt)}</span>
                  <span className="text-[10px] text-slate-300 truncate flex-1">
                    {changeset.label
                      ? changeset.label
                      : ru
                      ? `файлов: ${changeset.fileCount}`
                      : `${changeset.fileCount} file(s)`}
                  </span>
                  {!rolledBack && (
                    <button
                      onClick={() => onUndoChangeset(changeset.id)}
                      disabled={busy}
                      className="text-slate-400 enabled:hover:text-rose-300 disabled:opacity-40 enabled:cursor-pointer shrink-0"
                      title={ru ? 'Отменить только эту запись' : 'Undo just this write'}
                    >
                      {busyId === changeset.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Undo2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {checkpoint && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 inline-flex items-center gap-1">
                      <Flag className="w-2.5 h-2.5" />
                      {checkpoint.name}
                    </span>
                  )}
                  {rolledBack && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {ru ? 'отменено' : 'undone'}
                    </span>
                  )}
                  {changeset.formatting && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/60 inline-flex items-center gap-1"
                      title={changeset.formatting.error || undefined}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {ru
                        ? `приведено в порядок: ${changeset.formatting.tool} (${changeset.formatting.changed})`
                        : `tidied: ${changeset.formatting.tool} (${changeset.formatting.changed})`}
                    </span>
                  )}
                  {changeset.weight && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                        changeset.weight.heavy
                          ? 'bg-amber-950 text-amber-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                      title={weightTitle(changeset.weight, ru)}
                    >
                      <HardDrive className="w-2.5 h-2.5" />
                      {formatSignedBytes(changeset.weight.netBytes)}
                    </span>
                  )}
                  {verification &&
                    (verification.ok ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {ru ? 'проверки прошли' : 'checks passed'}
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 inline-flex items-center gap-1">
                        <XCircle className="w-2.5 h-2.5" />
                        {ru
                          ? `проверки упали: ${verification.errors}`
                          : `checks failed: ${verification.errors}`}
                      </span>
                    ))}
                </div>

                {changeset.paths.length > 0 && (
                  <div className="text-[10px] font-mono text-slate-400 truncate" title={changeset.paths.join('\n')}>
                    {changeset.paths.slice(0, 3).join(', ')}
                    {changeset.paths.length > 3 ? ` +${changeset.paths.length - 3}` : ''}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
