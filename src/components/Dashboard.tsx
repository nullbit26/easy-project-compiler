import React from 'react';
import { ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { localizeText } from '../utils/textLocalizer';
import { nextRecommendation } from '../utils/nextAction';
import { ArrowRight, CheckCircle, AlertTriangle, Sparkles, Bug, Layers, Terminal, ShieldCheck, Play, FolderPlus, Gamepad2, Code2, Cpu } from 'lucide-react';

interface DashboardProps {
  project: ProjectState | null;
  setActiveTab: (tab: string) => void;
  onRunQuickTask?: (taskTitle: string) => void;
  /** Opens the review on one plan task, which is what a task waiting for a verdict needs. */
  onReviewTask?: (taskTitle: string) => void;
  onOpenNewProjectModal?: () => void;
}

const cleanPhaseTitle = (rawTitle: string) => {
  if (!rawTitle) return '';
  return rawTitle.replace(/^Phase \d+ - /i, '').replace(/^Phase \d+: /i, '').trim();
};

export const Dashboard: React.FC<DashboardProps> = ({
  project,
  setActiveTab,
  onRunQuickTask,
  onReviewTask,
  onOpenNewProjectModal
}) => {
  const { language, t } = useLanguage();

  // If no project is loaded, render the Empty State Welcome Dashboard
  if (!project) {
    return (
      <div className="space-y-8 short:space-y-4 max-w-6xl mx-auto py-6 short:py-2">
        {/* Welcome Banner */}
        {/* One surface, one accent. The banner used to carry a gradient and two blurred glows. */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 sm:p-10 short:p-5 text-slate-100 text-center space-y-6 short:space-y-3">
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 text-indigo-300 px-3.5 py-1 rounded-full text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.dashboard.welcomeSubtitle}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl short:text-2xl font-extrabold text-white tracking-tight max-w-2xl mx-auto leading-tight">
            {t.dashboard.welcomeTitle}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {t.dashboard.emptySubtitle}
          </p>

          <div className="pt-2">
            <button
              onClick={onOpenNewProjectModal}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-6 py-3.5 rounded-2xl transition-all shadow-xl shadow-indigo-600/30 inline-flex items-center gap-2.5 cursor-pointer transform hover:-translate-y-0.5"
            >
              <Sparkles className="w-5 h-5 text-indigo-200" />
              <span>{t.common.newProject}</span>
            </button>
          </div>
        </div>

        {/* Preset Idea Templates Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-indigo-400" />
                <span>{t.dashboard.presetTemplatesTitle}</span>
              </h2>
              <p className="text-xs text-slate-400">{t.dashboard.presetTemplatesSubtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Template 1 */}
            <div
              onClick={onOpenNewProjectModal}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors cursor-pointer group space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">
                  Phaser.js 3
                </span>
                <span className="text-xs text-slate-400 group-hover:text-amber-400 transition-colors">{language === 'ru' ? 'Выбрать' : 'Select'} ➔</span>
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-amber-300">
                {language === 'ru' ? 'Phaser 2D Игра с физикой' : 'Phaser 2D Browser Beer Arcade'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {language === 'ru'
                  ? '2D игра с физикой открывания напитков, наливанием жидкости без перелива и частицами пены.'
                  : '2D vector physics game about opening drinks, popping caps, pouring liquid without overflowing, and foam particle effects.'}
              </p>
            </div>

            {/* Template 2 */}
            <div
              onClick={onOpenNewProjectModal}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors cursor-pointer group space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">
                  Godot 4.3 GDScript
                </span>
                <span className="text-xs text-slate-400 group-hover:text-cyan-400 transition-colors">{language === 'ru' ? 'Выбрать' : 'Select'} ➔</span>
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-cyan-300">
                {language === 'ru' ? 'Godot 4 2D Экшен-платформер' : 'Godot 4 2D Action Platformer'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {language === 'ru'
                  ? 'Движение CharacterBody2D, скольжение по стенам, коллизии TileMap, патрулирование врагов и интерфейс.'
                  : 'CharacterBody2D movement, wall sliding, TileMap terrain, enemy patrol AI, coin HUD, and GDScript rules.'}
              </p>
            </div>

            {/* Template 3 */}
            <div
              onClick={onOpenNewProjectModal}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors cursor-pointer group space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                  Unity 6 URP
                </span>
                <span className="text-xs text-slate-400 group-hover:text-indigo-400 transition-colors">{language === 'ru' ? 'Выбрать' : 'Select'} ➔</span>
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-indigo-300">
                {language === 'ru' ? 'Unity 3D Игра на выживание' : 'Unity 3D Island Survival'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {language === 'ru'
                  ? '3D механика выживания с PlayerHealth, сбором дерева, постройкой убежища и префабами C#.'
                  : '3D survival mechanics with PlayerHealth, wood gathering, shelter building, and C# prefab references.'}
              </p>
            </div>

            {/* Template 4 */}
            <div
              onClick={onOpenNewProjectModal}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors cursor-pointer group space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                  Three.js 3D
                </span>
                <span className="text-xs text-slate-400 group-hover:text-purple-400 transition-colors">{language === 'ru' ? 'Выбрать' : 'Select'} ➔</span>
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-purple-300">
                {language === 'ru' ? 'Three.js 3D Космический полет' : 'Three.js 3D Space Flight'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {language === 'ru'
                  ? 'WebGL 3D симулятор с управлением кораблем, полями астероидов, лазерами и системами частиц.'
                  : 'WebGL 3D space shooter with ship controls, asteroid fields, laser raycasting, and particle systems.'}
              </p>
            </div>

            {/* Template 5 */}
            <div
              onClick={onOpenNewProjectModal}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors cursor-pointer group space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                  React 19 + Express
                </span>
                <span className="text-xs text-slate-400 group-hover:text-emerald-400 transition-colors">{language === 'ru' ? 'Выбрать' : 'Select'} ➔</span>
              </div>
              <h3 className="font-bold text-base text-white group-hover:text-emerald-300">
                {language === 'ru' ? 'React 19 ИИ-платформа задач' : 'React 19 AI SaaS Platform'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {language === 'ru'
                  ? 'Веб-приложение с интеграцией Gemini API, управлением задачами на канбан-доске и серверными маршрутами.'
                  : 'Full-stack web app with Gemini API integration, Kanban task management, and server-side routes.'}
              </p>
            </div>
          </div>
        </div>

        {/* AI Compiler Features Explanation */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <span>{t.dashboard.featuresTitle}</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950/60 p-4 rounded-xl space-y-2">
              <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> 1. {t.dashboard.feature1Title}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {t.dashboard.feature1Desc}
              </p>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl space-y-2">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> 2. {t.dashboard.feature2Title}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {t.dashboard.feature2Desc}
              </p>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl space-y-2">
              <div className="text-rose-400 font-bold flex items-center gap-1.5">
                <Bug className="w-4 h-4" /> 3. {t.dashboard.feature3Title}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {t.dashboard.feature3Desc}
              </p>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl space-y-2">
              <div className="text-amber-400 font-bold flex items-center gap-1.5">
                <Terminal className="w-4 h-4" /> 4. {t.dashboard.feature4Title}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {t.dashboard.feature4Desc}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active Project Dashboard view
  const allTasks = project.phases.flatMap((p) => p.tasks);
  const completedTasks = allTasks.filter((t) => t.status === 'completed');
  const inProgressTasks = allTasks.filter((t) => t.status === 'in_progress' || t.status === 'partial' || t.status === 'review');
  const blockedTasks = allTasks.filter((t) => t.status === 'blocked');
  
  const totalTasksCount = allTasks.length || 1;
  const overallProgress = Math.round((completedTasks.length / totalTasksCount) * 100);

  /*
   * The recommendation is computed from the plan now, not read from the project.
   *
   * A stored sentence is written once and never revisited, so it survives the work it described: a
   * live run found it telling a beginners' Unity project to add a `test` script to package.json and
   * run `npm test`. When the plan has no tasks there is nothing better to offer, and the stored line
   * is still shown for projects that predate their plan.
   */
  const recommendation = nextRecommendation(project, language === 'ru');
  const recommendationText = localizeText(recommendation.sentence, language);
  const recommendationLabel =
    recommendation.destination === 'review'
      ? t.dashboard.reviewAnswer
      : recommendation.destination === 'plan'
      ? t.dashboard.openPlan
      : t.dashboard.compilePromptNow;

  const runRecommendation = () => {
    if (recommendation.destination === 'review' && recommendation.taskTitle) {
      onReviewTask?.(recommendation.taskTitle);
      return;
    }
    if (recommendation.destination === 'compiler') {
      // A plan-less project recommends in prose: that prose is the task to compile.
      const task = recommendation.taskTitle || recommendationText;
      if (task.trim() && onRunQuickTask) {
        onRunQuickTask(task);
        return;
      }
    }
    setActiveTab('project_plan');
  };

  return (
    <div className="space-y-6">
      {/*
        The project, on one surface.

        This used to be a gradient banner with a blurred indigo glow, a bordered pill above the name
        and a bordered card inside it for the progress: three frames and two glows for one project
        heading. The gradient said nothing the name does not, so it is gone; what is left is one
        panel, the type and the agent as plain small caps, and the numbers in their own quiet box.
      */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-slate-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-wider">
              {/* One framework name: the type and the engine were printed one after another, and with
                  both stored as "Phaser.js" the pill read "PHASER.JS • PHASER.JS 3 (CANVAS)". */}
              <span className="font-semibold text-indigo-300">{project.engineOrFramework || project.projectType}</span>
              {/*
                Only when the project names an agent.

                Projects created before the wizard started storing it have no `selectedAgent`, and
                the label printed "АГЕНТ:" with nothing after it — a beginner reads an empty field as
                a setting that failed to load.
              */}
              {project.selectedAgent && (
                <span className="text-slate-400">
                  {t.common.targetAgent} {project.selectedAgent}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">{project.name}</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {localizeText(project.brief?.tagline, language) || (language === 'ru' ? 'Рабочая область разработки со структурированной компиляцией контекстных промптов.' : 'AI-guided development workspace with context-aware prompt compilation.')}
            </p>
          </div>

          {/* Progress: a number, a bar and the count — no frame of its own. */}
          <div className="bg-slate-950/60 rounded-xl p-4 min-w-[200px] flex flex-col items-center justify-center text-center">
            <div className="text-3xl font-extrabold text-indigo-400">{overallProgress}%</div>
            <p className="text-xs text-slate-400 mt-1 font-medium">{t.dashboard.mvpCompletion}</p>
            <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-2 rounded-full transition-all duration-500"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-400 mt-2">
              {completedTasks.length} {t.dashboard.tasksFinished} {allTasks.length}
            </div>
          </div>
        </div>

        {/* "Next Best Action": one tinted row, not a card inside the card. */}
        <div className="mt-6 pt-5 border-t border-slate-800/80">
          <div className="bg-indigo-500/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-indigo-500/15 text-indigo-300 rounded-lg shrink-0">
                <Sparkles className="w-5 h-5 text-indigo-300" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">{t.dashboard.nextAction}</div>
                <div data-testid="dashboard-recommendation" className="text-sm font-bold text-white mt-0.5">
                  {recommendationText}
                </div>
              </div>
            </div>

            {/*
              The button acts on the sentence above it.

              It used to only switch the tab, which left the compiler's task field holding whatever
              was set the last time it was opened — a task from another screen, unrelated to the
              recommendation the user had just read and pressed. Now the label says where it goes:
              compile the named task, review it, or open the plan when nothing can be compiled.
            */}
            <button
              data-testid="dashboard-recommendation-action"
              onClick={runRecommendation}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <span>{recommendationLabel}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/*
        The four numbers.

        Each card carried a second line under the number ("Приняты без замечаний" under "Завершённые
        задачи: 0") that only repeated the label above it. The number is the point of a metric card;
        the label says what it counts; the colour of the icon says whether it is good or bad.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="truncate">{t.dashboard.metricsCompleted}</span>
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">{completedTasks.length}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="truncate">{t.dashboard.metricsInProgress}</span>
            <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">{inProgressTasks.length}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="truncate">{t.dashboard.metricsBlocked}</span>
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">{blockedTasks.length}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="truncate">{t.dashboard.metricsErrors}</span>
            <Bug className="w-4 h-4 text-rose-400 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-100 tabular-nums">{project.recentErrors?.length || 0}</div>
        </div>
      </div>

      {/* Phase Overview List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span>{t.dashboard.phasesTitle}</span>
          </h3>
          <button
            onClick={() => setActiveTab('project_plan')}
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
          >
            {t.dashboard.viewKanban} ➔
          </button>
        </div>            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {project.phases.map((phase) => {
            const phaseTasks = phase.tasks;
            const phaseCompleted = phaseTasks.filter((t) => t.status === 'completed').length;
            const phasePct = phaseTasks.length > 0 ? Math.round((phaseCompleted / phaseTasks.length) * 100) : 0;

            return (
              <div
                key={phase.id}
                className="bg-slate-950/60 rounded-xl p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] bg-slate-800 text-slate-300 font-bold px-2 py-0.5 rounded">
                      {language === 'ru' ? `Этап ${phase.phaseNumber}` : `Phase ${phase.phaseNumber}`}
                    </span>
                    <span className="text-xs font-bold text-indigo-400">{phasePct}%</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-200">{localizeText(cleanPhaseTitle(phase.title), language)}</h4>
                  <p className="text-xs text-slate-400 line-clamp-2">{localizeText(phase.purpose, language)}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{t.dashboard.deliverable}</span>
                    <strong className="text-slate-300 font-medium truncate max-w-[120px]">{localizeText(phase.deliverable, language)}</strong>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${phasePct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
