import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import App from '../App';
import { LanguageProvider } from '../context/LanguageContext';
import { ProjectProvider, useProject } from '../context/ProjectContext';
import { RulesWatchdog } from '../components/RulesWatchdog';
import { applyFileChangesApi, undoFileChangesApi } from '../services/api';
import { resetRulesWatchForTests } from '../services/rulesWatch';
import { formatRulesCheckTime, sameCheckReading, stampFromAudit } from '../utils/rulesCheckStamp';
import type { ProjectState } from '../types';

/**
 * The rules are the one document in a project nobody re-reads, and every batch written into the
 * folder is a chance for them to have drifted from it. What is pinned here is that the comparison
 * happens by itself right after the write — from whichever screen made it — that its date lands on
 * the project where it survives a reload, and that the check refuses to claim more than it did:
 * no folder is not a fresh date, an empty batch is not a reason to check, and a folder that could not
 * be read leaves the last real date standing.
 */

const FOLDER = 'C:\\projects\\island-survival';

/** A project whose rules point at a file the folder does not have: one problem, no notes. */
function projectWithStaleRule(): ProjectState {
  return {
    id: 'p_watch',
    name: 'Island Survival',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser 3',
    language: 'JavaScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Intermediate',
    nextBestAction: 'Continue',
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Wire `Assets/Gone.cs` into the spawn loop\n',
      claudeMd: '# CLAUDE.md — указатель\n\n@AGENTS.md\n',
      cursorRules: '---\ndescription: Project rules\nalwaysApply: true\n---\n\n# Rules\n\n- Keep the grid pure\n'
    },
    projectMap: { files: [] }
  } as unknown as ProjectState;
}

/** The same project with rules that describe the folder as it is. */
function projectWithSoundRules(): ProjectState {
  const project = projectWithStaleRule();
  project.rulesFilesContent = {
    ...project.rulesFilesContent,
    agentsMd: '# AGENTS.md\n\n- Keep `src/main.js` small\n- Run `npm run test` before a commit\n'
  };
  return project;
}

const MANIFEST = JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc -b' } });

function workspacePayload(root: string | null) {
  return {
    root,
    files: root
      ? [
          { path: 'src/main.js', name: 'main.js', dir: 'src', type: 'code', sizeBytes: 30, isText: true },
          { path: 'package.json', name: 'package.json', dir: '', type: 'json', sizeBytes: 60, isText: true }
        ]
      : [],
    backups: [],
    timeline: [],
    checkpoints: []
  };
}

function appliedPayload(applied = 1, root = FOLDER) {
  return {
    backupId: 'backup_1',
    root,
    results: [{ path: 'src/main.js', action: 'update', status: applied > 0 ? 'updated' : 'skipped' }],
    applied,
    failed: 0,
    backups: []
  };
}

interface Mocks {
  spy: ReturnType<typeof vi.spyOn>;
  urls: () => string[];
  workspaceCalls: () => number;
  failWorkspace: () => void;
}

/** Every request goes through the real API module — only the network is mocked. */
function mockNetwork(options: { root?: string | null; applied?: number } = {}): Mocks {
  const root = options.root === undefined ? FOLDER : options.root;
  let workspaceFails = false;

  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';

    if (url.includes('/api/files/apply') || url.includes('/api/files/undo')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: appliedPayload(options.applied ?? 1, root || FOLDER) })
      } as unknown as Response);
    }

    if (url.includes('/api/files/workspace')) {
      if (workspaceFails) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server error',
          json: async () => ({ userMessage: 'Папка недоступна.' })
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: workspacePayload(root) })
      } as unknown as Response);
    }

    if (url.includes('/api/files/file')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { path: 'package.json', content: MANIFEST, truncated: false, sizeBytes: MANIFEST.length } })
      } as unknown as Response);
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response);
  });

  const urls = () =>
    spy.mock.calls.map((entry: any[]) => (typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? ''));

  return {
    spy,
    urls,
    workspaceCalls: () => urls().filter((url) => url.includes('/api/files/workspace')).length,
    failWorkspace: () => {
      workspaceFails = true;
    }
  };
}

/** Reads the project's own state — the stamp is what the user keeps, the toast is what they notice. */
const Probe: React.FC = () => {
  const { currentProject, toastMessage } = useProject();
  const stamp = currentProject?.lastRulesCheck;
  return (
    <div>
      <span data-testid="stamp-at">{stamp ? stamp.at : 'none'}</span>
      <span data-testid="stamp-counts">{stamp ? `${stamp.problems}/${stamp.notes}` : 'none'}</span>
      <span data-testid="stamp-compared">{stamp ? String(stamp.compared.files) : 'none'}</span>
      <span data-testid="toast">{toastMessage || ''}</span>
    </div>
  );
};

function renderWatchdog(project: ProjectState) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');

  return render(
    <LanguageProvider>
      <ProjectProvider>
        <RulesWatchdog />
        <Probe />
      </ProjectProvider>
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetRulesWatchForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetRulesWatchForTests();
});

describe('The rules are checked after a batch is written', () => {
  it('1. compares the rules with the folder by itself and keeps the date on the project', async () => {
    mockNetwork();
    renderWatchdog(projectWithStaleRule());

    expect(screen.getByTestId('stamp-at').textContent).toBe('none');

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'export const x = 1;\n' }]);

    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));
    expect(screen.getByTestId('stamp-counts').textContent).toBe('1/0');
    expect(screen.getByTestId('stamp-compared').textContent).toBe('true');

    // The date is a real moment, printed the way the panel prints it.
    const at = screen.getByTestId('stamp-at').textContent || '';
    expect(Number.isNaN(new Date(at).getTime())).toBe(false);
    expect(formatRulesCheckTime(at)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  }, 15000);

  it('2. reads the folder and its package.json, because a check without them is not a check', async () => {
    const network = mockNetwork();
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);
    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));

    expect(network.workspaceCalls()).toBe(1);
    expect(network.urls().some((url) => url.includes('/api/files/file?path=package.json'))).toBe(true);
  }, 15000);

  it('3. keeps the date across a reload, because it lives on the project', async () => {
    mockNetwork();
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);
    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));

    const saved = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
    expect(saved.lastRulesCheck.at).toBe(screen.getByTestId('stamp-at').textContent);
    expect(saved.lastRulesCheck.problems).toBe(1);
  }, 15000);

  it('4. says out loud when the batch left the rules out of step with the folder', async () => {
    mockNetwork();
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('проблем: 1'));
    expect(screen.getByTestId('toast').textContent).toContain('Карту проекта');
  }, 15000);

  it('5. stays quiet when the rules still describe the folder', async () => {
    mockNetwork();
    renderWatchdog(projectWithSoundRules());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);
    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));

    expect(screen.getByTestId('stamp-counts').textContent).toBe('0/0');
    expect(screen.getByTestId('toast').textContent).toBe('');
  }, 15000);

  it('6. announces an undo as well, because it writes files back', async () => {
    mockNetwork();
    renderWatchdog(projectWithStaleRule());

    await undoFileChangesApi('backup_1');

    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));
    expect(screen.getByTestId('stamp-counts').textContent).toBe('1/0');
  }, 15000);
});

describe('What the check refuses to claim', () => {
  it('7. records nothing when no folder is connected', async () => {
    const network = mockNetwork({ root: null });
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);

    // Give the check its chance to run and get it wrong.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('stamp-at').textContent).toBe('none');
    expect(screen.getByTestId('toast').textContent).toBe('');
    // Nothing was connected, so there was no package.json to read either.
    expect(network.urls().some((url) => url.includes('/api/files/file?path=package.json'))).toBe(false);
  }, 15000);

  it('8. leaves the folder alone when the batch wrote nothing', async () => {
    const network = mockNetwork({ applied: 0 });
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('stamp-at').textContent).toBe('none');
    expect(network.workspaceCalls()).toBe(0);
  }, 15000);

  it('9. keeps the last real date when the folder cannot be read', async () => {
    const network = mockNetwork();
    renderWatchdog(projectWithStaleRule());

    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);
    await waitFor(() => expect(screen.getByTestId('stamp-at').textContent).not.toBe('none'));
    const firstDate = screen.getByTestId('stamp-at').textContent;

    network.failWorkspace();
    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'y' }]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    // A check that could not finish must not leave a fresher-looking date behind it.
    expect(screen.getByTestId('stamp-at').textContent).toBe(firstDate);
  }, 15000);
});

describe('The date reaches the screen that shows the rules', () => {
  it('18. lands in the Project Map panel, because the check ran while another screen was open', async () => {
    mockNetwork();
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(projectWithStaleRule()));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([projectWithStaleRule()]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    window.location.hash = '#/map';

    render(<App />);

    // The panel is open before any write, and it says the rules have not been compared yet.
    const line = await screen.findByTestId('rules-last-check', undefined, { timeout: 4000 });
    expect(line.textContent).toContain('ещё не сверяли');

    // A batch is accepted — here from the harness rather than from one of the four screens that
    // write, which is exactly the case the date has to survive.
    await applyFileChangesApi([{ path: 'src/main.js', action: 'update', content: 'x' }]);

    await waitFor(() => expect(line.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/), { timeout: 4000 });
    expect(line.textContent).toContain('Последняя сверка');
    window.location.hash = '';
  }, 20000);
});

describe('Staying quiet about a reading that has not changed', () => {
  it('10. treats the same problems and notes as the same reading', () => {
    const audit = {
      findings: [],
      problems: 2,
      notes: 1,
      compared: { files: true, commands: true }
    };
    const stamp = stampFromAudit(audit as any, new Date('2026-10-16T11:32:00Z'));
    const later = stampFromAudit(audit as any, new Date('2026-10-16T13:00:00Z'));

    expect(sameCheckReading(stamp, later)).toBe(true);
    expect(sameCheckReading(null, later)).toBe(false);
    expect(
      sameCheckReading(stamp, stampFromAudit({ ...audit, problems: 3 } as any, new Date('2026-10-16T13:00:00Z')))
    ).toBe(false);
  });
});
