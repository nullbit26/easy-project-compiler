import { describe, it, expect } from 'vitest';

import { nextRecommendation } from '../utils/nextAction';
import type { ProjectState, ProjectTask } from '../types';

/**
 * The dashboard's one sentence is the app telling the user what to do next. It used to be a model's
 * line from days ago, stored with the project and never revisited — and a live run as a beginner
 * found it telling a Unity project to `npm test`. These tests pin the recommendation to the plan as
 * it is now.
 */

function task(id: string, title: string, status: string, dependencies: string[] = []): ProjectTask {
  return {
    id,
    phaseId: 'p1',
    title,
    goal: title,
    status: status as ProjectTask['status'],
    relevantFiles: [],
    acceptanceCriteria: [],
    testRequirements: [],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies,
    progressPercent: 0
  };
}

function project(tasks: ProjectTask[], overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'p',
    name: 'Заметки',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Beginner / Non-coder',
    phases: [
      {
        id: 'p1',
        phaseNumber: 1,
        title: 'Основа',
        purpose: 'Основа',
        deliverable: 'Работающий экран',
        tasks
      }
    ],
    projectMap: { projectName: 'Заметки', projectType: 'React', engineOrFramework: 'React', language: 'TypeScript', rulesFiles: [], files: [] },
    recentErrors: [],
    nextBestAction: 'Добавьте скрипт "test" в package.json и запустите npm test',
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' },
    ...overrides
  } as ProjectState;
}

describe('What the dashboard recommends', () => {
  it('1. ignores the stored sentence while the plan has tasks', () => {
    const rec = nextRecommendation(project([task('t1', 'Список записей', 'in_progress')]), true);

    expect(rec.sentence).toContain('Список записей');
    expect(rec.sentence).not.toContain('npm test');
    expect(rec.destination).toBe('compiler');
  });

  it('2. sends a task waiting for a verdict to the review, naming it', () => {
    const rec = nextRecommendation(project([task('t1', 'Удаление записи', 'review')]), true);

    expect(rec.kind).toBe('review');
    expect(rec.taskTitle).toBe('Удаление записи');
    expect(rec.sentence).toContain('ждёт разбора');
    expect(rec.destination).toBe('review');
  });

  it('3. names the attempt that was judged, not one that has not happened yet', () => {
    const notDone = task('t1', 'Удаление записи', 'partial');
    notDone.reviewHistory = [
      { id: 'r1', attemptNumber: 1, timestamp: '', agentOutput: '', review: {} as any },
      { id: 'r2', attemptNumber: 2, timestamp: '', agentOutput: '', review: {} as any }
    ];

    const rec = nextRecommendation(project([notDone]), true);

    expect(rec.sentence).toContain('Попытка 2');
    expect(rec.sentence).not.toContain('Попытка 3');
    expect(rec.destination).toBe('compiler');
  });

  it('3b. says a task is not finished even when no attempt was ever stored', () => {
    const rec = nextRecommendation(project([task('t1', 'Удаление записи', 'partial')]), true);

    expect(rec.sentence).toContain('закрыта не полностью');
    expect(rec.sentence).not.toContain('Попытка');
  });

  it('4. prefers work already begun over work that has not started', () => {
    const rec = nextRecommendation(
      project([task('t1', 'Список', 'ready'), task('t2', 'Фильтр', 'in_progress')]),
      true
    );

    expect(rec.taskTitle).toBe('Фильтр');
  });

  it('5. starts with the first task in plan order whose dependencies are done', () => {
    const rec = nextRecommendation(
      project([
        task('t1', 'Схема данных', 'completed'),
        task('t2', 'Список записей', 'ready', ['t1']),
        task('t3', 'Экспорт', 'ready', ['t2'])
      ]),
      true
    );

    expect(rec.kind).toBe('start');
    expect(rec.taskTitle).toBe('Список записей');
    expect(rec.sentence).toContain('зависимости уже выполнены');
  });

  it('6. does not offer a task whose dependency is still open', () => {
    const rec = nextRecommendation(
      project([task('t1', 'Схема данных', 'ready'), task('t2', 'Список записей', 'ready', ['t1'])]),
      true
    );

    expect(rec.taskTitle).toBe('Схема данных');
  });

  it('7. names what holds a plan where everything left is blocked', () => {
    const rec = nextRecommendation(
      project([
        task('t1', 'Схема данных', 'completed'),
        task('t2', 'Экспорт', 'blocked', ['t3']),
        task('t3', 'Интеграция', 'blocked')
      ]),
      true
    );

    expect(rec.kind).toBe('blocked');
    expect(rec.sentence).toContain('Экспорт');
    expect(rec.sentence).toContain('Интеграция');
    expect(rec.destination).toBe('plan');
  });

  it('8. says the plan is finished instead of inventing a task', () => {
    const rec = nextRecommendation(
      project([task('t1', 'Схема данных', 'completed'), task('t2', 'Список', 'completed')]),
      true
    );

    expect(rec.kind).toBe('finished');
    expect(rec.taskTitle).toBeNull();
    expect(rec.sentence).toContain('Все 2 задач плана выполнены');
    expect(rec.destination).toBe('plan');
  });

  it('9. keeps the stored sentence only when there is no plan to derive from', () => {
    const rec = nextRecommendation(project([]), true);

    expect(rec.kind).toBe('stored');
    expect(rec.sentence).toContain('npm test');
    expect(rec.destination).toBe('compiler');
  });

  it('10. asks for a plan when there is neither a plan nor a sentence', () => {
    const rec = nextRecommendation(project([], { nextBestAction: '' }), true);

    expect(rec.kind).toBe('empty');
    expect(rec.sentence).toContain('нет задач');
    expect(rec.destination).toBe('plan');
  });

  it('11. follows the phase order, not the order phases happen to be stored in', () => {
    const first = project([task('t2', 'Вторая фаза', 'ready')]);
    first.phases = [
      { id: 'p2', phaseNumber: 2, title: 'Позже', purpose: '', deliverable: '', tasks: [task('t2', 'Вторая фаза', 'ready')] },
      { id: 'p1', phaseNumber: 1, title: 'Сначала', purpose: '', deliverable: '', tasks: [task('t1', 'Первая фаза', 'ready')] }
    ];

    expect(nextRecommendation(first, true).taskTitle).toBe('Первая фаза');
  });

  it('12. speaks English when the project does', () => {
    const rec = nextRecommendation(project([task('t1', 'Note list', 'ready')]), false);

    expect(rec.sentence).toContain('The next task is "Note list"');
    expect(rec.sentence).not.toMatch(/[А-Яа-я]/);
  });
});
