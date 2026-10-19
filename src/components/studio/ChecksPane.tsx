import React, { useEffect, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { fetchWorkspaceApi } from '../../services/api';
import { ProjectCheckStrip } from '../ProjectCheckStrip';

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
  }, [language]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
        {ru ? 'Смотрим, что можно проверить…' : 'Looking for checks…'}
      </div>
    );
  }

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FolderOpen className="h-6 w-6 text-slate-600" />
        <p className="max-w-xs text-xs leading-relaxed text-slate-400">
          {ru
            ? 'Папка проекта не подключена — проверять пока нечего. Подключите её на экране «Файлы проекта».'
            : 'No project folder is connected, so there is nothing to check yet. Connect it on the Project Files screen.'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <ProjectCheckStrip root={root} />
    </div>
  );
};
