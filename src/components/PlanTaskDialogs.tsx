import React, { useEffect, useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';

import { ProjectState, ProjectPhase } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { adaptProjectPlanApi } from '../services/api';
import { mapAdaptedPlanToPhases } from '../utils/planAdapt';

/**
 * The two dialogs a plan screen always needs: adding a task and asking the AI to re-align the
 * plan. They used to live inside the Kanban view; the board needs exactly the same dialogs, so
 * they live here now and both views render this one copy.
 */

export interface PlanTaskDialogsProps {
  project: ProjectState;
  /** The phase a new task lands in. Null means there is no phase to put it in yet. */
  targetPhaseId: string | null;
  onAddTask: (phaseId: string, title: string, goal: string) => void;
  /** Present only when the plan can be re-aligned at all. */
  onAdaptProjectPhases?: (updatedPhases: ProjectPhase[]) => void;
  addTaskOpen: boolean;
  onCloseAddTask: () => void;
  adaptOpen: boolean;
  onCloseAdapt: () => void;
  /** Which phase the AI should focus on; undefined means the whole plan. */
  adaptTargetPhaseId?: string;
}

export const PlanTaskDialogs: React.FC<PlanTaskDialogsProps> = ({
  project,
  targetPhaseId,
  onAddTask,
  onAdaptProjectPhases,
  addTaskOpen,
  onCloseAddTask,
  adaptOpen,
  onCloseAdapt,
  adaptTargetPhaseId
}) => {
  const { language, t } = useLanguage();

  /*
   * Escape closes whichever of the two dialogs is open.
   *
   * Both are opened from the plan's toolbar by a click, so a listener on the dialog itself would
   * never fire — the focus stays on the button that opened it.
   */
  useEffect(() => {
    if (!addTaskOpen && !adaptOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (adaptOpen) onCloseAdapt();
      else onCloseAddTask();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addTaskOpen, adaptOpen, onCloseAdapt, onCloseAddTask]);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskGoal, setNewTaskGoal] = useState('');
  const [adaptGoalText, setAdaptGoalText] = useState('');
  const [isAdapting, setIsAdapting] = useState(false);
  const [adaptErrorMsg, setAdaptErrorMsg] = useState('');

  const handleCreateTask = () => {
    if (!newTaskTitle.trim() || !targetPhaseId) return;
    onAddTask(targetPhaseId, newTaskTitle, newTaskGoal || newTaskTitle);
    setNewTaskTitle('');
    setNewTaskGoal('');
    onCloseAddTask();
  };

  const handleRunAiAdapt = async () => {
    if (!onAdaptProjectPhases) return;
    setIsAdapting(true);
    setAdaptErrorMsg('');
    try {
      const data = await adaptProjectPlanApi({
        project,
        userGoal: adaptGoalText,
        targetPhaseId: adaptTargetPhaseId,
        language
      });

      const updatedPhases = mapAdaptedPlanToPhases(data);
      if (updatedPhases.length === 0) {
        // Saying nothing here would leave the button looking stuck, so the dialog says what it got.
        setAdaptErrorMsg(
          language === 'ru'
            ? 'ИИ не вернул ни одного этапа. Опишите требование конкретнее и попробуйте снова.'
            : 'The AI returned no phases. Describe the requirement in more detail and try again.'
        );
        return;
      }
      onAdaptProjectPhases(updatedPhases);
      setAdaptGoalText('');
      onCloseAdapt();
    } catch (err: any) {
      console.error('Failed to adapt project plan:', err);
      setAdaptErrorMsg(err?.userMessage || err?.message || 'Failed to adapt tasks with AI.');
    } finally {
      setIsAdapting(false);
    }
  };

  return (
    <>
      {addTaskOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-slate-100 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white">{t.plan.addTaskModalTitle}</h3>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">{t.plan.taskTitleLabel}</label>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={language === 'ru' ? 'Например: Реализовать сохранение игры' : 'e.g. Implement save/load system'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">{t.plan.taskGoalLabel}</label>
              <textarea
                value={newTaskGoal}
                onChange={(e) => setNewTaskGoal(e.target.value)}
                placeholder={language === 'ru' ? 'Краткая цель задачи...' : 'Brief goal of task...'}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={onCloseAddTask}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs py-2 rounded-lg cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleCreateTask}
                className="w-1/2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2 rounded-lg cursor-pointer"
              >
                {t.plan.createTaskButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {adaptOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="adapt-dialog-title"
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 text-slate-100 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="adapt-dialog-title" className="text-base font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <span>{t.plan.adaptModalTitle}</span>
              </h3>
              {/* A bare ✕ is a button with no name: it reads as "button" and nothing else. */}
              <button
                onClick={onCloseAdapt}
                aria-label={t.common.close}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              {language === 'ru'
                ? 'Опишите фичу или требование (или оставьте пустым для автоматического анализа текущего состояния):'
                : 'Tell the AI what feature or change you want to make next (or leave blank for automatic analysis):'}
            </p>

            {adaptErrorMsg && (
              <div className="bg-rose-950/40 border border-rose-850 rounded-lg p-3 text-xs text-rose-200">
                <strong>{t.common.error}:</strong> {adaptErrorMsg}
              </div>
            )}

            <textarea
              value={adaptGoalText}
              onChange={(e) => setAdaptGoalText(e.target.value)}
              placeholder={t.plan.adaptModalPlaceholder}
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-indigo-200 focus:border-indigo-500 font-medium"
            />

            <div className="flex gap-2 pt-2">
              <button
                onClick={onCloseAdapt}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs py-2.5 rounded-xl cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleRunAiAdapt}
                disabled={isAdapting}
                className="w-1/2 bg-gradient-to-r from-indigo-600 to-purple-600 enabled:hover:from-indigo-500 enabled:hover:to-purple-500 text-white font-bold text-xs py-2.5 rounded-xl enabled:cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isAdapting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.common.running}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>{t.plan.adaptSubmitButton}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
