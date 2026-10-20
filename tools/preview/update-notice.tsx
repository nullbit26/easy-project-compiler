import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { LanguageProvider } from '../../src/context/LanguageContext';
import UpdateNotice, { UpdateBridge } from '../../src/components/UpdateNotice';
import type { UpdateState } from '../../src/utils/updateRules';

/**
 * The update row, in the sidebar it lives in, in every state it has.
 *
 * A browser build has no `window.desktopUpdates` and therefore never shows the row, so this page
 * injects a stand-in bridge per row. It is a development page, not part of the app: it exists so
 * the four states can be looked at at once, at the width the sidebar really gives them.
 */

const fakeBridge = (state: UpdateState): UpdateBridge => ({
  state: async () => state,
  check: async () => state,
  download: async () => state,
  install: async () => state,
  onStateChange: () => () => {}
});

const STATES: UpdateState[] = [
  { status: 'available', version: '1.3.2' },
  { status: 'downloading', version: '1.3.2', percent: 64 },
  { status: 'ready', version: '1.3.1', percent: 100 },
  { status: 'error', error: 'Нет связи с сервером обновлений' }
];

const Preview: React.FC = () => (
  <div className="min-h-screen bg-slate-950 p-10">
    <div className="w-64 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] font-semibold">
        <span>
          <span className="text-slate-200">RU</span> <span className="text-slate-700">/</span>{' '}
          <span className="text-slate-400">EN</span>
        </span>
        <span className="text-slate-400">Ключи API</span>
      </div>

      <div className="space-y-1.5">
        {STATES.map((state) => (
          <UpdateNotice key={state.status} bridge={fakeBridge(state)} />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-400">
        <span>v1.3.1</span>
        <span>261019-1112</span>
      </div>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <Preview />
  </LanguageProvider>
);
