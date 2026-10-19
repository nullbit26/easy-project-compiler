import React from 'react';
import {
  BookOpen,
  Bug,
  CheckCircle2,
  Code2,
  HardDrive,
  Layers,
  Play,
  Sparkles,
  Terminal,
  Wand2,
  X
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { IconButton } from '../ui/Button';
import { SCREEN_PATHS, type ScreenPath } from './workspaceLayout';

interface ScreenMeta {
  icon: React.ComponentType<{ className?: string }>;
  ru: string;
  en: string;
}

/** The screens that can stand beside the current one, named the way the sidebar names them. */
export const SCREEN_META: Record<ScreenPath, ScreenMeta> = {
  '/': { icon: Layers, ru: 'Обзор проекта', en: 'Project Overview' },
  '/simple': { icon: Wand2, ru: 'Помощник', en: 'Helper' },
  '/compiler': { icon: Sparkles, ru: 'Компилятор', en: 'Compiler' },
  '/review': { icon: CheckCircle2, ru: 'Проверка', en: 'Review' },
  '/preview': { icon: Play, ru: 'Песочница', en: 'Sandbox' },
  '/coach': { icon: Bug, ru: 'Тренер ошибок', en: 'Error Coach' },
  '/plan': { icon: Code2, ru: 'План', en: 'Plan' },
  '/map': { icon: Terminal, ru: 'Карта проекта', en: 'Project Map' },
  '/files': { icon: HardDrive, ru: 'Файлы', en: 'Files' },
  '/brief': { icon: BookOpen, ru: 'Бриф', en: 'Brief' }
};

interface WorkspacePaneProps {
  /** The screen in this pane, or `null` for a window that still asks what goes in it. */
  path: ScreenPath | null;
  /** Screens already open somewhere in the row — a live screen exists once, so they are not offered. */
  taken: ScreenPath[];
  onPick: (path: ScreenPath) => void;
  /** Back to the chooser, for a pane that should show something else. */
  onClear: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}

/**
 * One column beside the current screen.
 *
 * It is the studio's pane with the app's screens in it: a name, a close button, and — when nothing
 * has been chosen yet — the choice itself as the whole body of the window, one icon and one word
 * per screen. No caption explains the column; the plus that made it did.
 */
export const WorkspacePane: React.FC<WorkspacePaneProps> = ({
  path,
  taken,
  onPick,
  onClear,
  onClose,
  children
}) => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const meta = path ? SCREEN_META[path] : null;
  const Icon = meta?.icon;
  const label = meta ? (ru ? meta.ru : meta.en) : '';
  const options = SCREEN_PATHS.filter((option) => !taken.includes(option));

  return (
    <div
      data-testid="workspace-pane"
      data-screen={path ?? 'empty'}
      className="flex h-full min-h-0 w-full flex-col bg-slate-950"
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-800/80 bg-slate-900/60 pl-2 pr-1">
        {meta && Icon && (
          <button
            type="button"
            data-testid="workspace-pane-change"
            onClick={onClear}
            title={ru ? 'Сменить экран' : 'Change the screen'}
            aria-label={`${ru ? 'Сменить экран' : 'Change the screen'}: ${label}`}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-left hover:text-slate-100"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
              {label}
            </span>
          </button>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label={ru ? 'Закрыть окно' : 'Close the window'}
            icon={X}
            size="xs"
            onClick={onClose}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {path ? (
          <div
            className={
              path === '/plan' || path === '/preview'
                ? '@container flex h-full min-h-0 flex-col p-2'
                : '@container w-full p-3'
            }
          >
            {children}
          </div>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center p-2">
            <div className="flex max-w-[240px] flex-wrap justify-center gap-1">
              {options.map((option) => {
                const optionMeta = SCREEN_META[option];
                const OptionIcon = optionMeta.icon;
                const optionLabel = ru ? optionMeta.ru : optionMeta.en;
                return (
                  <button
                    key={option}
                    type="button"
                    data-testid={`workspace-pick-${option.replace('/', '') || 'dashboard'}`}
                    title={optionLabel}
                    aria-label={optionLabel}
                    onClick={() => onPick(option)}
                    className="flex h-14 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-slate-800 transition-colors hover:bg-slate-800/60 hover:text-slate-100"
                  >
                    <OptionIcon className="h-4 w-4" />
                    {optionLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
