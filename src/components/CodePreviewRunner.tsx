import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { buildSandboxDocument } from '../utils/sandboxDocument';
import { ApiError, buildPreviewApi, PreviewBuild, PreviewDiagnostic } from '../services/api';
import { formatBytes } from '../utils/byteSize';
import {
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  Bug,
  Sparkles,
  Terminal,
  Monitor,
  Smartphone,
  Tv,
  Check,
  Copy,
  AlertCircle,
  FolderOpen,
  Package,
  FileCode,
  Loader2
} from 'lucide-react';

interface CodePreviewRunnerProps {
  project: ProjectState | null;
  onSendErrorToCoach?: (errorText: string) => void;
  onOpenNewProjectModal?: () => void;
}

/**
 * The sandbox screen.
 *
 * It runs the project in the connected folder, not a pasted snippet: the server finds the entry
 * point, inlines or bundles it, and answers with one self-contained document that goes straight
 * into the iframe. A site, a canvas game, a React app — the screen does not care which; it shows
 * the build result, the errors that stopped it, and the console output of the running project.
 *
 * Pasting a single file is still there, second, for the case of "I have this snippet and want to
 * see it run" without a folder at all.
 */
export const CodePreviewRunner: React.FC<CodePreviewRunnerProps> = ({
  project,
  onSendErrorToCoach,
  onOpenNewProjectModal
}) => {
  const { t, language } = useLanguage();
  const ru = language === 'ru';

  const [mode, setMode] = useState<'project' | 'snippet'>('project');
  const [build, setBuild] = useState<PreviewBuild | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ type: 'log' | 'error' | 'warn'; text: string; time: string }>>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [snippetCode, setSnippetCode] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'desktop' | 'mobile' | 'square'>('desktop');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** True while the keyboard is inside the preview frame (see the effect that watches for it). */
  const [frameHoldsKeyboard, setFrameHoldsKeyboard] = useState(false);

  /** The snippet mode starts from whatever code the project already has, as it always did. */
  const initialSnippet = useMemo(() => {
    const mapFile = project?.projectMap?.files?.find((f) => f.path.endsWith('App.tsx') || f.path.endsWith('main.js'));
    if (mapFile?.content) return mapFile.content;
    const attempt = project?.phases
      ?.flatMap((phase) => phase.tasks)
      .find((task) => task.reviewHistory && task.reviewHistory.length > 0);
    const agentOutput = attempt?.reviewHistory?.[attempt.reviewHistory.length - 1]?.agentOutput || '';
    const block = agentOutput.match(/```(?:html|javascript|js|jsx|tsx|css)?\n([\s\S]*?)```/i);
    return block?.[1] || agentOutput || '';
  }, [project?.id, project?.projectMap?.files?.length]);

  useEffect(() => {
    setSnippetCode((previous) => previous || initialSnippet);
  }, [initialSnippet]);

  const runBuild = async (entry?: string | null) => {
    setIsBuilding(true);
    setBuildMessage(null);
    try {
      const result = await buildPreviewApi({ entry: entry ?? selectedEntry, language });
      setBuild(result);
      if (result.entry) setSelectedEntry(result.entry);
      setPreviewKey((key) => key + 1);
      setLogs([]);
      setRuntimeError(null);
    } catch (error: any) {
      setBuild(null);
      setBuildMessage(
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

  // The screen runs the connected folder, so it builds as soon as there is one — a project in the
  // app is not required for that (see the note in the right column).
  useEffect(() => {
    void runBuild(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, mode]);

  /*
    The one element the browser gives no focus state to.

    Tabbing into the live preview moves focus inside the frame's own document, and in the page around
    it the frame element then matches neither `:focus` nor `:focus-visible` — measured, and the reason
    the screen audit kept naming this one element as having no ring. No CSS rule can draw that ring,
    so it is drawn from here: while the preview holds the keyboard, the frame carries its own outline.

    A click that puts the keyboard into a running game counts as well, and that is deliberate: from
    that moment the keys really do go to the game, and the outline is what says so. `hasFocus()` is
    part of the test because a window that has lost the focus of the whole desktop is a different
    thing from a frame that holds it.
  */
  useEffect(() => {
    /* `window.document` on purpose: inside this component `document` is the preview's own HTML. */
    const holdsKeyboard = () =>
      window.document.activeElement === iframeRef.current && window.document.hasFocus();
    const check = () => setFrameHoldsKeyboard(holdsKeyboard());
    window.addEventListener('blur', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('blur', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  // Console and errors from inside the sandbox.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== 'PREVIEW_CONSOLE_LOG') return;
      setLogs((prev) => [
        { type: event.data.logType, text: event.data.text, time: event.data.time },
        ...prev.slice(0, 49)
      ]);
      if (event.data.logType === 'error') setRuntimeError(event.data.text);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const diagnostics: PreviewDiagnostic[] = build?.diagnostics || [];
  const hasFolder = Boolean(build?.root) && !buildMessage;
  const projectHtml = build?.ok && build.html ? build.html : null;
  // The project is normally served from its own loopback origin: the browser then loads the folder's
  // real files, which is what keeps workers, WebAssembly, media ranges and shared memory working.
  const projectUrl = build?.ok && build.url ? build.url : null;
  const snippetHtml = buildSandboxDocument(snippetCode);
  const document = mode === 'snippet' ? snippetHtml : projectHtml;
  const frameSource = mode === 'snippet' ? document : projectUrl || document;
  const frameReady = Boolean(frameSource);

  const errorTextForCoach = () => {
    if (diagnostics.length > 0) {
      return diagnostics
        .map((d) => `${d.file}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''} — ${d.text}`)
        .join('\n');
    }
    return runtimeError || logs.find((log) => log.type === 'error')?.text || '';
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippetCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const frameSize = () => {
    if (isFullscreen) return 'w-full h-full';
    if (aspectRatio === 'mobile') return 'w-[375px] h-[667px]';
    if (aspectRatio === 'square') return 'w-[640px] h-[640px]';
    return 'w-full h-[520px]';
  };

  /* The ring for a frame that has the keyboard; everywhere else `:focus-visible` in index.css draws
     it. Inset, so it reads against the panel border the frame already has. */
  const frameFocusRing = frameHoldsKeyboard ? 'outline-2 -outline-offset-2 outline-indigo-500' : '';

  /*
    One frame, and it is the running page's own: the device edge. The screen used to draw three of
    them — a shadowed card, a dark mat inside it, and this border — so the preview read as a picture
    of a picture of an app instead of as the app.
  */
  const sandboxFrame = (
    <div className={`${frameSize()} rounded-lg overflow-hidden border border-slate-800 bg-slate-900 flex flex-col`}>
      {frameReady ? (
        projectUrl ? (
          <iframe
            key={previewKey}
            ref={iframeRef}
            title={ru ? 'Живой предпросмотр приложения или игры' : 'App & Game Live Preview'}
            src={projectUrl}
            className={`w-full h-full flex-1 border-0 bg-slate-900 ${frameFocusRing}`}
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-downloads allow-popups"
            // A game needs the same permissions it would have on its own site: fullscreen, sound,
            // gamepads, and shared memory when the project asked for it.
            allow="fullscreen; autoplay; gamepad; clipboard-read; clipboard-write; cross-origin-isolated; accelerometer; gyroscope; microphone; camera"
          />
        ) : (
          <iframe
            key={previewKey}
            ref={iframeRef}
            title={ru ? 'Живой предпросмотр приложения или игры' : 'App & Game Live Preview'}
            srcDoc={document || ''}
            className={`w-full h-full flex-1 border-0 bg-slate-900 ${frameFocusRing}`}
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-downloads allow-popups"
            allow="fullscreen; autoplay; gamepad; clipboard-read; clipboard-write"
          />
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
          {isBuilding ? (
            <>
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              <p className="text-xs text-slate-400">{t.preview.building}</p>
            </>
          ) : (
            <>
              <AlertCircle className="w-6 h-6 text-slate-400" />
              <p className="text-xs text-slate-400">
                {buildMessage || (mode === 'snippet' ? t.preview.snippetHint : t.preview.noFolderHint)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/*
        The toolbar, with no heading above it.

        The screen used to open with an eyebrow, a title and a paragraph, all three naming what the
        sidebar entry and the sandbox below already name — two lines of height over a preview that
        wants the room. What is left is the row of controls that act on that sandbox.
      */}
      <div className="flex flex-col gap-4 short:gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-1 flex items-center gap-1">
            {(
              [
                { id: 'desktop', icon: Tv, label: ru ? 'Десктоп' : 'Desktop' },
                { id: 'mobile', icon: Smartphone, label: ru ? 'Мобильный' : 'Mobile' },
                { id: 'square', icon: Monitor, label: ru ? 'Квадрат' : 'Square' }
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                onClick={() => setAspectRatio(option.id)}
                className={`p-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                  aspectRatio === option.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <option.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{t.preview.fullscreen}</span>
          </button>

          <button
            onClick={() => (mode === 'project' ? void runBuild(selectedEntry) : setPreviewKey((key) => key + 1))}
            disabled={isBuilding || mode === 'snippet'}
            className="bg-indigo-600 enabled:hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-default text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 enabled:cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isBuilding ? 'animate-spin' : ''}`} />
            <span>{mode === 'project' ? t.preview.runCode : ru ? 'Обновить' : 'Update'}</span>
          </button>
        </div>
      </div>

      {isFullscreen ? (
        <div className="fixed inset-0 z-50 bg-slate-950 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <span className="text-xs font-mono text-slate-400 truncate">
              {build?.entry || (ru ? 'живой предпросмотр' : 'live preview')}
            </span>
            <button
              onClick={() => setIsFullscreen(false)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl cursor-pointer flex items-center gap-1.5"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>{ru ? 'Выйти' : 'Exit'}</span>
            </button>
          </div>
          <div className="flex-1 min-h-0 flex justify-center">{sandboxFrame}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: the running project */}
          <div className="lg:col-span-7 space-y-4">
            <div className="space-y-3">
              {/*
                The line above the frame, and the only one: where the sandbox runs, and the few facts
                about how. It used to open with a pulsing status light and the words "Экран песочницы",
                which said what the page already is — this page is the sandbox — and left the picture
                below sitting inside two borders of its own.
              */}
              <div className="w-full flex items-center justify-between gap-3 border-b border-slate-800/70 pb-2 min-w-0">
                <span className="text-[11px] font-mono text-slate-400 truncate">
                  {build?.entry || (ru ? 'предпросмотр' : 'preview')}
                </span>
                <span className="flex items-center gap-3 shrink-0 text-[10px] text-slate-400">
                  {projectUrl && (
                    <span
                      className="font-mono"
                      title={ru ? 'Проект отдаётся по своему адресу — файлы грузит сам браузер' : 'The project is served from its own address — the browser loads the files'}
                    >
                      127.0.0.1:{build?.port}
                    </span>
                  )}
                  {build?.isolation && (
                    <span
                      title={ru ? 'Изоляция origin включена: SharedArrayBuffer и потоки работают' : 'Cross-origin isolation is on: SharedArrayBuffer and threads work'}
                    >
                      isolated
                    </span>
                  )}
                  {build?.liveReload && (
                    <span
                      title={ru ? 'Правка файла в папке сама перезагрузит предпросмотр' : 'Editing a file in the folder reloads the preview by itself'}
                    >
                      {ru ? 'автообновление' : 'auto-reload'}
                    </span>
                  )}
                </span>
              </div>

              <div className="w-full flex justify-center">{sandboxFrame}</div>

              {runtimeError && (
                <div className="w-full bg-rose-500/10 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[10px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>{t.preview.jsErrorTitle}</span>
                    </span>
                    <p className="text-xs text-rose-200 font-mono truncate max-w-md">{runtimeError}</p>
                  </div>
                  {onSendErrorToCoach && (
                    <button
                      onClick={() => onSendErrorToCoach(errorTextForCoach())}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Bug className="w-3.5 h-3.5" />
                      <span>{t.preview.sendToCoach}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/*
              Console: the same shape as the block above it — a hairline header and the content —
              instead of a card inside a column that no longer has cards.
            */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-xs font-bold text-slate-200">
                    {t.preview.consoleTitle} ({logs.length})
                  </h4>
                </div>
                <button
                  onClick={() => {
                    setLogs([]);
                    setRuntimeError(null);
                  }}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  {t.preview.clear}
                </button>
              </div>

              <div className="bg-slate-900/40 rounded-lg p-3 font-mono text-xs text-slate-300 h-32 overflow-y-auto space-y-1">
                {logs.length === 0 ? (
                  <div className="text-slate-400 italic text-[11px]">{t.preview.consoleEmpty}</div>
                ) : (
                  logs.map((log, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-2 border-b border-slate-900 pb-1 ${
                        log.type === 'error'
                          ? 'text-rose-400 font-bold'
                          : log.type === 'warn'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 shrink-0 font-sans">{log.time}</span>
                      <span className="text-[11px] break-all">{log.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: what is being run, and what stopped it */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-slate-400" />
                  {/* "Проект из папки" was this card's title and the name of one of the two buttons in
                      the switch beside it, so the header said it twice before any content appeared. */}
                  <span>{ru ? 'Источник запуска' : 'Run source'}</span>
                </span>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex items-center gap-0.5">
                  {(['project', 'snippet'] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setMode(value)}
                      className={`text-[10px] font-bold px-2 py-1 rounded-md transition-all cursor-pointer ${
                        mode === value ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {value === 'project' ? t.preview.modeProject : t.preview.modeSnippet}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'project' ? (
                <>
                  {!project && (
                    <div className="bg-slate-950/60 rounded-xl p-3 space-y-1">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        {ru ? 'Проект не выбран' : 'No project selected'}
                      </span>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {ru
                          ? 'Подключённая папка запускается и без проекта: выберите точку входа ниже и смотрите результат.'
                          : 'The connected folder runs without a project too: pick an entry point below and watch the result.'}
                      </p>
                      {onOpenNewProjectModal && (
                        <button
                          onClick={onOpenNewProjectModal}
                          className="text-[11px] text-indigo-300 hover:text-indigo-200 font-bold underline cursor-pointer"
                        >
                          {ru ? 'Или создайте проект' : 'Or create a project'}
                        </button>
                      )}
                    </div>
                  )}

                  {!hasFolder && !isBuilding && (
                    <div className="bg-amber-500/10 rounded-xl p-3 space-y-1">
                      <span className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                        <FolderOpen className="w-3.5 h-3.5" />
                        {t.preview.noFolder}
                      </span>
                      <p className="text-[11px] text-amber-100/80 leading-relaxed">{t.preview.noFolderHint}</p>
                    </div>
                  )}

                  {(build?.candidates?.length || 0) > 0 && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 font-medium block">{t.preview.entryLabel}</label>
                      <select
                        value={selectedEntry || ''}
                        onChange={(event) => {
                          setSelectedEntry(event.target.value);
                          void runBuild(event.target.value);
                        }}
                        className="w-full bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200 rounded-lg p-2.5 focus:border-indigo-500 cursor-pointer"
                      >
                        {(build?.candidates || []).map((candidate) => (
                          <option key={candidate.path} value={candidate.path}>
                            {candidate.path} — {candidate.kind === 'static' ? t.preview.kindStatic : t.preview.kindBundle}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 px-1">{t.preview.entryHint}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    {build?.kind && (
                      <span className="bg-slate-800/50 text-slate-300 px-2 py-1 rounded font-semibold flex items-center gap-1">
                        <FileCode className="w-3 h-3 text-indigo-400" />
                        {build.kind === 'static' ? t.preview.kindStatic : t.preview.kindBundle}
                      </span>
                    )}
                    {build?.ok && (
                      <span className="bg-emerald-500/10 text-emerald-300 px-2 py-1 rounded font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        {t.preview.builtIn} {build.durationMs} {ru ? 'мс' : 'ms'}
                      </span>
                    )}
                    {build?.root && (
                      <span className="text-slate-400 font-mono truncate max-w-[260px]" title={build.root}>
                        {build.root}
                      </span>
                    )}
                  </div>

                  {/* "The bundle is 1.4 MB" is a diagnosis; "this dependency is 1.2 MB of it" is the address. */}
                  {build?.composition && build.composition.parts.length > 0 && (
                    <div className="bg-slate-950/60 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {t.preview.compositionTitle}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{formatBytes(build.composition.bytes)}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {build.composition.parts.map((part) => (
                          <li key={`${part.kind}:${part.name}`} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="font-mono text-[10px] text-slate-200 truncate flex-1"
                                title={part.name}
                              >
                                {part.name}
                              </span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                                  part.kind === 'package'
                                    ? 'text-indigo-300 bg-indigo-950/60 border-indigo-800/60'
                                    : 'text-slate-400 bg-slate-900 border-slate-700'
                                }`}
                              >
                                {part.kind === 'package' ? t.preview.compositionPackage : t.preview.compositionFile}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 shrink-0 w-16 text-right">
                                {formatBytes(part.bytes)}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 shrink-0 w-10 text-right">
                                {part.pct}%
                              </span>
                            </div>
                            <div className="h-1 bg-slate-900 rounded overflow-hidden">
                              <div
                                className={part.kind === 'package' ? 'h-full bg-indigo-500' : 'h-full bg-slate-600'}
                                style={{ width: `${Math.max(2, Math.min(100, part.pct))}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                      {build.composition.truncated && (
                        <p className="text-[10px] text-slate-400">{t.preview.compositionTruncated}</p>
                      )}
                      {(build.composition.externals?.length || 0) > 0 && (
                        <p className="text-[10px] text-slate-400">
                          {t.preview.compositionExternals}{' '}
                          <span className="font-mono text-slate-300">{build.composition.externals.join(', ')}</span>
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400">{t.preview.compositionHint}</p>
                    </div>
                  )}

                  {diagnostics.length > 0 && (
                    <div className="bg-rose-500/10 rounded-xl p-3 space-y-2">
                      <span className="text-xs font-bold text-rose-200 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                        {t.preview.buildFailed}
                      </span>
                      <ul className="space-y-1">
                        {diagnostics.slice(0, 8).map((diagnostic, index) => (
                          <li key={index} className="text-[11px] text-rose-100 font-mono break-all">
                            <span className="text-rose-300">
                              {diagnostic.file}
                              {diagnostic.line ? `:${diagnostic.line}` : ''}
                              {diagnostic.column ? `:${diagnostic.column}` : ''}
                            </span>{' '}
                            — {diagnostic.text}
                          </li>
                        ))}
                      </ul>
                      {onSendErrorToCoach && (
                        <button
                          onClick={() => onSendErrorToCoach(errorTextForCoach())}
                          className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs py-2 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Bug className="w-3.5 h-3.5" />
                          <span>{t.preview.explainWithAi}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {(build?.warnings?.length || 0) > 0 && (
                    <div className="bg-slate-950/60 rounded-xl p-3 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {t.preview.warningsTitle}
                      </span>
                      <ul className="space-y-1">
                        {build?.warnings.slice(0, 5).map((warning, index) => (
                          <li key={index} className="text-[11px] text-slate-400 break-all">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400">{t.preview.snippetHint}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300">{t.preview.sourceCode}</span>
                    <button
                      onClick={handleCopy}
                      className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? t.common.copied : t.common.copy}</span>
                    </button>
                  </div>
                  <textarea
                    value={snippetCode}
                    onChange={(event) => {
                      setSnippetCode(event.target.value);
                      setPreviewKey((key) => key + 1);
                    }}
                    rows={14}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-emerald-400 font-mono focus:border-indigo-500 leading-relaxed placeholder:text-slate-700"
                    placeholder={t.preview.emptyCodeNotice}
                  />
                </>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
