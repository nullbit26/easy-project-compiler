import type { ProjectState, ProjectTask } from '../types';
import { dependencyPlan } from './canvasEdges';

/**
 * What the dashboard recommends, read from the plan as it is right now.
 *
 * The block used to print `project.nextBestAction` — a sentence a model wrote once, stored with the
 * project and never recomputed. A live pass as a beginner found the label recommending `npm test`
 * and a `package.json` test script inside a Unity project, because that sentence had been written
 * days earlier for something else, and the button under it compiled a third thing: whatever task the
 * compiler had been opened with last. The recommendation is a function of the tasks now, and the
 * button acts on the same task the sentence names.
 */

export type NextActionKind =
  | 'review'
  | 'continue'
  | 'start'
  | 'blocked'
  | 'finished'
  | 'empty'
  /** No plan exists yet, so there is nothing to derive from — the stored sentence is all there is. */
  | 'stored';

export type NextActionDestination = 'compiler' | 'review' | 'plan';

export interface NextRecommendation {
  kind: NextActionKind;
  taskId: string | null;
  taskTitle: string | null;
  sentence: string;
  /** Where the one button of the block leads. */
  destination: NextActionDestination;
}

/** Plan order: the first phase a beginner is meant to work on comes first. */
function tasksInPlanOrder(project: ProjectState): ProjectTask[] {
  return [...project.phases]
    .sort((a, b) => (a.phaseNumber || 0) - (b.phaseNumber || 0))
    .flatMap((phase) => phase.tasks || []);
}

/** A dependency reference may be an id or a title — both are accepted elsewhere in the app. */
function blockerTitle(task: ProjectTask, tasks: ProjectTask[]): string | null {
  const refs = task.dependencies || [];
  for (const ref of refs) {
    const key = ref.trim().toLowerCase();
    const found = tasks.find(
      (candidate) => candidate.id === ref || candidate.title.trim().toLowerCase() === key
    );
    if (found && found.status !== 'completed') return found.title;
  }
  return null;
}

/** How many attempts were really judged; 0 when the verdict was never stored. */
function closedAttempts(task: ProjectTask): number {
  return task.reviewHistory?.length || 0;
}

const quote = (isRu: boolean, title: string) => (isRu ? `«${title}»` : `"${title}"`);

export function nextRecommendation(
  project: ProjectState | null | undefined,
  isRu: boolean
): NextRecommendation {
  if (!project) {
    return {
      kind: 'empty',
      taskId: null,
      taskTitle: null,
      sentence: isRu
        ? 'Проект не выбран — создайте его, и приложение соберёт план и промпты.'
        : 'No project is selected — create one and the app will build the plan and the prompts.',
      destination: 'plan'
    };
  }

  const tasks = tasksInPlanOrder(project);

  if (tasks.length === 0) {
    const stored = (project.nextBestAction || '').trim();
    if (stored) {
      // Nothing to derive from yet: the project predates its plan, or the plan was never generated.
      return { kind: 'stored', taskId: null, taskTitle: null, sentence: stored, destination: 'compiler' };
    }
    return {
      kind: 'empty',
      taskId: null,
      taskTitle: null,
      sentence: isRu
        ? 'В плане пока нет задач — сгенерируйте план или добавьте первую задачу.'
        : 'The plan has no tasks yet — generate the plan or add the first task.',
      destination: 'plan'
    };
  }

  const finished = tasks.filter((task) => task.status === 'completed');
  const awaitingReview = tasks.find((task) => task.status === 'review');
  if (awaitingReview) {
    return {
      kind: 'review',
      taskId: awaitingReview.id,
      taskTitle: awaitingReview.title,
      sentence: isRu
        ? `Задача ${quote(isRu, awaitingReview.title)} ждёт разбора: вставьте ответ агента — вердикт сверит его с критериями задачи.`
        : `${quote(isRu, awaitingReview.title)} is waiting for a review: paste the agent's answer and the verdict will check it against the task's criteria.`,
      destination: 'review'
    };
  }

  const partial = tasks.find((task) => task.status === 'partial');
  if (partial) {
    const closed = closedAttempts(partial);
    return {
      kind: 'continue',
      taskId: partial.id,
      taskTitle: partial.title,
      sentence: isRu
        ? closed > 0
          ? `Попытка ${closed} по задаче ${quote(isRu, partial.title)} закрыта не полностью — соберите промпт продолжения.`
          : `Задача ${quote(isRu, partial.title)} закрыта не полностью — соберите промпт продолжения.`
        : closed > 0
        ? `Attempt ${closed} on ${quote(isRu, partial.title)} is not complete — compile the continuation prompt.`
        : `${quote(isRu, partial.title)} is not complete — compile the continuation prompt.`,
      destination: 'compiler'
    };
  }

  const inProgress = tasks.find((task) => task.status === 'in_progress');
  if (inProgress) {
    return {
      kind: 'continue',
      taskId: inProgress.id,
      taskTitle: inProgress.title,
      sentence: isRu
        ? `Задача ${quote(isRu, inProgress.title)} в работе — соберите для неё следующий промпт.`
        : `${quote(isRu, inProgress.title)} is in progress — compile the next prompt for it.`,
      destination: 'compiler'
    };
  }

  /*
   * Nothing has started yet: the first task whose dependencies are finished is the one to begin.
   * `dependencyPlan` is the same reading the board draws its lines from, so the recommendation and
   * the arrows can never disagree about what is waiting for what.
   */
  const plan = dependencyPlan(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dependencies: task.dependencies || []
    }))
  );
  const startable = tasks.find(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'blocked' &&
      plan.waitingOn[task.id] === 0
  );
  if (startable) {
    const hasDependencies = (startable.dependencies || []).length > 0;
    return {
      kind: 'start',
      taskId: startable.id,
      taskTitle: startable.title,
      sentence: isRu
        ? hasDependencies
          ? `Следующая задача — ${quote(isRu, startable.title)}: её зависимости уже выполнены.`
          : `Следующая задача — ${quote(isRu, startable.title)}: начните с неё.`
        : hasDependencies
        ? `The next task is ${quote(isRu, startable.title)}: its dependencies are done.`
        : `The next task is ${quote(isRu, startable.title)} — start there.`,
      destination: 'compiler'
    };
  }

  /* Only blocked work is left: the board is where the arrows that hold it are read. */
  const blocked = tasks.find((task) => task.status === 'blocked');
  if (blocked) {
    const blocker = blockerTitle(blocked, tasks);
    return {
      kind: 'blocked',
      taskId: blocked.id,
      taskTitle: blocked.title,
      sentence: isRu
        ? blocker
          ? `Задача ${quote(isRu, blocked.title)} заблокирована: она ждёт ${quote(isRu, blocker)}.`
          : `Задача ${quote(isRu, blocked.title)} заблокирована — разберите на доске, что её держит.`
        : blocker
        ? `${quote(isRu, blocked.title)} is blocked: it is waiting for ${quote(isRu, blocker)}.`
        : `${quote(isRu, blocked.title)} is blocked — check the board for what holds it.`,
      destination: 'plan'
    };
  }

  return {
    kind: 'finished',
    taskId: null,
    taskTitle: null,
    sentence: isRu
      ? `Все ${finished.length} задач плана выполнены — проверьте сборку в предпросмотре или добавьте следующую задачу.`
      : `All ${finished.length} tasks in the plan are done — check the build in the preview or add the next task.`,
    destination: 'plan'
  };
}
