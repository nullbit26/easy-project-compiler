import React, { useState } from 'react';
import { ProjectState, ProjectTask, TaskStatus, ProjectPhase } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { localizeText } from '../utils/textLocalizer';
import { Layers, Plus, Sparkles, Rows3, Columns3, Bot } from 'lucide-react';
import { PlanTaskDialogs } from './PlanTaskDialogs';
import { cleanPhaseTitle } from '../utils/planAdapt';

interface PlanKanbanProps {
  project: ProjectState | null;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  onCompileTaskPrompt: (taskTitle: string) => void;
  onAddTask: (phaseId: string, title: string, goal: string) => void;
  onAdaptProjectPhases?: (updatedPhases: ProjectPhase[]) => void;
  onOpenNewProjectModal?: () => void;
  /** Present when the plan screen can also be read as a board. */
  onSwitchToCanvas?: () => void;
}

export const PlanKanban: React.FC<PlanKanbanProps> = ({
  project,
  onUpdateTaskStatus,
  onCompileTaskPrompt,
  onAddTask,
  onAdaptProjectPhases,
  onOpenNewProjectModal,
  onSwitchToCanvas
}) => {
  const { language, t } = useLanguage();
  const [selectedPhaseId, setSelectedPhaseId] = useState('all');
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAdaptModal, setShowAdaptModal] = useState(false);

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{t.common.noProjectSelected}</h3>
        <p className="text-xs text-slate-400">
          {t.common.noProjectSubtext}
        </p>
        {onOpenNewProjectModal && (
          <button
            onClick={onOpenNewProjectModal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t.common.newProject}</span>
          </button>
        )}
      </div>
    );
  }

  const activePhase = project.phases.find((p) => p.id === selectedPhaseId) || project.phases[0];
  const allTasks =
    selectedPhaseId === 'all'
      ? project.phases.flatMap((p) => p.tasks)
      : activePhase?.tasks || [];

  const backlogTasks = allTasks.filter((t) => t.status === 'backlog' || t.status === 'ready');
  const inProgressTasks = allTasks.filter((t) => t.status === 'in_progress' || t.status === 'partial' || t.status === 'review');
  const completedTasks = allTasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-6">
      {/*
        The controls, with no heading above them.

        The board used to open over an eyebrow, a title and a paragraph that all repeated what the
        sidebar and the top bar already say, and they cost the board the height it exists to give
        the plan. This view now opens the same way the canvas does: one row of actions, nothing else.
      */}
      <div className="flex flex-col gap-4 px-1 lg:flex-row lg:items-center lg:justify-between">
        {/* Phase Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {onSwitchToCanvas && (
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                onClick={onSwitchToCanvas}
                className="py-1.5 px-3 rounded-lg text-slate-400 hover:text-slate-200 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Rows3 className="w-3.5 h-3.5" />
                {t.plan.viewCanvas}
              </button>
              <span className="py-1.5 px-3 rounded-lg bg-indigo-600 text-white flex items-center gap-1.5">
                <Columns3 className="w-3.5 h-3.5" />
                {t.plan.viewKanban}
              </span>
            </div>
          )}

          <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">{t.plan.phase}:</span>
            <select
              value={selectedPhaseId}
              onChange={(e) => setSelectedPhaseId(e.target.value)}
              className="bg-transparent text-xs font-bold text-indigo-300 cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-indigo-300 font-bold">
                {t.plan.allPhases} ({project.phases.flatMap((p) => p.tasks).length} {t.plan.tasksCount})
              </option>
              {project.phases.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                  {language === 'ru' ? 'Этап' : 'Phase'} {p.phaseNumber}: {cleanPhaseTitle(p.title)}
                </option>
              ))}
            </select>
          </div>

          {onAdaptProjectPhases && (
            <button
              onClick={() => setShowAdaptModal(true)}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Bot className="w-4 h-4 text-amber-300" />
              <span>{t.plan.adaptPlanButton}</span>
            </button>
          )}

          <button
            onClick={() => setShowAddTaskModal(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.plan.addTaskButton}</span>
          </button>
        </div>
      </div>

      {/* 3 Kanban Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Ready / Backlog */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-300">
                {language === 'ru' ? 'Готово к работе' : 'Ready / Backlog'}
              </h3>
            </div>
            <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold">
              {backlogTasks.length}
            </span>
          </div>

          <div className="space-y-3">
            {backlogTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdateStatus={onUpdateTaskStatus}
                onCompilePrompt={onCompileTaskPrompt}
                language={language}
                compileLabel={t.plan.compilePrompt}
              />
            ))}
          </div>
        </div>

        {/* Column 2: In Progress / Review */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-300">
                {language === 'ru' ? 'В работе / На проверке' : 'In Progress / Review'}
              </h3>
            </div>
            <span className="text-xs bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded font-bold">
              {inProgressTasks.length}
            </span>
          </div>

          <div className="space-y-3">
            {inProgressTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdateStatus={onUpdateTaskStatus}
                onCompilePrompt={onCompileTaskPrompt}
                language={language}
                compileLabel={t.plan.compilePrompt}
              />
            ))}
          </div>
        </div>

        {/* Column 3: Completed */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-emerald-300">
                {language === 'ru' ? 'Завершено' : 'Completed'}
              </h3>
            </div>
            <span className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold">
              {completedTasks.length}
            </span>
          </div>

          <div className="space-y-3">
            {completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdateStatus={onUpdateTaskStatus}
                onCompilePrompt={onCompileTaskPrompt}
                language={language}
                compileLabel={t.plan.compilePrompt}
              />
            ))}
          </div>
        </div>
      </div>

      <PlanTaskDialogs
        project={project}
        targetPhaseId={activePhase?.id ?? null}
        onAddTask={onAddTask}
        onAdaptProjectPhases={onAdaptProjectPhases}
        addTaskOpen={showAddTaskModal}
        onCloseAddTask={() => setShowAddTaskModal(false)}
        adaptOpen={showAdaptModal}
        onCloseAdapt={() => setShowAdaptModal(false)}
        adaptTargetPhaseId={selectedPhaseId !== 'all' ? selectedPhaseId : undefined}
      />

    </div>
  );
};

// Sub-component: TaskCard
const TaskCard: React.FC<{
  task: ProjectTask;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onCompilePrompt: (taskTitle: string) => void;
  language: 'ru' | 'en';
  compileLabel: string;
}> = ({ task, onUpdateStatus, onCompilePrompt, language, compileLabel }) => {
  return (
    <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 space-y-3 transition-all hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-100 leading-snug">{task.title}</h4>
        <span className="text-[9px] bg-slate-900 border border-slate-800 text-slate-400 font-medium px-2 py-0.5 rounded shrink-0">
          {localizeText(task.estimatedComplexity, language)}
        </span>
      </div>

      <p className="text-[11px] text-slate-400 line-clamp-2">{task.goal}</p>

      {/* Acceptance Criteria count */}
      {task.acceptanceCriteria?.length > 0 && (
        <div className="text-[10px] text-slate-400 font-medium">
          ✓ {task.acceptanceCriteria.filter((ac) => ac.passed).length}/{task.acceptanceCriteria.length}{' '}
          {language === 'ru' ? 'критериев выполнено' : 'acceptance criteria passed'}
        </div>
      )}

      {/* Action Footer */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
        {/* Status Dropdown */}
        <select
          value={task.status}
          onChange={(e) => onUpdateStatus(task.id, e.target.value as TaskStatus)}
          className="bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-semibold rounded px-2 py-1 cursor-pointer"
        >
          <option value="ready">{language === 'ru' ? 'Готово к работе' : 'Ready'}</option>
          <option value="in_progress">{language === 'ru' ? 'В работе' : 'In Progress'}</option>
          <option value="review">{language === 'ru' ? 'На проверке' : 'In Review'}</option>
          <option value="completed">{language === 'ru' ? 'Завершено' : 'Completed'}</option>
          <option value="blocked">{language === 'ru' ? 'Заблокировано' : 'Blocked'}</option>
        </select>

        {/* Compile Prompt Action */}
        <button
          onClick={() => onCompilePrompt(task.title)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] px-2.5 py-1 rounded transition-all flex items-center gap-1 cursor-pointer"
        >
          <Sparkles className="w-3 h-3" />
          <span>{compileLabel}</span>
        </button>
      </div>
    </div>
  );
};
