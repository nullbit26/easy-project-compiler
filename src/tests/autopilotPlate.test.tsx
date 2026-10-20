import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { AutopilotPlate } from '../components/AutopilotPlate';
import { PlanCanvas } from '../components/PlanCanvas';
import { ServerSentEvent } from './testSse';

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // A server with no folder connected: the plate may repair it from the project's own path.
  const workspaceRead = vi.fn(async () => ({ root: null, files: [], backups: [], timeline: [] }));
  return {
    ...actual,
    fetchWorkspaceApi: workspaceRead,
    // The repair reads without the folder gate; here it is the same server answer.
    readWorkspaceApi: workspaceRead,
    bindWorkspaceApi: vi.fn(async () => ({ root: 'C:/demo', files: [], backups: [], timeline: [] })),
    startAutonomousRunApi: vi.fn(async () => ({ started: true, runId: 'run-xyz', maxAttempts: 4 })),
    streamAutonomousRun: vi.fn((runId: string, onEvent: (e: any) => void) => {
      const source = new ServerSentEvent(onEvent);
      return { close: () => source.close(), done: Promise.resolve() };
    })
  };
});

import { PlanContextMenu } from '../components/PlanContextMenu';

/** Nothing that draws a frame: a border, a ring, a plate or a rounded tile. */
const FRAME_CLASS = /(?:^|\s)(?:border|ring-\S+|rounded-\S+|bg-\S+|shadow-\S+|p[xytblr]?-\S+)/;

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

const CONNECTED_FOLDER = 'C:\\demo\\game';

/** A project whose folder the app already has, and the server's matching answer. */
function connectedProject(api: any) {
  vi.mocked(api.fetchWorkspaceApi).mockResolvedValueOnce({
    root: CONNECTED_FOLDER,
    files: [],
    backups: [],
    timeline: []
  } as any);
  return { ...makeProject(), workspaceRoot: CONNECTED_FOLDER };
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
    const project = connectedProject(api);
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      ServerSentEvent.last = { emit: (e: any) => cb(e), close: () => {} } as any;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate task={{ id: 't1', title: 'Add a delete button' }} project={project} onClose={() => {}} />
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

  it('shows the mark bare while the run is going — no plate, border or ring', async () => {
    let listener: ((e: any) => void) | null = null;
    const api = await import('../services/api');
    const project = connectedProject(api);
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate task={{ id: 't1', title: 'Add a delete button' }} project={project} onClose={() => {}} />
    );

    await waitFor(() => expect(listener).toBeTruthy());
    (listener as any)({ runId: 'run-xyz', seq: 1, type: 'run_started', at: 'now', text: 'started' });

    const mark = await waitFor(() => {
      const found = document.querySelector('.epc-mosaic') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(mark.className).not.toMatch(FRAME_CLASS);
    expect((mark.parentElement as HTMLElement).className).not.toMatch(FRAME_CLASS);
  });

  it('reconnects the project’s folder when the server has none, then starts', async () => {
    const api = await import('../services/api');
    render(
      <AutopilotPlate
        task={{ id: 't3', title: 'Add a delete button' }}
        project={{ ...makeProject(), workspaceRoot: 'C:\\demo\\game' }}
        onClose={() => {}}
      />
    );

    await waitFor(() => expect(api.startAutonomousRunApi).toHaveBeenCalledTimes(1));
    // The plate renders outside the language provider here, so the window is Russian.
    expect(api.bindWorkspaceApi).toHaveBeenCalledWith({ path: 'C:\\demo\\game', language: 'ru' });
    expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('running');
  });

  it('refuses a folder that belongs to another project, instead of writing there', async () => {
    const api = await import('../services/api');
    vi.mocked(api.fetchWorkspaceApi).mockResolvedValueOnce({
      root: 'D:/another-project',
      files: [],
      backups: [],
      timeline: []
    } as any);

    render(
      <AutopilotPlate
        task={{ id: 't4', title: 'Add a delete button' }}
        project={{ ...makeProject(), workspaceRoot: 'C:\\demo\\game' }}
        onClose={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
    expect(api.startAutonomousRunApi).not.toHaveBeenCalled();
    expect(api.bindWorkspaceApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('autopilot-log').textContent).toContain('Подключена другая папка');
  });

  it('names the missing folder instead of starting a run that has nowhere to write', async () => {
    const api = await import('../services/api');

    render(
      <AutopilotPlate task={{ id: 't5', title: 'Add a delete button' }} project={makeProject()} onClose={() => {}} />
    );

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
    // Neither the project nor the app can name a folder: the request would only be refused.
    expect(api.startAutonomousRunApi).not.toHaveBeenCalled();
    const text = document.querySelector('[data-testid="autopilot-plate"]')?.textContent || '';
    // The run never reached the model: checks have not run, so they cannot have failed.
    expect(text).toContain('Авто-режим не запустился.');
    expect(text).toContain('нет подключённой папки');
    expect(text).not.toContain('откатить не удалась');
  });

  it('keeps the folder wording when the server still answers no_workspace', async () => {
    const api = await import('../services/api');
    vi.mocked(api.fetchWorkspaceApi).mockResolvedValueOnce({
      root: 'C:\\demo\\game',
      files: [],
      backups: [],
      timeline: []
    } as any);
    vi.mocked(api.startAutonomousRunApi).mockRejectedValueOnce(
      Object.assign(new Error('No project folder is connected.'), {
        status: 400,
        details: { reason: 'no_workspace' }
      })
    );

    render(
      <AutopilotPlate
        task={{ id: 't5', title: 'Add a delete button' }}
        project={{ ...makeProject(), workspaceRoot: 'C:\\demo\\game' }}
        onClose={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
    const text = screen.getByTestId('autopilot-plate').textContent || '';
    expect(text).toContain('нет подключённой папки');
    expect(text).not.toContain('откатить не удалась');
  });

  it('shows why the project’s own folder could not be reconnected', async () => {
    const api = await import('../services/api');
    vi.mocked(api.bindWorkspaceApi).mockRejectedValueOnce(
      Object.assign(new Error('The folder does not exist'), {
        status: 404,
        userMessage: 'Такой папки или файла не существует.'
      })
    );

    render(
      <AutopilotPlate
        task={{ id: 't7', title: 'Add a delete button' }}
        project={{ ...makeProject(), workspaceRoot: 'C:\\demo\\gone' }}
        onClose={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
    expect(api.startAutonomousRunApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('autopilot-plate').textContent).toContain('Такой папки или файла не существует.');
  });

  it('runs when the project never recorded a folder but the app has one connected', async () => {
    const api = await import('../services/api');
    vi.mocked(api.fetchWorkspaceApi).mockResolvedValueOnce({
      root: 'D:/the-connected-folder',
      files: [],
      backups: [],
      timeline: []
    } as any);

    render(
      <AutopilotPlate task={{ id: 't8', title: 'Add a delete button' }} project={makeProject()} onClose={() => {}} />
    );

    await waitFor(() => expect(api.startAutonomousRunApi).toHaveBeenCalledTimes(1));
    // The folder was not invented here: the app's one connected folder is the only one in play.
    expect(api.bindWorkspaceApi).not.toHaveBeenCalled();
  });

  it('says the run failed when the server says so', async () => {
    let listener: ((e: any) => void) | null = null;
    const api = await import('../services/api');
    const project = connectedProject(api);
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate task={{ id: 't2', title: 'Break it on purpose' }} project={project} onClose={() => {}} />
    );

    await waitFor(() => expect(listener).toBeTruthy());
    (listener as any)({ runId: 'run-xyz', seq: 1, type: 'run_failed', at: 'now', attempt: 4, text: 'stopped' });

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
  });

  it('names a run with no checks as written-but-unconfirmed, not as a pass', async () => {
    let listener: ((e: any) => void) | null = null;
    const api = await import('../services/api');
    const project = connectedProject(api);
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(<AutopilotPlate task={{ id: 't9', title: 'Add a delete button' }} project={project} onClose={() => {}} />);

    await waitFor(() => expect(listener).toBeTruthy());
    (listener as any)({
      runId: 'run-xyz',
      seq: 1,
      type: 'run_completed',
      at: 'now',
      attempt: 1,
      text: 'The files are written. The project has no checks — nothing confirmed the result.',
      detail: { verdict: 'none' }
    });

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('completed')
    );
    const text = screen.getByTestId('autopilot-plate').textContent || '';
    expect(text).toContain('результат не подтверждён');
    expect(text).not.toContain('проверки прошли');
  });

  it('names a run that never reached the model as not started, not as failed checks', async () => {
    let listener: ((e: any) => void) | null = null;
    const api = await import('../services/api');
    const project = connectedProject(api);
    vi.mocked(api.streamAutonomousRun).mockImplementation(((runId: string, cb: (e: any) => void) => {
      listener = cb;
      return { close: () => {}, done: Promise.resolve() };
    }) as any);

    render(
      <AutopilotPlate task={{ id: 't6', title: 'Add a delete button' }} project={project} onClose={() => {}} />
    );

    await waitFor(() => expect(listener).toBeTruthy());
    (listener as any)({
      runId: 'run-xyz',
      seq: 1,
      type: 'run_failed',
      at: 'now',
      text: 'The autonomous loop did not start: no AI provider key is configured.'
    });

    await waitFor(() =>
      expect(screen.getByTestId('autopilot-plate').getAttribute('data-autopilot-state')).toBe('failed')
    );
    expect(screen.getByTestId('autopilot-plate').textContent).toContain('Авто-режим не запустился.');
    expect(screen.getByTestId('autopilot-plate').textContent).not.toContain('откатить не удалась');
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
