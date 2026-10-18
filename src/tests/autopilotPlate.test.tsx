import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { AutopilotPlate } from '../components/AutopilotPlate';
import { PlanCanvas } from '../components/PlanCanvas';
import { ServerSentEvent } from './testSse';

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    startAutonomousRunApi: vi.fn(async () => ({ started: true, runId: 'run-xyz', maxAttempts: 4 })),
    streamAutonomousRun: vi.fn((runId: string, onEvent: (e: any) => void) => {
      const source = new ServerSentEvent(onEvent);
      return { close: () => source.close(), done: Promise.resolve() };
    })
  };
});

import { PlanContextMenu } from '../components/PlanContextMenu';

function makeProject() {
  return {
    id: 'p_auto',
    name: 'Autopilot demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    phases: [
      {
        id: 'phase_0',
        phaseNumber: 1,
        title: 'Core',
        purpose: '',
        deliverable: '',
        tasks: [
          {
            id: 't1',
            phaseId: 'phase_0',
            title: 'Add a delete button',
            goal: 'Records can be deleted',
            status: 'ready',
            relevantFiles: ['src/App.tsx'],
            acceptanceCriteria: [{ id: 'ac1', description: 'button exists', passed: false }],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          } as any
        ]
      }
    ]
  } as any;
}

describe('The Auto-Code card action', () => {
  it('shows up in the card right-click menu and hands the task over', () => {
    const onRenameTask = vi.fn();
    const onAutoCode = vi.fn();
    const t = {
      plan: { cardMenuRename: 'Rename', cardRenamePlaceholder: 'Rename', autoCodeButton: 'Auto-code: do it yourself' },
      common: { apply: 'Apply' }
    } as any;

    render(
      <PlanContextMenu
        target={{ x: 10, y: 10, task: { id: 't1', title: 'Add a delete button' } }}
        t={t}
        onRenameLane={() => {}}
        onColorLane={() => {}}
        onResetLane={() => {}}
        onRenameTask={onRenameTask}
        onAutoCode={onAutoCode}
        onClose={() => {}}
      />
    );

    const button = screen.getByTestId('plan-context-autocode') as HTMLButtonElement;
    fireEvent.click(button);

    expect(onAutoCode).toHaveBeenCalledWith({ id: 't1', title: 'Add a delete button' });
  });
});

describe('The autopilot plate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('easy_project_compiler_lang', 'en');
    localStorage.setItem('easy_projects', '[]');
    localStorage.setItem('easyProjectNames', '[]');
    localStorage.setItem('easy_project_compiler_projects', '[]');
  });

  afterEach(() => {
    cleanup();
  });

  it('opens its own stream for the run the server assigned and shows every step', async () => {
    const onEvent = ServerSentEvent.last as any | undefined;
    let listener: ((e: any) => void) | null = null;

    const api = await import('../services/api');
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      ServerSentEvent.last = { emit: (e: any) => cb(e), close: () => {} } as any;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate
        task={{ id: 't1', title: 'Add a delete button' }}
        project={makeProject()}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(listener).toBeTruthy());

    (listener as any)({
      runId: 'run-xyz',
      seq: 1,
      type: 'run_started',
      at: 'now',
      text: 'Autonomous run: "Add a delete button", up to 4 attempts'
    });
    (listener as any)({
      runId: 'run-xyz',
      seq: 2,
      type: 'files_written',
      at: 'now',
      attempt: 1,
      text: 'created: src/App.tsx'
    });
    (listener as any)({
      runId: 'run-xyz',
      seq: 3,
      type: 'run_completed',
      at: 'now',
      attempt: 1,
      text: 'Completed in 1 attempt(s)'
    });

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('completed')
    );

    const log = screen.getByTestId('autopilot-log');
    expect(log.textContent).toContain('Autonomous run: "Add a delete button", up to 4 attempts');
    expect(log.textContent).toContain('created: src/App.tsx');
    expect(log.textContent).toContain('Completed in 1 attempt(s)');
  });

  it('says the run failed when the server says so', async () => {
    let listener: ((e: any) => void) | null = null;
    const api = await import('../services/api');
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate
        task={{ id: 't2', title: 'Break it on purpose' }}
        project={makeProject()}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(listener).toBeTruthy());
    (listener as any)({ runId: 'run-xyz', seq: 1, type: 'run_failed', at: 'now', attempt: 4, text: 'stopped' });

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
  });
});

describe('The board hands the task over through its menu', () => {
  afterEach(() => {
    cleanup();
  });

  it('right-clicking a card offers Auto-code, right-clicking a lane does not', () => {
    const project = makeProject();
    render(
      <PlanCanvas
        project={project}
        onUpdateTaskStatus={() => {}}
        onUpdateTaskPositions={() => {}}
        onUpdateTaskTitle={() => {}}
        onCompileTaskPrompt={() => {}}
        onAddTask={() => {}}
      />
    );

    // Offering it: the menu carries the action for a card…
    const card = screen.getByTestId('plan-card-t1');
    fireEvent.contextMenu(card, { clientX: 100, clientY: 100, button: 2 });
    expect(screen.getByTestId('plan-context-autocode')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    // …and does not for a lane: "Auto-code" without a task would mean nothing.
    const lane = screen.getByTestId('plan-lane-ready');
    fireEvent.contextMenu(lane, { clientX: 50, clientY: 50, button: 2 });
    expect(screen.queryByTestId('plan-context-autocode')).toBeNull();
  });
});
