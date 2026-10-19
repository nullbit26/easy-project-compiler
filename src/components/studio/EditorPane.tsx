import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileCode, Loader2, RotateCcw, Save } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { readWorkspaceFileApi, writeWorkspaceFileApi } from '../../services/api';
import { IconButton } from '../ui/Button';
import { formatBytes } from '../../utils/byteSize';

interface EditorPaneProps {
  /** The file to show; picked in the file tree, not typed here. */
  path: string | null;
}

/**
 * The local editor window.
 *
 * Reading and writing the real file — not the project's copy — is the point: this is where the
 * user watches what the robot wrote, or fixes the last line by hand before the next attempt. The
 * window is deliberately plain (one monospaced surface, no line numbers) because its job is to
 * show a diff-sized file next to the plan, not to be an IDE inside an IDE.
 */
export const EditorPane: React.FC<EditorPaneProps> = ({ path }) => {
  const { language } = useLanguage();
  const ru = language === 'ru';

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [size, setSize] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!path) {
      setContent('');
      setSaved('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setTruncated(false);
    readWorkspaceFileApi(path)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        setSaved(file.content);
        setTruncated(file.truncated);
        setSize(file.sizeBytes);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.userMessage || (ru ? 'Файл не удалось прочитать.' : 'The file could not be read.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language]);

  const dirty = useMemo(() => content !== saved, [content, saved]);

  const save = useCallback(async () => {
    if (!path || saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      await writeWorkspaceFileApi({ path, content });
      setSaved(content);
      setSize(new Blob([content]).size);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1600);
    } catch (err: any) {
      setError(err?.userMessage || (ru ? 'Записать файл не удалось.' : 'The file could not be written.'));
    } finally {
      setSaving(false);
    }
  }, [content, dirty, path, ru, saving]);

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FileCode className="h-6 w-6 text-slate-600" />
        <p className="max-w-xs text-xs leading-relaxed text-slate-400">
          {ru
            ? 'Выберите файл в окне «Файлы» — он откроется здесь. Правки сохраняются прямо в папку проекта.'
            : 'Pick a file in the Files window and it opens here. Edits are written straight into the project folder.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 px-2 py-1.5">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate font-mono text-[10px] text-slate-300">{path}</span>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title={ru ? 'Есть несохранённые правки' : 'Unsaved changes'} />}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-slate-600">{formatBytes(size)}</span>
        {justSaved && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
        <IconButton
          label={ru ? 'Вернуть прочитанное' : 'Revert to the file on disk'}
          icon={RotateCcw}
          size="xs"
          disabled={!dirty || saving}
          onClick={() => setContent(saved)}
        />
        <IconButton
          label={ru ? 'Сохранить файл (Ctrl+S)' : 'Save the file (Ctrl+S)'}
          icon={saving ? Loader2 : Save}
          size="xs"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className={saving ? 'animate-spin' : ''}
        />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          {ru ? 'Открываем файл…' : 'Opening the file…'}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              void save();
            }
          }}
          spellCheck={false}
          wrap="off"
          aria-label={ru ? `Содержимое файла ${path}` : `Contents of ${path}`}
          className="min-h-0 flex-1 resize-none overflow-auto bg-slate-950 px-3 py-2 font-mono text-[11px] leading-[1.65] text-slate-200 selection:bg-indigo-500/30 focus:outline-none"
        />
      )}

      {(error || truncated) && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/70 px-2 py-1 text-[10px]">
          {error ? (
            <span className="text-rose-300">{error}</span>
          ) : (
            <span className="text-amber-300">
              {ru
                ? 'Файл большой: показано только начало. Сохранение перезапишет его целиком.'
                : 'This file is large: only its beginning is shown. Saving rewrites it whole.'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
