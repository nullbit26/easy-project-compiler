import React, { useEffect, useMemo, useState } from 'react';
import { FileCode, FolderOpen, Loader2, RefreshCw, Search } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { fetchWorkspaceApi, WorkspaceFileEntry } from '../../services/api';
import { formatBytes } from '../../utils/byteSize';
import { IconButton } from '../ui/Button';
import { TASK_FILE_DRAG_TYPE } from '../../utils/taskFiles';

interface FilePaneProps {
  /** The file the editor window is showing, so the tree can keep its place. */
  activePath?: string | null;
  onOpenFile: (path: string) => void;
}

/**
 * The project's real files, as a tree the plan can be read against.
 *
 * It lists the connected folder and nothing invented: a path that is not on disk never appears
 * here. Clicking a row hands the path to the editor window; the studio decides which window that
 * is, because the layout — not the file list — owns where a window sits.
 */
export const FilePane: React.FC<FilePaneProps> = ({ activePath, onOpenFile }) => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [files, setFiles] = useState<WorkspaceFileEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    fetchWorkspaceApi(language)
      .then((workspace) => setFiles(workspace.files || []))
      .catch((err: any) => {
        setFiles([]);
        setError(err?.userMessage || (ru ? 'Папку не удалось прочитать.' : 'The folder could not be read.'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = files || [];
    if (!needle) return list;
    return list.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-800/80 px-2 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-slate-500" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={ru ? 'Фильтр по пути…' : 'Filter by path…'}
          aria-label={ru ? 'Фильтр файлов' : 'Filter files'}
          className="h-6 min-w-0 flex-1 bg-transparent text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{visible.length}</span>
        <IconButton
          label={ru ? 'Обновить список' : 'Refresh the list'}
          icon={RefreshCw}
          size="xs"
          onClick={load}
          disabled={loading}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            {ru ? 'Читаем папку…' : 'Reading the folder…'}
          </div>
        ) : error ? (
          <p className="px-3 py-4 text-[11px] leading-relaxed text-rose-300">{error}</p>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <FolderOpen className="h-6 w-6 text-slate-600" />
            <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
              {files && files.length > 0
                ? ru
                  ? 'Ни один файл не подходит под фильтр.'
                  : 'No file matches the filter.'
                : ru
                ? 'В папке нет файлов — или папка ещё не подключена («Файлы проекта»).'
                : 'The folder has no files — or no folder is connected yet (Project Files).'}
            </p>
          </div>
        ) : (
          visible.map((file) => {
            const active = file.path === activePath;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onOpenFile(file.path)}
                /* The plan card next door is a drop target: the same path that opens here joins
                   that card's AI context when dropped on it. */
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(TASK_FILE_DRAG_TYPE, file.path);
                  event.dataTransfer.setData('text/plain', file.path);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title={file.path}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors ${
                  active ? 'bg-indigo-500/12 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <FileCode
                  className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-indigo-300' : 'text-slate-500'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px]">{file.name}</span>
                  {file.dir && (
                    <span className="block truncate font-mono text-[9px] text-slate-500">{file.dir}/</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-slate-600">
                  {formatBytes(file.sizeBytes)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
