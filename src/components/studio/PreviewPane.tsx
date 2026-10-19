import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bug, Loader2, MonitorPlay, RotateCcw, Terminal, X } from 'lucide-react';
import { ProjectState } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { ApiError, buildPreviewApi, PreviewBuild, PreviewDiagnostic } from '../../services/api';
import { IconButton } from '../ui/Button';

interface PreviewPaneProps {
  project: ProjectState | null;
  onSendErrorToCoach?: (text: string) => void;
}

/**
 * The browser sandbox as one window of the studio.
 *
 * It is deliberately not the sandbox *screen*: that screen is a page with a console, a bundle
 * composition and a run-source column, and all of it is about diagnosing a build. A window in a
 * split layout has to be the picture — the page fills every pixel it is given, so a game or a site
 * sits beside the plan exactly as it would in a browser tab — with the errors folded into a strip
 * at the bottom instead of a column on the right.
 */
export const PreviewPane: React.FC<PreviewPaneProps> = ({ project, onSendErrorToCoach }) => {
  const { language } = useLanguage();
  const ru = language === 'ru';

  const [build, setBuild] = useState<PreviewBuild | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ type: 'log' | 'error' | 'warn'; text: string; time: string }>>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [showConsole, setShowConsole] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  /** True while the keyboard is inside the frame: the one element the browser gives no focus ring. */
  const [frameHoldsKeyboard, setFrameHoldsKeyboard] = useState(false);

  const runBuild = async () => {
    setIsBuilding(true);
    setMessage(null);
    try {
      const result = await buildPreviewApi({ language });
      setBuild(result);
      setPreviewKey((key) => key + 1);
      setLogs([]);
      setRuntimeError(null);
    } catch (error: any) {
      setBuild(null);
      setMessage(
        error instanceof ApiError
          ? error.userMessage
          : ru
          ? 'Не удалось собрать проект.'
          : 'The project could not be built.'
      );
    } finally {
      setIsBuilding(false);
    }
  };

  useEffect(() => {
    void runBuild();
    // One build per connected folder and per language; the reload button is the manual way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, language]);

  // Console and runtime errors from inside the frame, on the same channel the sandbox screen uses.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== 'PREVIEW_CONSOLE_LOG') return;
      setLogs((prev) => [
        { type: event.data.logType, text: event.data.text, time: event.data.time },
        ...prev.slice(0, 49)
      ]);
      if (event.data.logType === 'error') {
        setRuntimeError(event.data.text);
        setShowConsole(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  /*
   * Tabbing into the running page moves focus into the frame's own document, and the frame element
   * then matches neither `:focus` nor `:focus-visible`. CodePreviewRunner draws its own ring for the
   * same reason; a window in the studio needs the same answer, or the audit finds one element on
   * the screen with no visible focus.
   */
  useEffect(() => {
    const check = () =>
      setFrameHoldsKeyboard(
        window.document.activeElement === iframeRef.current && window.document.hasFocus()
      );
    window.addEventListener('blur', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('blur', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const diagnostics: PreviewDiagnostic[] = build?.diagnostics || [];
  const frameSource = build?.ok ? build.url || build.html : null;
  const hasFolder = Boolean(build?.root) && !message;

  const errorTextForCoach = () => {
    if (diagnostics.length > 0) {
      return diagnostics
        .map((d) => `${d.file}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''} — ${d.text}`)
        .join('\n');
    }
    return runtimeError || logs.find((log) => log.type === 'error')?.text || '';
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      {/* A hairline of facts over the page: what is running, and the two controls that act on it. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 px-2 py-1.5">
        <span className="truncate font-mono text-[10px] text-slate-400">
          {build?.entry || (ru ? 'живой предпросмотр' : 'live preview')}
        </span>
        {build?.ok && (
          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
            {build.durationMs} {ru ? 'мс' : 'ms'}
          </span>
        )}
        {diagnostics.length > 0 && (
          <span className="shrink-0 rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
            {diagnostics.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label={ru ? 'Обновить сборку' : 'Rebuild'}
            icon={RotateCcw}
            size="xs"
            onClick={() => void runBuild()}
            disabled={isBuilding}
            className={isBuilding ? 'animate-spin' : ''}
          />
          <IconButton
            label={ru ? 'Консоль' : 'Console'}
            icon={Terminal}
            size="xs"
            pressed={showConsole}
            onClick={() => setShowConsole((open) => !open)}
          />
          {onSendErrorToCoach && (diagnostics.length > 0 || runtimeError) && (
            <IconButton
              label={ru ? 'Объяснить и починить с ИИ' : 'Explain and fix with AI'}
              icon={Bug}
              size="xs"
              variant="danger"
              onClick={() => onSendErrorToCoach(errorTextForCoach())}
            />
          )}
        </div>
      </div>

      {/* The page owns the rest of the window: no mat, no fixed height, no empty column. */}
      <div className="relative min-h-0 flex-1 bg-slate-900">
        {frameSource ? (
          <iframe
            key={previewKey}
            ref={iframeRef}
            title={ru ? 'Живой предпросмотр приложения или игры' : 'App & Game Live Preview'}
            src={build?.url || undefined}
            srcDoc={build?.url ? undefined : build?.html || undefined}
            className={`h-full w-full border-0 bg-slate-900 ${
              frameHoldsKeyboard ? 'outline-2 -outline-offset-2 outline-indigo-500' : ''
            }`}
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-downloads allow-popups"
            allow="fullscreen; autoplay; gamepad; clipboard-read; clipboard-write; cross-origin-isolated; accelerometer; gyroscope; microphone; camera"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            {isBuilding ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                <p className="text-xs text-slate-400">
                  {ru ? 'Собираем проект…' : 'Building the project…'}
                </p>
              </>
            ) : (
              <>
                <MonitorPlay className="h-6 w-6 text-slate-500" />
                <p className="max-w-xs text-xs leading-relaxed text-slate-400">
                  {message ||
                    (hasFolder
                      ? ru
                        ? 'В папке не нашлась точка входа — выберите её на экране песочницы.'
                        : 'No entry point was found in the folder — pick one on the sandbox screen.'
                      : ru
                      ? 'Подключите папку проекта на экране «Файлы проекта» — и песочница соберёт её целиком.'
                      : 'Connect the project folder on the Project Files screen and the sandbox will build it.')}
                </p>
              </>
            )}
          </div>
        )}

        {/* The console is a drawer over the page's bottom edge, never a column beside it. */}
        {showConsole && (
          <div className="absolute inset-x-0 bottom-0 z-10 max-h-[45%] overflow-hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300">
                <Terminal className="h-3 w-3 text-indigo-400" />
                {ru ? 'Консоль' : 'Console'} · {logs.length}
              </span>
              <IconButton
                label={ru ? 'Скрыть консоль' : 'Hide console'}
                icon={X}
                size="xs"
                onClick={() => setShowConsole(false)}
              />
            </div>
            <div className="max-h-40 overflow-y-auto px-2 pb-2 font-mono text-[10px] leading-relaxed">
              {logs.length === 0 ? (
                <p className="px-1 py-2 italic text-slate-500">
                  {ru ? 'Консоль пуста.' : 'The console is empty.'}
                </p>
              ) : (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className={`flex items-start gap-2 border-b border-slate-900 py-0.5 ${
                      log.type === 'error'
                        ? 'text-rose-400'
                        : log.type === 'warn'
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                    }`}
                  >
                    <span className="shrink-0 text-[9px] text-slate-500">{log.time}</span>
                    <span className="break-all">{log.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* A failed build is a strip, not a wall: the address of the problem and one action. */}
      {!showConsole && (diagnostics.length > 0 || runtimeError) && (
        <div className="shrink-0 border-t border-rose-900/60 bg-rose-950/40 px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-rose-200">
              {diagnostics[0]
                ? `${diagnostics[0].file}${diagnostics[0].line ? `:${diagnostics[0].line}` : ''} — ${diagnostics[0].text}`
                : runtimeError}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
