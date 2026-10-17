import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import type { ProjectState } from '../types';

/**
 * A screen that offers the same choice twice leaves the reader guessing which one counts: two Start
 * buttons raise the question of which to press, two identical agent dropdowns hold two different
 * answers, and a field pre-filled with a written example compiles a prompt about somebody else's
 * game. What is pinned here is the shape of the compiler screen: one way to start, one way into the
 * review, one agent (the project's own setting), and a task field that is either the user's task or
 * honestly empty.
 */

const EXAMPLE_TASK = 'Например: добавить механику голода с уменьшением здоровья при нулевом значении...';
const PASTE_PLACEHOLDER = 'Вставьте код или ответ, полученный от агента...';

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  const project = {
    id: 'layout-demo',
    name: 'Beer Simulator 2D',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser 3',
    language: 'JavaScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Intermediate',
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Beer Simulator 2D',
      tagline: 'A demo',
      targetAudience: 'Testers',
      coreProblem: 'Nothing',
      coreValue: 'Nothing',
      mvpFeatures: ['Feature'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    projectMap: {
      projectName: 'Beer Simulator 2D',
      projectType: 'Phaser.js',
      engineOrFramework: 'Phaser 3',
      language: 'JavaScript',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'src/scenes/MainScene.ts', type: 'code', description: 'Main scene' }]
    },
    phases: [
      {
        id: 'p0',
        phaseNumber: 0,
        title: 'Setup',
        purpose: 'Setup',
        deliverable: 'Working shell',
        tasks: [
          {
            id: 't1',
            phaseId: 'p0',
            title: 'Создание инстанса Phaser и BootScene',
            goal: 'Initialise Phaser 3',
            status: 'ready',
            relevantFiles: ['src/scenes/MainScene.ts'],
            acceptanceCriteria: [{ id: 'ac1', description: 'Boots', passed: false }],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Keep `src/scenes/MainScene.ts` small\n',
      claudeMd: '# CLAUDE.md\n\n@AGENTS.md\n',
      cursorRules: '---\ndescription: Rules\nalwaysApply: true\n---\n\n# Rules\n\n- Keep it pure\n'
    },
    workspaceRoot: undefined,
    ...overrides
  };
  return project as unknown as ProjectState;
}

/** A plan whose only task is already finished: nothing to offer in the task field. */
function projectWithoutAnOpenTask(): ProjectState {
  const project = makeProject();
  project.phases = [
    {
      ...project.phases[0],
      tasks: [{ ...project.phases[0].tasks[0], status: 'completed' as const }]
    }
  ];
  return project;
}

function savedProject(): any {
  const raw = localStorage.getItem('easy_project_compiler_current_project');
  return raw ? JSON.parse(raw) : null;
}

function openCompiler(project: ProjectState) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';

  const bodies: any[] = [];
  vi.spyOn(global, 'fetch').mockImplementation((input: any, init: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (init?.body) {
      try {
        bodies.push({ url, body: JSON.parse(String(init.body)) });
      } catch {
        /* not JSON — nothing to inspect */
      }
    }
    // A review answer in the shape the server sends it, so the screen it opens is the real one.
    const review = {
      id: 'rev_1',
      taskId: 't1',
      status: 'Partially Completed',
      progressPercent: 60,
      completedCriteria: ['Boots'],
      missingCriteria: ['Renders the scene'],
      warnings: [],
      unintendedChanges: [],
      nextBestAction: 'Finish the scene',
      agentOutputSummary: 'Part of the task is done.'
    };

    // No folder is connected here, so the rules check reports what it could not compare.
    const data = url.includes('/api/review/session')
      ? review
      : url.includes('/api/prompt/compile')
      ? {
          taskTitle: 'Layout demo',
          confidence: 90,
          includedFiles: [],
          excludedFiles: [],
          missingContext: [],
          architectureWarnings: [],
          promptText: 'COMPILED PROMPT TEXT',
          acceptanceCriteria: [],
          tests: [],
          estimatedTokens: 100,
          nextBestAction: 'Copy it',
          securityWarnings: [],
          contextMode: 'Balanced',
          createdAt: new Date().toISOString(),
          rulesCheck: {
            audit: { findings: [], problems: 0, notes: 0, compared: { files: false, commands: false } },
            facts: { files: 0, scripts: null, connected: false },
            checkedAt: new Date().toISOString()
          }
        }
      : url.includes('/api/files/workspace')
      ? { root: null, files: [], backups: [], timeline: [], checkpoints: [] }
      : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as unknown as Response);
  });

  render(<App />);
  return bodies;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('One screen, one action', () => {
  it('1. has a single Start button, and it is the one at the end of the form', async () => {
    openCompiler(makeProject());
    const starts = await screen.findAllByRole('button', { name: 'Начать' });

    expect(starts).toHaveLength(1);
    // The empty result area says where the prompt will come from instead of offering a second trigger.
    expect(screen.getByText(/затем нажмите «Начать»/)).toBeInTheDocument();
  }, 20000);

  it('2. has a single way into the review, and it carries what was pasted', async () => {
    openCompiler(makeProject());

    expect(await screen.findByRole('button', { name: /Перейти к анализу кода/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Перейти к анализу кода/ })).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText(PASTE_PLACEHOLDER), {
      target: { value: 'export const boot = () => {};' }
    });

    // Still one button: with an answer in the box it says what it will do with it.
    expect(screen.queryByRole('button', { name: /Перейти к анализу кода/ })).toBeNull();
    const check = screen.getByRole('button', { name: /Проверить вставленный код/ });
    expect(screen.getAllByRole('button', { name: /Проверить вставленный код/ })).toHaveLength(1);

    fireEvent.click(check);
    await waitFor(() => expect(screen.getByText(/Шаг 4/)).toBeInTheDocument(), { timeout: 4000 });
  }, 20000);

  it('3. keeps one agent control, and it is the project’s own setting', async () => {
    // The agent is chosen here and only here: the top bar shows the project, not a row of pickers.
    // The control must write into the project, never into a private copy of its own.
    openCompiler(makeProject({ technicalLevel: 'Advanced' }));

    const control = await screen.findByLabelText('Агент:');
    expect(screen.getAllByLabelText('Агент:')).toHaveLength(1);
    expect((control as HTMLSelectElement).value).toBe('DeepSeek / Web Chat');

    fireEvent.change(control, { target: { value: 'Claude Code' } });

    await waitFor(() => expect(savedProject().selectedAgent).toBe('Claude Code'));
    // Still one control, and it shows what the project now holds.
    expect(screen.getAllByLabelText('Агент:')).toHaveLength(1);
    expect((screen.getByLabelText('Агент:') as HTMLSelectElement).value).toBe('Claude Code');
  }, 20000);

  it('4. offers the same single agent control on the guided interface', async () => {
    openCompiler(makeProject());

    // One control, still the project's own setting rather than a copy that lives only until the
    // screen is left.
    const agents = await screen.findAllByLabelText('Агент:');
    expect(agents).toHaveLength(1);

    fireEvent.change(agents[0], { target: { value: 'Cursor' } });
    await waitFor(() => expect(savedProject().selectedAgent).toBe('Cursor'));
  }, 20000);

  it('5. shows the user’s own task, and an empty field when there is nothing to offer', async () => {
    const bodies = openCompiler(projectWithoutAnOpenTask());
    const field = await screen.findByPlaceholderText(EXAMPLE_TASK);

    // The written example is a placeholder, not a task somebody asked for.
    expect((field as HTMLTextAreaElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByText('Опишите задачу, которую должен выполнить ИИ-агент.')).toBeInTheDocument();
    expect(bodies.some((call) => call.url.includes('/api/prompt/compile'))).toBe(false);
  }, 20000);

  it('6. starts on the plan task when the project has one open', async () => {
    openCompiler(makeProject());

    const field = await screen.findByPlaceholderText(EXAMPLE_TASK);
    expect((field as HTMLTextAreaElement).value).toBe('Создание инстанса Phaser и BootScene');
  }, 20000);
});
