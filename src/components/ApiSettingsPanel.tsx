import React, { useCallback, useEffect, useState } from 'react';
import {
  Settings,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Info,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  PlugZap,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/** Provider ids come from the server (server/store/apiKeyStore.ts); the panel stays id-agnostic. */
type ProviderId = string;

interface ProviderStatus {
  id: ProviderId;
  envVar: string;
  labelRu: string;
  labelEn: string;
  keyUrl: string;
  configured: boolean;
  source: 'app' | 'env' | null;
  masked: string | null;
  prefixWarning: boolean;
}

interface StatusPayload {
  providers: ProviderStatus[];
  activeProvider: ProviderId | null;
  lastModel: string | null;
}

interface TestResult {
  ok: boolean;
  provider: ProviderId;
  reason: string;
  model?: string;
  message: string;
}

type Action = 'save' | 'test' | 'remove';

// Drafts are keyed by whatever provider ids the server reports, so adding a provider
// on the backend never requires touching this component.

export const ApiSettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { language, t } = useLanguage();
  const s = t.apiSettings;

  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<{ provider: ProviderId; action: Action } | null>(null);
  const [notice, setNotice] = useState<{ provider: ProviderId; kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/api-keys');
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error('Bad response');
      setPayload(json.data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const localizeReason = (reason: string): string => {
    switch (reason) {
      case 'ok':
        return s.testOk;
      case 'auth':
        return s.reasonAuth;
      case 'quota':
        return s.reasonQuota;
      case 'model':
        return s.reasonModel;
      case 'network':
        return s.reasonNetwork;
      case 'invalid_response':
        return s.reasonEmptyResponse;
      case 'missing_key':
        return s.reasonMissing;
      default:
        return s.reasonHttp;
    }
  };

  const saveErrorText = (status: number, reason: string | undefined, fallback?: string): string => {
    if (status === 403) return s.accessDenied;
    if (reason === 'empty_key') return s.saveEmpty;
    if (reason === 'invalid_key') return s.saveInvalid;
    if (reason === 'unknown_provider') return s.unknownProvider;
    return fallback || s.saveFailed;
  };

  const mutate = async (provider: ProviderId, method: 'PUT' | 'DELETE', key?: string): Promise<StatusPayload> => {
    const res = await fetch(`/api/settings/api-keys/${provider}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ key }) : undefined
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(saveErrorText(res.status, json?.details?.reason, json?.userMessage));
    }
    setPayload(json.data);
    return json.data as StatusPayload;
  };

  const handleSave = async (provider: ProviderId) => {
    setBusy({ provider, action: 'save' });
    setNotice(null);
    try {
      await mutate(provider, 'PUT', drafts[provider] ?? '');
      setDrafts((prev) => ({ ...prev, [provider]: '' }));
      setNotice({ provider, kind: 'ok', text: s.savedKey });
    } catch (err: any) {
      setNotice({ provider, kind: 'error', text: err?.message || s.saveFailed });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (provider: ProviderId) => {
    setBusy({ provider, action: 'remove' });
    setNotice(null);
    try {
      await mutate(provider, 'DELETE');
      setNotice({ provider, kind: 'ok', text: s.removedKey });
    } catch (err: any) {
      setNotice({ provider, kind: 'error', text: err?.message || s.saveFailed });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (provider: ProviderId) => {
    setBusy({ provider, action: 'test' });
    setNotice(null);
    try {
      const res = await fetch(`/api/settings/api-keys/${provider}/test`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(saveErrorText(res.status, json?.details?.reason, json?.userMessage));
      }
      const result = json.data as TestResult;
      setNotice({
        provider,
        kind: result.ok ? 'ok' : 'error',
        text: `${localizeReason(result.reason)}${result.model ? ` · ${result.model}` : ''}`
      });
    } catch (err: any) {
      setNotice({ provider, kind: 'error', text: err?.message || s.testFailed });
    } finally {
      setBusy(null);
    }
  };

  const activeLabel = payload?.providers.find((p) => p.id === payload.activeProvider);
  const activeName = activeLabel ? (language === 'ru' ? activeLabel.labelRu : activeLabel.labelEn) : null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Escape already closes this panel; role and aria-modal say the same thing to a screen
          reader, and `aria-labelledby` names it after its own heading instead of leaving it as an
          unlabelled box. The page behind is inert while it is open (see App's `modalOpen`). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-settings-dialog-title"
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="api-settings-dialog-title" className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              {s.title}
            </h2>
            <p className="text-xs text-slate-400 mt-1">{s.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 cursor-pointer"
            aria-label={t.common.close}
          >
            ✕
          </button>
        </div>

        {/* Active provider summary */}
        <div className="flex items-center gap-2 text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
          <PlugZap className={`w-4 h-4 shrink-0 ${activeName ? 'text-emerald-400' : 'text-slate-400'}`} />
          <span className="text-slate-400 font-medium">{s.activeProvider}:</span>
          <span className={`font-bold ${activeName ? 'text-emerald-300' : 'text-slate-300'}`}>
            {activeName || s.noProvider}
          </span>
          {activeName && payload?.lastModel && (
            <span className="text-slate-400 ml-auto font-mono text-[11px]">{payload.lastModel}</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        ) : loadError || !payload ? (
          <div className="flex items-center justify-between gap-3 bg-rose-950/30 border border-rose-500/30 p-4 rounded-xl text-xs text-rose-200">
            <span>{s.loadFailed}</span>
            <button
              onClick={load}
              className="font-bold bg-rose-600/30 hover:bg-rose-600/50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              {s.retry}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {payload.providers.map((provider) => {
              const name = language === 'ru' ? provider.labelRu : provider.labelEn;
              const rowBusy = busy?.provider === provider.id ? busy.action : null;
              const rowNotice = notice?.provider === provider.id ? notice : null;
              const draft = drafts[provider.id] ?? '';
              const isVisible = Boolean(visible[provider.id]);
              const canSave = draft.trim().length > 0 && !rowBusy;

              return (
                <div key={provider.id} className="p-4 bg-slate-950/60 rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <KeyRound className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="font-bold text-sm text-slate-200 truncate">{name}</span>
                      <a
                        href={provider.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 shrink-0"
                      >
                        {s.getKey}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    {provider.configured ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                        {provider.source === 'app' ? s.fromApp : s.fromEnv}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-bold text-rose-400 shrink-0">
                        <ShieldAlert className="w-4 h-4" />
                        {s.notConfigured}
                      </span>
                    )}
                  </div>

                  {provider.configured && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="font-mono bg-slate-800/50 rounded px-2 py-0.5">{provider.masked}</span>
                      <span className="font-mono text-slate-400">{provider.envVar}</span>
                      {provider.prefixWarning && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          {s.prefixWarning}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        value={draft}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                        onPaste={(event) => {
                          // Dashboards copy keys with stray spaces and newlines — clean them up front.
                          const pasted = event.clipboardData.getData('text');
                          event.preventDefault();
                          const cleaned = pasted.replace(/\s+/g, '');
                          setDrafts((prev) => ({ ...prev, [provider.id]: cleaned }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && canSave) handleSave(provider.id);
                        }}
                        placeholder={provider.configured ? s.keyPlaceholderReplace : s.keyPlaceholder}
                        /*
                          The four rows look alike and their fields look alike: without this, a screen
                          reader announces "Вставьте ключ API" four times and the user cannot tell whose
                          key is being asked for. A placeholder is not a label — it is gone as soon as
                          there is a value to read.
                        */
                        aria-label={`${s.keyLabel}: ${name}`}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-9 py-2 text-sm text-slate-100 placeholder-slate-400 focus:border-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setVisible((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 cursor-pointer"
                        title={isVisible ? s.hide : s.show}
                        aria-label={`${isVisible ? s.hide : s.show}: ${name}`}
                      >
                        {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSave(provider.id)}
                        disabled={!canSave}
                        className="flex items-center gap-1.5 bg-indigo-600 enabled:hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs px-3 py-2 rounded-lg transition-colors enabled:cursor-pointer"
                      >
                        {rowBusy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {rowBusy === 'save' ? s.saving : s.saveKey}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTest(provider.id)}
                        disabled={!provider.configured || Boolean(rowBusy)}
                        className="flex items-center gap-1.5 bg-slate-800 enabled:hover:bg-slate-700 disabled:text-slate-600 text-slate-200 font-bold text-xs px-3 py-2 rounded-lg transition-colors enabled:cursor-pointer"
                      >
                        {rowBusy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                        {rowBusy === 'test' ? s.testing : s.testKey}
                      </button>

                      {provider.source === 'app' && (
                        <button
                          type="button"
                          onClick={() => handleRemove(provider.id)}
                          disabled={Boolean(rowBusy)}
                          className="flex items-center gap-1.5 bg-slate-800 enabled:hover:bg-rose-600/30 disabled:text-slate-600 text-rose-300 font-bold text-xs px-3 py-2 rounded-lg transition-colors enabled:cursor-pointer"
                          title={s.removeKey}
                        >
                          {rowBusy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{s.removeKey}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {rowNotice && (
                    <div
                      className={`flex items-start gap-2 text-[11px] font-medium rounded-lg px-2.5 py-1.5 border ${
                        rowNotice.kind === 'ok'
                          ? 'text-emerald-300 bg-emerald-950/30 border-emerald-500/30'
                          : 'text-rose-300 bg-rose-950/30 border-rose-500/30'
                      }`}
                    >
                      {rowNotice.kind === 'ok' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <span>{rowNotice.text}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-indigo-950/30 border border-indigo-500/30 p-4 rounded-xl text-xs text-indigo-200 space-y-2">
          <div className="flex gap-2 items-start">
            <Info className="w-4 h-4 shrink-0 text-indigo-400" />
            <p>{s.localOnly}</p>
          </div>
          <div className="flex gap-2 items-start text-indigo-300/80">
            <Info className="w-4 h-4 shrink-0 text-indigo-400/70" />
            <p>{s.envNotice}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
