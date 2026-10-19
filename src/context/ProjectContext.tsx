import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  ProjectState,
  AgentType,
  AutonomyLevel,
  InterfaceMode,
  TaskStatus,
  ReviewAttempt,
  ProjectFile,
  ProjectMap,
  ProjectTask,
  CanvasLaneSkin,
  FileInsights
} from '../types';
import { generateCustomRulesFiles } from '../utils/rulesGenerator';
import { withAutonomy, withInterfaceMode } from '../utils/workingMode';
import { RulesCheckStamp } from '../utils/rulesCheckStamp';
import { mergeTaskFiles } from '../utils/taskFiles';
import { useLanguage } from './LanguageContext';

interface ProjectContextType {
  allProjects: ProjectState[];
  currentProject: ProjectState | null;
  toastMessage: string | null;
  compilerTaskTitle: string;
  reviewOutputText: string;
  coachErrorText: string;
  /**
   * The task the pasted answer was compiled for, carried from the compiler to the review. The
   * review judges against a task's acceptance criteria, and the compiler's own field is free text —
   * this is what keeps the verdict about the work that was actually asked for.
   */
  reviewTaskHint: { title: string; acceptanceCriteria: string[] };
  setCompilerTaskTitle: React.Dispatch<React.SetStateAction<string>>;
  setReviewOutputText: React.Dispatch<React.SetStateAction<string>>;
  setCoachErrorText: React.Dispatch<React.SetStateAction<string>>;
  setReviewTaskHint: React.Dispatch<React.SetStateAction<{ title: string; acceptanceCriteria: string[] }>>;
  showToast: (msg: string) => void;
  clearToast: () => void;
  onSelectProject: (proj: ProjectState) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectAgent: (agent: AgentType) => void;
  /** Switches the interface part only: the autonomy part keeps whatever it had. */
  onSelectInterfaceMode: (mode: InterfaceMode) => void;
  /** Switches the autonomy part only: the interface part keeps whatever it had. */
  onSelectAutonomy: (level: AutonomyLevel) => void;
  onAddProject: (newProject: ProjectState) => void;
  onUpdateProjectFiles: (updatedFiles: Array<{ path: string; content: string }>) => void;
  onSyncProjectFiles: (files: ProjectFile[], root: string | null) => void;
  /** Keeps the AI reading of the files on the project, so it survives a reload. */
  onApplyFileInsights: (insights: FileInsights) => void;
  /**
   * Stores corrected agent rules on the project. The rules checker drops lines that point at files
   * the folder no longer has; without this the correction would live only until the next reload.
   */
  onUpdateRulesContent: (content: ProjectState['rulesFilesContent']) => void;
  /**
   * Keeps the moment the rules were last compared with the folder, so the date survives a reload and
   * shows up on every screen that reports on the rules — not only the one that ran the check.
   */
  onRecordRulesCheck: (stamp: RulesCheckStamp) => void;
  onUpdateTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    nextAction?: string,
    reviewHistory?: ReviewAttempt[],
    progressPercent?: number
  ) => void;
  onAddTask: (phaseId: string, title: string, goal: string) => void;
  /**
   * Puts a task the user worked on — one the compiler named, which the plan never had — into the
   * plan together with its verdict, and returns the id the task got.
   */
  onAdoptTask: (input: AdoptTaskInput) => string | null;
  onAdaptProjectPhases: (updatedPhases: any[]) => void;
  /** Keeps the board's arrangement, so a reload does not scatter a plan the user has placed. */
  onUpdateTaskPositions: (positions: Record<string, { x: number; y: number }>) => void;
  /** Renaming a task on the board: the plan's own words for what the work is. */
  onUpdateTaskTitle: (taskId: string, title: string) => void;
  /**
   * The files a card is told to work on — dropped from the file tree onto the card. The whole list
   * is written, because removing a file is the same gesture as adding one and both end here.
   */
  onUpdateTaskFiles: (taskId: string, files: string[]) => void;
  /**
   * The board's lanes as the user arranged them — name, colour, and how far each was dragged. Kept on
   * the project for the same reason card positions are: the arrangement belongs to the plan.
   *
   * `positions` travels with them because moving a zone and moving the cards lying on it is one
   * gesture, and it has to land in the project as one write. Sent as two calls, each would rebuild
   * the project from the snapshot it read when the drag began, and the second would throw the first
   * away — the zone would be stored and the cards it carried would not.
   */
  onUpdateCanvasLanes: (
    lanes: Record<string, CanvasLaneSkin>,
    positions?: Record<string, { x: number; y: number }>
  ) => void;
}

/**
 * A task the review judged that the plan does not know about yet.
 *
 * The compiler's task field is free text, so the review can be pointed at a task of the user's own.
 * Its verdict has nowhere to live until the task is in the plan, which is what this describes: the
 * compiler's criteria, the attempt history, and the status the user just chose.
 */
export interface AdoptTaskInput {
  title: string;
  goal?: string;
  relevantFiles?: string[];
  /** Criteria descriptions, in the order the compiled prompt listed them. */
  acceptanceCriteria?: string[];
  reviewHistory?: ReviewAttempt[];
  status?: TaskStatus;
  progressPercent?: number;
  nextBestAction?: string;
  /** The phase to put it in. The last phase is used when this names nothing. */
  phaseId?: string;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY_PROJECTS = 'easy_project_compiler_projects';
const LOCAL_STORAGE_KEY_CURRENT = 'easy_project_compiler_current_project';

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useLanguage();

  const [allProjects, setAllProjects] = useState<ProjectState[]>(() => {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY_PROJECTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse easy_project_compiler_projects from localStorage', e);
    }
    return [];
  });

  const [currentProject, setCurrentProject] = useState<ProjectState | null>(() => {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY_CURRENT);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && parsed.id) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse easy_project_compiler_current_project from localStorage', e);
    }
    return null;
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [compilerTaskTitle, setCompilerTaskTitle] = useState('');
  const [reviewOutputText, setReviewOutputText] = useState('');
  const [coachErrorText, setCoachErrorText] = useState('');
  const [reviewTaskHint, setReviewTaskHint] = useState<{ title: string; acceptanceCriteria: string[] }>({
    title: '',
    acceptanceCriteria: []
  });

  // Sync projects and current project to localStorage on any state change
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_PROJECTS, JSON.stringify(allProjects));
    } catch (e) {
      console.error('Failed to persist allProjects to localStorage', e);
    }
  }, [allProjects]);

  useEffect(() => {
    try {
      if (currentProject) {
        localStorage.setItem(LOCAL_STORAGE_KEY_CURRENT, JSON.stringify(currentProject));
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY_CURRENT);
      }
    } catch (e) {
      console.error('Failed to persist currentProject to localStorage', e);
    }
  }, [currentProject]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const clearToast = () => setToastMessage(null);

  const onSelectProject = (proj: ProjectState) => {
    setCurrentProject(proj);
  };

  const onDeleteProject = (projectId: string) => {
    const updated = allProjects.filter((p) => p.id !== projectId);
    setAllProjects(updated);
    if (currentProject?.id === projectId) {
      setCurrentProject(updated.length > 0 ? updated[0] : null);
    }
    showToast(language === 'ru' ? 'Проект удалён из списка сохранённых.' : 'Project deleted from saved projects list.');
  };

  const onSelectAgent = (agent: AgentType) => {
    if (!currentProject) return;
    const updatedRules = generateCustomRulesFiles({
      projectName: currentProject.name,
      projectType: currentProject.projectType,
      engineOrFramework: currentProject.engineOrFramework,
      language: currentProject.language,
      selectedAgent: agent,
      uiLanguage: language
    });
    const updated = {
      ...currentProject,
      selectedAgent: agent,
      rulesFilesContent: updatedRules
    };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    showToast(language === 'ru' ? `Целевой ИИ-агент: ${agent}` : `Target AI Coding Agent set to: ${agent}`);
  };

  const onSelectInterfaceMode = (mode: InterfaceMode) => {
    if (!currentProject) return;
    const updated = withInterfaceMode(currentProject, mode);
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    showToast(
      language === 'ru'
        ? mode === 'guided'
          ? 'Интерфейс обновлён: пошаговый помощник.'
          : 'Интерфейс обновлён: полный экран.'
        : mode === 'guided'
        ? 'Interface updated: step-by-step helper.'
        : 'Interface updated: full workspace.'
    );
  };

  const onSelectAutonomy = (level: AutonomyLevel) => {
    if (!currentProject) return;
    const updated = withAutonomy(currentProject, level);
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    showToast(language === 'ru' ? `Автономия обновлена: ${level}` : `Autonomy updated: ${level}`);
  };

  const onAddProject = (newProject: ProjectState) => {
    setAllProjects((prev) => [newProject, ...prev]);
    setCurrentProject(newProject);
    showToast(
      language === 'ru'
        ? `Проект «${newProject.name}» создан и сохранён!`
        : `Project "${newProject.name}" created and saved!`
    );
  };

  /**
   * The project's map, or one built from the project's own identity.
   *
   * Not every project carries a map: the ones that come from the canvas demo hold a plan and a
   * folder and nothing else. The folder is still the truth about its files, so the first write that
   * needs a map creates one instead of throwing on the missing one.
   */
  const projectMapOf = (project: ProjectState): ProjectMap =>
    project.projectMap || {
      projectName: project.name,
      projectType: project.projectType,
      engineOrFramework: project.engineOrFramework,
      language: project.language,
      rulesFiles: [],
      files: []
    };

  const onUpdateProjectFiles = (updatedFiles: Array<{ path: string; content: string }>) => {
    if (!currentProject) return;

    const map = projectMapOf(currentProject);
    const existingFiles = [...(map.files || [])];

    updatedFiles.forEach((uf) => {
      const existingIdx = existingFiles.findIndex((f) => f.path === uf.path || f.path.endsWith(uf.path));
      if (existingIdx >= 0) {
        existingFiles[existingIdx] = {
          ...existingFiles[existingIdx],
          content: uf.content,
          contentSnippet: uf.content.slice(0, 300) + '...',
          sizeBytes: uf.content.length
        };
      } else {
        existingFiles.push({
          path: uf.path,
          type: uf.path.endsWith('.json') ? 'json' : 'code',
          description: 'Extracted from agent session output',
          content: uf.content,
          contentSnippet: uf.content.slice(0, 300) + '...',
          sizeBytes: uf.content.length
        });
      }
    });

    const updatedProject = {
      ...currentProject,
      projectMap: {
        ...map,
        files: existingFiles
      }
    };

    setCurrentProject(updatedProject);
    setAllProjects(allProjects.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
    showToast(
      language === 'ru'
        ? `Обновлено файлов: ${updatedFiles.length} в карте проекта!`
        : `Updated ${updatedFiles.length} file(s) in Project Map!`
    );
  };

  /**
   * Replaces the project map with the files that really exist in the connected folder, so the
   * Prompt Compiler and the plan work with real paths instead of the seeded examples.
   */
  const onSyncProjectFiles = (files: ProjectFile[], root: string | null) => {
    if (!currentProject) return;

    const map = projectMapOf(currentProject);
    const previousFiles = map.files || [];
    const merged = files.map((file) => {
      const previous = previousFiles.find((f) => f.path === file.path);
      return previous
        ? { ...previous, ...file, content: previous.content, contentSnippet: previous.contentSnippet }
        : file;
    });

    const updated = {
      ...currentProject,
      workspaceRoot: root ?? currentProject.workspaceRoot,
      projectMap: { ...map, files: merged }
    };

    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    showToast(
      language === 'ru'
        ? `Карта проекта обновлена по папке: файлов ${merged.length}`
        : `Project map synced with the folder: ${merged.length} file(s)`
    );
  };

  const onUpdateRulesContent = (content: ProjectState['rulesFilesContent']) => {
    if (!currentProject) return;
    const updated = { ...currentProject, rulesFilesContent: content };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * Quiet on purpose: this is a background check that runs after every written batch, and a toast
   * for each of them would be noise. Whoever runs it decides whether the outcome is worth saying
   * out loud — the panel shows the date either way.
   */
  const onRecordRulesCheck = (stamp: RulesCheckStamp) => {
    if (!currentProject) return;
    const updated = { ...currentProject, lastRulesCheck: stamp };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  const onApplyFileInsights = (insights: FileInsights) => {
    if (!currentProject) return;

    const updated = {
      ...currentProject,
      projectMap: { ...projectMapOf(currentProject), insights }
    };

    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  const onUpdateTaskStatus = (
    taskId: string,
    newStatus: TaskStatus,
    nextAction?: string,
    reviewHistory?: ReviewAttempt[],
    progressPercent?: number
  ) => {
    if (!currentProject) return;

    const updatedPhases = currentProject.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        if (task.id === taskId) {
          const isDone = newStatus === 'completed';
          const calculatedProgress =
            progressPercent !== undefined
              ? progressPercent
              : isDone
              ? 100
              : newStatus === 'partial'
              ? 50
              : 0;

          return {
            ...task,
            status: newStatus,
            progressPercent: calculatedProgress,
            reviewHistory: reviewHistory || task.reviewHistory,
            acceptanceCriteria: task.acceptanceCriteria.map((ac) => ({
              ...ac,
              passed: isDone ? true : ac.passed
            }))
          };
        }
        return task;
      })
    }));

    const updated = {
      ...currentProject,
      phases: updatedPhases,
      nextBestAction: nextAction || currentProject.nextBestAction
    };

    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * The arrangement belongs to the project, not to the screen. Only the cards that were actually
   * moved are written, so a card that was never touched keeps its "unplaced" state and can still
   * be laid out by the board later.
   */
  const onUpdateTaskPositions = (positions: Record<string, { x: number; y: number }>) => {
    if (!currentProject) return;

    const updatedPhases = currentProject.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) =>
        positions[task.id] ? { ...task, canvasPosition: positions[task.id] } : task
      )
    }));

    const updated = { ...currentProject, phases: updatedPhases };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * Renaming a task from the board. A blank name is refused rather than written: a nameless card on
   * the plan is a card nobody can find again, and the user who emptied the field most likely meant
   * to cancel.
   */
  const onUpdateTaskTitle = (taskId: string, title: string) => {
    if (!currentProject) return;
    const clean = title.trim();
    if (!clean) return;

    const updatedPhases = currentProject.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => (task.id === taskId ? { ...task, title: clean } : task))
    }));

    const updated = { ...currentProject, phases: updatedPhases };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * The card's files, written whole and normalized on the way in: the board has already removed
   * repeats, but storage is the last place that can make sure a card never holds a path the plan
   * cannot open or more files than a prompt can name.
   */
  const onUpdateTaskFiles = (taskId: string, files: string[]) => {
    if (!currentProject) return;
    const clean = mergeTaskFiles(files, []);

    const updatedPhases = currentProject.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => (task.id === taskId ? { ...task, relevantFiles: clean } : task))
    }));

    const updated = { ...currentProject, phases: updatedPhases };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * The board's lanes, written whole. The board sends the map it is drawing from, so a lane that was
   * put back to its defaults arrives here as a lane whose fields are simply gone.
   */
  const onUpdateCanvasLanes = (
    lanes: Record<string, CanvasLaneSkin>,
    positions?: Record<string, { x: number; y: number }>
  ) => {
    if (!currentProject) return;

    const pruned: Record<string, CanvasLaneSkin> = {};
    for (const [key, skin] of Object.entries(lanes || {})) {
      if (!skin) continue;
      const named = typeof skin.label === 'string' && skin.label.trim();
      const placed = Number.isFinite(skin.offsetX) || Number.isFinite(skin.offsetY);
      // A stretched zone is a change of its own: a lane nobody moved but everybody widened must not
      // be dropped on the way to storage, or the size would be the one thing the board forgets.
      const stretched = Number.isFinite(skin.width) || Number.isFinite(skin.height);
      if (!named && !placed && !stretched && !skin.color) continue;
      pruned[key] = {
        ...(named ? { label: String(skin.label).trim() } : {}),
        ...(skin.color ? { color: skin.color } : {}),
        ...(Number.isFinite(skin.offsetX) && skin.offsetX ? { offsetX: skin.offsetX } : {}),
        ...(Number.isFinite(skin.offsetY) && skin.offsetY ? { offsetY: skin.offsetY } : {}),
        ...(Number.isFinite(skin.width) ? { width: skin.width } : {}),
        ...(Number.isFinite(skin.height) ? { height: skin.height } : {})
      };
    }

    /*
     * The cards the zone carried are part of the same change. A card nobody moved keeps no position
     * at all, so only the ids that came along are written — a plan is still allowed to lay out
     * everything it has not been told about.
     */
    const carried = positions || {};
    const carriedIds = Object.keys(carried).filter(
      (id) => carried[id] && Number.isFinite(carried[id].x) && Number.isFinite(carried[id].y)
    );
    const updatedPhases =
      carriedIds.length > 0
        ? currentProject.phases.map((phase) => ({
            ...phase,
            tasks: phase.tasks.map((task) =>
              carried[task.id] && carriedIds.includes(task.id) ? { ...task, canvasPosition: carried[task.id] } : task
            )
          }))
        : currentProject.phases;

    const updated = { ...currentProject, phases: updatedPhases, canvasLanes: pruned };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  const onAddTask = (phaseId: string, title: string, goal: string) => {
    if (!currentProject) return;

    const updatedPhases = currentProject.phases.map((phase) => {
      if (phase.id === phaseId) {
        const newTask = {
          id: `task_${Date.now()}`,
          phaseId,
          title,
          goal,
          status: 'ready' as TaskStatus,
          relevantFiles: (currentProject.projectMap?.files || []).slice(0, 2).map((f) => f.path),
          acceptanceCriteria: [
            { id: `ac_1`, description: 'Code compiles without syntax errors', passed: false },
            { id: `ac_2`, description: 'Requested feature functionality verified', passed: false }
          ],
          testRequirements: ['Unit test verification'],
          estimatedComplexity: 'Small (1 prompt)' as const,
          dependencies: [],
          progressPercent: 0
        };
        return {
          ...phase,
          tasks: [...phase.tasks, newTask]
        };
      }
      return phase;
    });

    const updated = { ...currentProject, phases: updatedPhases };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
  };

  /**
   * Adds the task and writes its verdict in one update.
   *
   * Two updates would be one too many: both would read the same `currentProject` from this render
   * and the second would overwrite the first, so the task would arrive with no status and the status
   * would be written onto a task that the project still does not have.
   */
  const onAdoptTask = (input: AdoptTaskInput): string | null => {
    if (!currentProject || currentProject.phases.length === 0) return null;

    const phase =
      currentProject.phases.find((p) => p.id === input.phaseId) ||
      currentProject.phases[currentProject.phases.length - 1];
    const id = `task_${Date.now()}`;
    const done = input.status === 'completed';
    const adopted: ProjectTask = {
      id,
      phaseId: phase.id,
      title: input.title,
      goal: input.goal?.trim() || input.title,
      status: input.status || 'ready',
      relevantFiles: input.relevantFiles || [],
      acceptanceCriteria: (input.acceptanceCriteria || []).map((description, index) => ({
        id: `ac_${index + 1}`,
        description,
        passed: done
      })),
      testRequirements: [],
      estimatedComplexity: 'Small (1 prompt)',
      dependencies: [],
      progressPercent: input.progressPercent ?? (done ? 100 : 0),
      reviewHistory: input.reviewHistory || []
    };

    const updatedPhases = currentProject.phases.map((p) =>
      p.id === phase.id ? { ...p, tasks: [...p.tasks, adopted] } : p
    );
    const updated = {
      ...currentProject,
      phases: updatedPhases,
      nextBestAction: input.nextBestAction || currentProject.nextBestAction
    };

    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    return id;
  };

  const onAdaptProjectPhases = (updatedPhases: any[]) => {
    if (!currentProject) return;
    const updated = { ...currentProject, phases: updatedPhases };
    setCurrentProject(updated);
    setAllProjects(allProjects.map((p) => (p.id === updated.id ? updated : p)));
    showToast(
      language === 'ru'
        ? 'ИИ успешно адаптировал и обновил план проекта!'
        : 'AI successfully adapted and updated project roadmap!'
    );
  };

  return (
    <ProjectContext.Provider
      value={{
        allProjects,
        currentProject,
        toastMessage,
        compilerTaskTitle,
        reviewOutputText,
        coachErrorText,
        reviewTaskHint,
        setCompilerTaskTitle,
        setReviewOutputText,
        setCoachErrorText,
        setReviewTaskHint,
        showToast,
        clearToast,
        onSelectProject,
        onDeleteProject,
        onSelectAgent,
        onSelectInterfaceMode,
        onSelectAutonomy,
        onAddProject,
        onUpdateProjectFiles,
        onSyncProjectFiles,
        onApplyFileInsights,
        onUpdateRulesContent,
        onRecordRulesCheck,
        onUpdateTaskStatus,
        onAddTask,
        onAdoptTask,
        onAdaptProjectPhases,
        onUpdateTaskPositions,
        onUpdateTaskTitle,
        onUpdateTaskFiles,
        onUpdateCanvasLanes
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
