import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

interface HealthBuild {
  id?: string;
  version?: string;
  builtAt?: string;
  mode?: string;
  stateDir?: string | null;
}

/**
 * The build the app is actually running right now, taken from the server that served the page.
 *
 * It exists because "I installed the new version but I see the old one" is otherwise impossible to
 * answer: the number is baked into each build, shown in the window title and here, and the server
 * that answers also names it — so a stale screen can be told apart from an old file at a glance.
 *
 * Plain `npm run dev` has no build id and shows nothing.
 */
export const BuildBadge: React.FC = () => {
  const { language } = useLanguage();
  const [build, setBuild] = useState<HealthBuild | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof fetch !== 'function') return undefined;

    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setBuild(payload?.build ?? null);
      })
      .catch(() => {
        // The badge is a convenience: a server that cannot be asked is not an error to show.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const id = build?.id;
  if (!id || id === 'dev') return null;

  const ru = language === 'ru';
  const details = [
    build?.version ? `${ru ? 'Версия' : 'Version'}: ${build.version}` : '',
    `${ru ? 'Сборка' : 'Build'}: ${id}`,
    build?.builtAt ? new Date(build.builtAt).toLocaleString() : '',
    build?.mode === 'desktop'
      ? ru
        ? 'Оконная версия — закрытие окна останавливает приложение'
        : 'Desktop window — closing it stops the app'
      : '',
    build?.stateDir ? `${ru ? 'Данные приложения' : 'App data'}: ${build.stateDir}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // Plain small print, no pill: the number is there to be read when it is needed, not to be noticed.
  // The version leads when the build carries one; the build id stays a word away in the tooltip.
  return (
    <span title={details} className="font-mono text-[10px] text-slate-400 whitespace-nowrap cursor-default">
      {build?.version && build.version !== '0.0.0' ? `v${build.version}` : id}
    </span>
  );
};

export default BuildBadge;
