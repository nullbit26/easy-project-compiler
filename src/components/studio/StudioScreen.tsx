import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Columns2,
  Columns3,
  FileCode2,
  FolderTree,
  LayoutGrid,
  Maximize2,
  Minimize2,
  MonitorPlay,
  PanelBottom,
  PanelsTopLeft,
  Plus,
  RotateCcw,
  ShieldCheck,
  Square,
  Terminal,
  X
} from 'lucide-react';
import { ProjectPhase, ProjectState, TaskStatus } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { PlanCanvas } from '../PlanCanvas';
import { PreviewPane } from './PreviewPane';
import { TerminalPane } from './TerminalPane';
import { ChecksPane } from './ChecksPane';
import { FilePane } from './FilePane';
import { EditorPane } from './EditorPane';
import { SplitLayout } from './SplitLayout';
import { IconButton } from '../ui/Button';
import {
  assignPanel,
  insertPane,
  MAX_PANES,
  parseStudioState,
  presetState,
  removePane,
  serializeStudioState,
  slotsOf,
  STUDIO_PANELS,
  STUDIO_PRESETS,
  STUDIO_STORAGE_KEY,
  type StudioPanel,
  type StudioPresetId,
  type StudioState
} from './studioLayout';

interface StudioScreenProps {
  project: ProjectState | null;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus, nextAction?: string) => void;
  onUpdateTaskPositions: (positions: Record<string, { x: number; y: number }>) => void;
  onUpdateTaskTitle?: (taskId: string, title: string) => void;
  /** The files dropped on a card: the studio holds both the card and the file tree. */
  onUpdateTaskFiles?: (taskId: string, files: string[]) => void;
  onUpdateCanvasLanes?: (
    lanes: Record<string, import('../../types').CanvasLaneSkin>,
    positions?: Record<string, { x: number; y: number }>
  ) => void;
  onCompileTaskPrompt: (taskTitle: string) => void;
  onAddTask: (phaseId: string, title: string, goal: string) => void;
  onAdaptProjectPhases?: (phases: ProjectPhase[]) => void;
  onPipelineTaskDone?: (taskId: string, result: 'completed' | 'failed') => void;
  onSendErrorToCoach?: (errorText: string) => void;
  onOpenNewProjectModal?: () => void;
}

const PANEL_META: Record<
  StudioPanel,
  { icon: React.ComponentType<{ className?: string }>; ru: string; en: string }
> = {
  plan: { icon: LayoutGrid, ru: 'План', en: 'Plan' },
  preview: { icon: MonitorPlay, ru: 'Песочница', en: 'Sandbox' },
  terminal: { icon: Terminal, ru: 'Автопилот', en: 'Autopilot' },
  checks: { icon: ShieldCheck, ru: 'Проверки', en: 'Checks' },
  files: { icon: FolderTree, ru: 'Файлы', en: 'Files' },
  editor: { icon: FileCode2, ru: 'Редактор', en: 'Editor' }
};

const PRESET_META: Record<StudioPresetId, { icon: React.ComponentType<{ className?: string }>; ru: string; en: string }> = {
  studio: { icon: Columns3, ru: 'Студия', en: 'Studio' },
  duo: { icon: Columns2, ru: 'Две колонки', en: 'Two columns' },
  quad: { icon: LayoutGrid, ru: 'Сетка 2×2', en: '2×2 grid' },
  focus: { icon: Square, ru: 'Одно окно', en: 'One window' }
};

function readStoredLayout(): StudioState {
  try {
    return parseStudioState(localStorage.getItem(STUDIO_STORAGE_KEY));
  } catch {
    return parseStudioState(null);
  }
}

/**
 * The studio: the plan, the running app, the robot's terminal, the checks, the files and the editor
 * in one window, split the way an IDE is.
 *
 * The screens of this app are pages — each one scrolls and each one is a whole destination. That
 * is the wrong shape for the work itself, which is a loop: change a card, watch the build, read the
 * log, fix the file, run the checks. This window never scrolls and every pane fills the box it was
 * given, so nothing sits in a half-empty screen waiting for a tab switch.
 *
 * The arrangement is the user's: `+` adds an empty window beside the focused one, and the empty
 * window asks what goes in it. Nothing is a tab and no arrangement has to be chosen in advance;
 * a window is closed from its own header. The tree, the panes' contents and the dragged dividers
 * are remembered between sessions.
 */
export const StudioScreen: React.FC<StudioScreenProps> = ({
  project,
  onUpdateTaskStatus,
  onUpdateTaskPositions,
  onUpdateTaskTitle,
  onUpdateTaskFiles,
  onUpdateCanvasLanes,
  onCompileTaskPrompt,
  onAddTask,
  onAdaptProjectPhases,
  onPipelineTaskDone,
  onSendErrorToCoach,
  onOpenNewProjectModal
}) => {
  const { language, t } = useLanguage();
  const ru = language === 'ru';

  const [layout, setLayout] = useState<StudioState>(readStoredLayout);
  // A stored layout may not have slot `a` any more: the ring starts where the first window is.
  const [focusedSlot, setFocusedSlot] = useState(() => slotsOf(layout.tree)[0]);
  const [soloSlot, setSoloSlot] = useState<string | null>(null);
  const [menuSlot, setMenuSlot] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const slots = useMemo(() => slotsOf(layout.tree), [layout.tree]);

  useEffect(() => {
    try {
      localStorage.setItem(STUDIO_STORAGE_KEY, serializeStudioState(layout));
    } catch {
      // A window that refuses storage (private mode) keeps the layout for this session only.
    }
  }, [layout]);

  // The menu is a popover: Escape and a click anywhere else put it away.
  useEffect(() => {
    if (!menuSlot) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuSlot(null);
    };
    /*
     * `pointerdown`, not `click`: a click listener would receive the very click that opened the
     * menu, after it had opened, and close it in the same gesture. The toggle and the menu itself
     * are excluded so choosing an item still reaches its own handler.
     */
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[role="menu"]') || target?.closest('[data-studio-pane-menu]')) return;
      setMenuSlot(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuSlot]);

  // Solo is a temporary zoom, not a layout: Escape returns to the split.
  useEffect(() => {
    if (!soloSlot) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSoloSlot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [soloSlot]);

  /** A preset plants a whole arrangement; adding windows afterwards is the normal way to grow it. */
  const applyPreset = (preset: StudioPresetId) => {
    const next = presetState(preset);
    setLayout(next);
    setSoloSlot(null);
    setFocusedSlot(slotsOf(next.tree)[0]);
    setMenuSlot(null);
  };

  const resetLayout = () => applyPreset('studio');

  /** A new empty window beside the focused one — the window it pushes aside stays where it was. */
  const addPane = (direction: 'row' | 'col') => {
    if (slots.length >= MAX_PANES) return;
    const next = insertPane(layout, focusedSlot, direction);
    if (next === layout) return;
    const added = slotsOf(next.tree).find((slot) => !(slot in layout.panels));
    setLayout(next);
    if (added) setFocusedSlot(added);
    setMenuSlot(null);
  };

  const closePane = (slot: string) => {
    const next = removePane(layout, slot);
    if (next === layout) return;
    setLayout(next);
    setMenuSlot(null);
    if (soloSlot === slot) setSoloSlot(null);
    if (focusedSlot === slot) setFocusedSlot(slotsOf(next.tree)[0]);
  };

  const setPanel = (slot: string, panel: StudioPanel) => {
    setLayout((current) => ({ ...current, panels: assignPanel(current.panels, slot, panel) }));
    setMenuSlot(null);
  };

  const pickFile = useCallback(
    (path: string) => {
      setOpenFile(path);
      setLayout((current) => {
        if (Object.values(current.panels).includes('editor')) return current;
        const order = slotsOf(current.tree);
        // An empty window is the obvious place for the editor; otherwise it opens beside the files.
        const emptySlot = order.find((slot) => current.panels[slot] === 'empty');
        if (emptySlot) {
          return { ...current, panels: { ...current.panels, [emptySlot]: 'editor' } };
        }
        const filesSlot = order.find((slot) => current.panels[slot] === 'files');
        return insertPane(current, filesSlot || focusedSlot, 'row', 'editor');
      });
    },
    [focusedSlot]
  );

  /** The empty window's whole body: one choice, no captions. */
  const renderPicker = (slot: string) => (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-2">
      {/* Wraps instead of overflowing: a window added to a narrow pane is still a chooser. */}
      <div className="flex max-w-[220px] flex-wrap justify-center gap-1">
        {STUDIO_PANELS.map((option) => {
          const meta = PANEL_META[option];
          const OptionIcon = meta.icon;
          const label = ru ? meta.ru : meta.en;
          return (
            <button
              key={option}
              type="button"
              data-testid={`studio-panel-pick-${option}`}
              title={label}
              aria-label={label}
              onClick={() => setPanel(slot, option)}
              className="flex h-14 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-slate-800 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
            >
              <OptionIcon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const contentFor = (slot: string): React.ReactNode => {
    const panel = layout.panels[slot];
    switch (panel) {
      case 'preview':
        return <PreviewPane project={project} onSendErrorToCoach={onSendErrorToCoach} />;
      case 'terminal':
        return <TerminalPane />;
      case 'checks':
        return <ChecksPane />;
      case 'files':
        return <FilePane activePath={openFile} onOpenFile={pickFile} />;
      case 'editor':
        return <EditorPane path={openFile} />;
      case 'empty':
        return renderPicker(slot);
      case 'plan':
      default:
        return (
          <div className="flex h-full min-h-0 flex-col">
            <PlanCanvas
              project={project}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onUpdateTaskPositions={onUpdateTaskPositions}
              onUpdateTaskTitle={onUpdateTaskTitle}
              onUpdateTaskFiles={onUpdateTaskFiles}
              onUpdateCanvasLanes={onUpdateCanvasLanes}
              onCompileTaskPrompt={onCompileTaskPrompt}
              onAddTask={onAddTask}
              onAdaptProjectPhases={onAdaptProjectPhases}
              onOpenNewProjectModal={onOpenNewProjectModal}
              onPipelineTaskDone={onPipelineTaskDone}
              dockedPlate={Object.values(layout.panels).includes('terminal')}
              fitToPane
            />
          </div>
        );
    }
  };

  const renderPane = (slot: string) => {
    const panel = layout.panels[slot];
    const empty = panel === 'empty';
    const meta = empty ? null : PANEL_META[panel];
    const Icon = meta?.icon;
    const solo = soloSlot === slot;
    return (
      <div
        data-testid={`studio-pane-${slot}`}
        data-panel={panel}
        onPointerDownCapture={() => setFocusedSlot(slot)}
        className={`flex h-full min-h-0 w-full flex-col bg-slate-950 ${
          focusedSlot === slot ? 'ring-1 ring-inset ring-slate-700/60' : ''
        }`}
      >
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-800/80 bg-slate-900/60 pl-2 pr-1">
          {Icon && meta && (
            <>
              <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                {ru ? meta.ru : meta.en}
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {!empty && (
              <div className="relative" data-studio-pane-menu>
                <IconButton
                  label={ru ? 'Сменить окно' : 'Change the window'}
                  icon={PanelsTopLeft}
                  size="xs"
                  pressed={menuSlot === slot}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuSlot((current) => (current === slot ? null : slot));
                  }}
                />
                {menuSlot === slot && (
                  <div
                    role="menu"
                    className="absolute right-0 top-8 z-40 w-40 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl shadow-black/60"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {STUDIO_PANELS.map((option) => {
                      const optionMeta = PANEL_META[option];
                      const OptionIcon = optionMeta.icon;
                      const active = panel === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          title={ru ? optionMeta.ru : optionMeta.en}
                          onClick={() => setPanel(slot, option)}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                            active
                              ? 'bg-slate-800 text-slate-100'
                              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                          }`}
                        >
                          <OptionIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1">{ru ? optionMeta.ru : optionMeta.en}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!empty && (
              <IconButton
                label={solo ? (ru ? 'Вернуть раскладку' : 'Restore the layout') : ru ? 'Развернуть окно' : 'Maximise the window'}
                icon={solo ? Minimize2 : Maximize2}
                size="xs"
                onClick={() => setSoloSlot(solo ? null : slot)}
              />
            )}
            {slots.length > 1 && (
              <IconButton
                label={ru ? 'Закрыть окно' : 'Close the window'}
                icon={X}
                size="xs"
                onClick={() => closePane(slot)}
              />
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1">{contentFor(slot)}</div>
      </div>
    );
  };

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-indigo-800 bg-indigo-950 text-indigo-300">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">
            {ru ? 'Студия ждёт проект' : 'The studio needs a project'}
          </h3>
          <p className="text-xs leading-relaxed text-slate-400">
            {ru
              ? 'Создайте проект — и здесь рядом откроются план, живой предпросмотр, терминал автопилота и файлы.'
              : 'Create a project and the plan, live preview, autopilot terminal and files open side by side here.'}
          </p>
          {onOpenNewProjectModal && (
            <button
              type="button"
              onClick={onOpenNewProjectModal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(2_6_23/0.55)] px-3 text-xs font-medium text-white hover:bg-indigo-500"
            >
              {t.common.newProject}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          label={ru ? 'Новое окно справа' : 'New window to the right'}
          icon={Plus}
          size="sm"
          onClick={() => addPane('row')}
          disabled={slots.length >= MAX_PANES}
        />
        <IconButton
          label={ru ? 'Новое окно снизу' : 'New window below'}
          icon={PanelBottom}
          size="sm"
          onClick={() => addPane('col')}
          disabled={slots.length >= MAX_PANES}
        />
        <span className="mx-1 h-5 w-px bg-slate-800" />
        {/* `studio` is what the reset button restores, so it is not a second button beside it. */}
        {STUDIO_PRESETS.filter((preset) => preset !== 'studio').map((preset) => (
          <IconButton
            key={preset}
            label={ru ? PRESET_META[preset].ru : PRESET_META[preset].en}
            icon={PRESET_META[preset].icon}
            size="sm"
            onClick={() => applyPreset(preset)}
          />
        ))}
        <IconButton
          label={ru ? 'Сбросить раскладку' : 'Reset the layout'}
          icon={RotateCcw}
          size="sm"
          onClick={resetLayout}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {soloSlot ? (
          <div className="absolute inset-0 flex min-h-0 flex-col">{renderPane(soloSlot)}</div>
        ) : (
          <SplitLayout
            node={layout.tree}
            ratios={layout.ratios}
            onResize={(splitId, sizes) =>
              setLayout((current) => ({ ...current, ratios: { ...current.ratios, [splitId]: sizes } }))
            }
            renderPane={renderPane}
          />
        )}
      </div>
    </div>
  );
};
