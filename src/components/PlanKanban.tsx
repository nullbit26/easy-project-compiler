import React, { useState } from 'react';
import { ProjectState, ProjectTask, TaskStatus, ProjectPhase } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { localizeText } from '../utils/textLocalizer';
import { Layers, Plus, Sparkles, Rows3, Columns3, Bot } from 'lucide-react';
import { PlanTaskDialogs } from './PlanTaskDialogs';
import { TaskStatusMenu } from './TaskStatusMenu';
import { cleanPhaseTitle } from '../utils/planAdapt';
import { Button, IconButton } from './ui/Button';

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
          <Button variant="primary" size="md" icon={Sparkles} onClick={onOpenNewProjectModal}>
            {t.common.newProject}
          </Button>
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
      {/*
       * The same row as the board's: icon-only, unbordered, the words in the tooltip.
       *
       * Reading a plan as columns is not a different screen with different controls — switching views
       * used to change the size, the borders and the accent colour of the very same actions, which is
       * what made the two halves of one screen look like two products.
       */}
      <div className="flex flex-wrap items-center gap-1">
        {onSwitchToCanvas && (
          <div className="mr-1 flex items-center gap-0.5">
            <IconButton label={t.plan.viewCanvas} icon={Rows3} onClick={onSwitchToCanvas} />
            <span
              title={t.plan.viewKanban}
              aria-label={t.plan.viewKanban}
              data-active-view="kanban"
              className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-100 ring-1 ring-inset ring-slate-700"
            >
              <Columns3 className="h-4 w-4" />
            </span>
          </div>
        )}

        <select
          value={selectedPhaseId}
          onChange={(e) => setSelectedPhaseId(e.target.value)}
          aria-label={t.plan.phase}
          title={t.plan.phase}
          className="h-8 max-w-[11rem] cursor-pointer rounded-lg bg-transparent px-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:bg-slate-800"
        >
          <option value="all" className="bg-slate-900 text-slate-200">
            {t.plan.allPhases} · {project.phases.flatMap((p) => p.tasks).length}
          </option>
          {project.phases.map((p) => (
            <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
              {language === 'ru' ? 'Этап' : 'Phase'} {p.phaseNumber}: {cleanPhaseTitle(p.title)}
            </option>
          ))}
        </select>

        {onAdaptProjectPhases && (
          <IconButton
            label={t.plan.adaptPlanButton}
            icon={Bot}
            variant="primary"
            className="ml-1"
            onClick={() => setShowAdaptModal(true)}
          />
        )}

        <IconButton label={t.plan.addTaskButton} icon={Plus} onClick={() => setShowAddTaskModal(true)} />
      </div>

      {/* 3 Kanban Columns */}
      <div className="grid grid-cols-1 @2xl:grid-cols-3 gap-6">
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
                compileShortLabel={t.plan.compileShort}
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
                compileShortLabel={t.plan.compileShort}
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
                compileShortLabel={t.plan.compileShort}
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
  /** The short word on the button itself; `compileLabel` is its tooltip. */
  compileShortLabel: string;
}> = ({ task, onUpdateStatus, onCompilePrompt, language, compileLabel, compileShortLabel }) => {
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
        {/* The same status menu and the same button as the board: one card, two layouts. */}
        <TaskStatusMenu status={task.status} onChange={(next) => onUpdateStatus(task.id, next)} />

        <button
          onClick={() => onCompilePrompt(task.title)}
          title={compileLabel}
          aria-label={compileLabel}
          className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-slate-100 px-2 text-[10px] font-medium text-slate-900 shadow-[0_1px_2px_rgb(2_6_23/0.45)] transition-colors hover:bg-white"
        >
          <Sparkles className="h-3 w-3" />
          <span>{compileShortLabel}</span>
        </button>
      </div>
    </div>
  );
};
