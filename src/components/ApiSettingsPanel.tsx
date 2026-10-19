import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Pencil, RefreshCw, Trash2, X, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { IconButton } from './ui/Button';

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

type Action = 'test' | 'remove';

/**
 * API keys: a list, not a form.
 *
 * The panel used to be six little forms — a field, a Save button and a badge per provider — and
 * the saved ones were the worst: a masked value, then an empty field asking to replace it, then
 * three buttons. What is left is the shape of a settings list in an editor: one row per provider,
 * the state where the field would be, and the actions where the state ends. A key is written the
 * moment the field is left (or Enter is pressed); there is no Save button to forget to press.
 *
 * The saved row collapses to its mask: the field only exists while it is being filled in, which is
 * what keeps a provider who is already set up from taking twice the height of one who is not.
 */
export const ApiSettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { language, t } = useLanguage();
  const s = t.apiSettings;

  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<ProviderId | null>(null);
  const [savingId, setSavingId] = useState<ProviderId | null>(null);
  /** The same fact as `savingId`, read synchronously: Enter saves and the blur right after it must not. */
  const savingRef = useRef<ProviderId | null>(null);
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
      if (event.key !== 'Escape') return;
      // Escape first steps out of a key field; the next one closes the panel.
      if (editingId) {
        setEditingId(null);
        setDrafts((prev) => ({ ...prev, [editingId]: '' }));
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, onClose]);

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

  /**
   * Writes the field the moment it loses focus. An empty field is not an error: leaving it means
   * "not now", so the row simply returns to its mask. The busy guard matters because Enter saves
   * and the blur that follows must not write the same key twice.
   */
  const commitKey = async (provider: ProviderStatus) => {
    if (savingRef.current === provider.id || busy?.provider === provider.id) return;
    const key = (drafts[provider.id] ?? '').trim();
    if (!key) {
      if (editingId === provider.id) setEditingId(null);
      setDrafts((prev) => ({ ...prev, [provider.id]: '' }));
      return;
    }

    savingRef.current = provider.id;
    setSavingId(provider.id);
    setNotice(null);
    try {
      await mutate(provider.id, 'PUT', key);
      setDrafts((prev) => ({ ...prev, [provider.id]: '' }));
      setEditingId(null);
    } catch (err: any) {
      setNotice({ provider: provider.id, kind: 'error', text: err?.message || s.saveFailed });
    } finally {
      savingRef.current = null;
      setSavingId(null);
    }
  };

  const handleRemove = async (provider: ProviderId) => {
    setBusy({ provider, action: 'remove' });
    setNotice(null);
    try {
      await mutate(provider, 'DELETE');
      setDrafts((prev) => ({ ...prev, [provider]: '' }));
      setEditingId(null);
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
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 pb-1 pt-4">
          <h2 id="api-settings-dialog-title" className="text-[15px] font-semibold text-slate-100">
            {s.title}
          </h2>
          <IconButton label={t.common.close} icon={X} size="sm" onClick={onClose} />
        </div>

        <p className="px-5 pb-3 text-[11px] text-slate-400">
          {s.activeProvider}: <span className="text-slate-300">{activeName || s.noProvider}</span>
          {activeName && payload?.lastModel && (
            <span className="ml-2 font-mono text-[11px] text-slate-400">{payload.lastModel}</span>
          )}
        </p>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
          </div>
        ) : loadError || !payload ? (
          <div className="mx-5 mb-5 flex items-center gap-3 text-xs text-slate-300">
            <span>{s.loadFailed}</span>
            <button
              type="button"
              onClick={load}
              className="rounded-md px-2 py-1 text-[11px] text-indigo-300 transition-colors hover:bg-indigo-500/10 hover:text-indigo-200"
            >
              {s.retry}
            </button>
          </div>
        ) : (
          <div>
            {payload.providers.map((provider) => {
              const name = language === 'ru' ? provider.labelRu : provider.labelEn;
              const rowBusy = busy?.provider === provider.id ? busy.action : null;
              const rowNotice = notice?.provider === provider.id ? notice : null;
              const isSaving = savingId === provider.id;
              const draft = drafts[provider.id] ?? '';
              const isEditing = !provider.configured || editingId === provider.id;
              const isVisible = Boolean(visible[provider.id]);
              const disabled = isSaving || Boolean(rowBusy);

              return (
                <div key={provider.id} className="border-b border-slate-800/60 px-5 py-2.5 last:border-b-0">
                  {/* Fixed side columns, so the mask and every field start on the same x in every
                      row; the status is the last cell, which puts all of them on one right edge. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[13rem_minmax(0,1fr)_11.5rem] sm:items-center sm:gap-4">
                    {/* Provider and the way to its dashboard, on one line so a row stays a row. */}
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium text-slate-200">{name}</span>
                      <a
                        href={provider.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 whitespace-nowrap text-[11px] text-slate-400 transition-colors hover:text-indigo-300"
                      >
                        {s.getKey}
                      </a>
                    </div>

                    {/* The field exists only while a key is being typed; a saved row shows its mask. */}
                    {isEditing ? (
                      <div className="relative">
                        <input
                          type={isVisible ? 'text' : 'password'}
                          value={draft}
                          autoFocus={editingId === provider.id}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={isSaving}
                          onChange={(event) => setDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                          onPaste={(event) => {
                            // Dashboards copy keys with stray spaces and newlines — clean them up front.
                            const pasted = event.clipboardData.getData('text');
                            event.preventDefault();
                            const cleaned = pasted.replace(/\s+/g, '');
                            setDrafts((prev) => ({ ...prev, [provider.id]: cleaned }));
                          }}
                          onBlur={() => commitKey(provider)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitKey(provider);
                            }
                          }}
                          placeholder={provider.configured ? s.keyPlaceholderReplace : s.keyPlaceholder}
                          /*
                            The rows look alike and their fields look alike: without this, a screen
                            reader announces the same placeholder for every provider and the user
                            cannot tell whose key is being asked for.
                          */
                          aria-label={`${s.keyLabel}: ${name}`}
                          className="h-8 w-full rounded-md border border-slate-800 bg-slate-950 pl-2.5 pr-8 font-mono text-xs text-slate-100 placeholder:text-slate-400 focus:border-indigo-400/60 focus:outline-none disabled:opacity-60"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2">
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                          ) : (
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => setVisible((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                              className="cursor-pointer text-slate-500 transition-colors hover:text-slate-300"
                              title={isVisible ? s.hide : s.show}
                              aria-label={`${isVisible ? s.hide : s.show}: ${name}`}
                            >
                              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5" title={provider.envVar}>
                        <span className="truncate font-mono text-xs text-slate-300">{provider.masked}</span>
                        {provider.prefixWarning && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" aria-label={s.prefixWarning} />
                        )}
                      </div>
                    )}

                    {/* Actions in the right column, state on its far edge. */}
                    <div className="flex items-center justify-end gap-1">
                      {provider.configured && !isEditing && (
                        <div className="flex items-center">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            label={`${s.testKey}: ${name}`}
                            icon={RefreshCw}
                            disabled={disabled}
                            onClick={() => handleTest(provider.id)}
                          />
                          <IconButton
                            size="xs"
                            variant="ghost"
                            label={`${s.editKey}: ${name}`}
                            icon={Pencil}
                            disabled={disabled}
                            onClick={() => {
                              setNotice(null);
                              setDrafts((prev) => ({ ...prev, [provider.id]: '' }));
                              setEditingId(provider.id);
                            }}
                          />
                          {provider.source === 'app' && (
                            <IconButton
                              size="xs"
                              variant="ghost"
                              label={`${s.removeKey}: ${name}`}
                              icon={Trash2}
                              disabled={disabled}
                              className="text-rose-300 enabled:hover:bg-rose-500/10 enabled:hover:text-rose-200"
                              onClick={() => handleRemove(provider.id)}
                            />
                          )}
                        </div>
                      )}

                      <span
                        className={`ml-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] ${
                          provider.configured ? 'text-emerald-300/90' : 'text-slate-400'
                        }`}
                        aria-live="polite"
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            provider.configured ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />
                        {isSaving
                          ? s.saving
                          : rowBusy === 'test'
                          ? s.testing
                          : provider.configured
                          ? provider.source === 'app'
                            ? s.fromApp
                            : s.fromEnv
                          : s.notConfigured}
                      </span>
                    </div>
                  </div>

                  {rowNotice && (
                    <p
                      role="status"
                      className={`mt-1.5 text-[11px] ${
                        rowNotice.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {rowNotice.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
