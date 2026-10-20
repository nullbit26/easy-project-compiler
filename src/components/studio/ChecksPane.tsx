import React, { useEffect, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { fetchWorkspaceApi } from '../../services/api';
import { useFolderRevision } from '../../services/folderFeed';
import { ProjectCheckStrip } from '../ProjectCheckStrip';
import { PaneActionsRow } from './paneActions';

/**
 * The verification panel as a window: the same strip the guided flow uses, so a run started here
 * is the same run — compared against the previous baseline, written down as evidence — and not a
 * second, quieter checker that disagrees with the first.
 */
export const ChecksPane: React.FC = () => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Files connected a different folder while this window stayed open. */
  const folderRevision = useFolderRevision();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkspaceApi(language)
      .then((workspace) => {
        if (!cancelled) setRoot(workspace.root);
      })
      .catch(() => {
        if (!cancelled) setRoot(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language, folderRevision]);

  // The strip draws its own header; this panel has none to add — only the studio's window controls,
  // on a row that is not there when the panel is drawn outside the studio.
  const body = loading ? (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
      {ru ? 'Смотрим, что можно проверить…' : 'Looking for checks…'}
    </div>
  ) : !root ? (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderOpen className="h-6 w-6 text-slate-600" />
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">
        {ru
          ? 'Папка проекта не подключена — проверять пока нечего. Подключите её на экране «Файлы проекта».'
          : 'No project folder is connected, so there is nothing to check yet. Connect it on the Project Files screen.'}
      </p>
    </div>
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <ProjectCheckStrip root={root} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneActionsRow />
      {body}
    </div>
  );
};
