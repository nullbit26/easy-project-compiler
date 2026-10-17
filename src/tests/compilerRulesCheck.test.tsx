import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The compiler is where the user's task leaves for their agent, so the promise tested here is the
 * whole point of the check: the rules of the project travel with the request, and what the checker
 * found is on the screen next to the prompt — not buried in the Project Map screen five clicks away.
 *
 * The prompt text itself is built on the server and covered there; what this file pins is the
 * request carrying the rules and the screen telling the truth about what came back.
 */

function makeProject() {
  return {
    id: 'compiler-rules-demo',
    name: 'Island Survival',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser 3',
    language: 'JavaScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Intermediate',
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Island Survival',
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
      projectName: 'Island Survival',
      projectType: 'Phaser.js',
      engineOrFramework: 'Phaser 3',
      language: 'JavaScript',
      rulesFiles: ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/project.mdc'],
      files: [{ path: 'src/main.js', type: 'code', description: 'Main entry point' }]
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
            title: 'Run the first task',
            goal: 'Ship something',
            status: 'ready',
            acceptanceCriteria: [],
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Wire `Assets/Gone.cs` into the spawn loop\n',
      claudeMd: '# CLAUDE.md — указатель\n\n@AGENTS.md\n',
      cursorRules: '# Rules\n\n- Keep the grid pure\n'
    }
  };
}

const STALE_FINDING = {
  id: 'AGENTS.md:3:missing-file:Assets/Gone.cs',
  kind: 'missing-file',
  severity: 'problem',
  file: 'AGENTS.md',
  line: 3,
  evidence: '- Wire `Assets/Gone.cs` into the spawn loop',
  missing: 'Assets/Gone.cs'
};

function compiledResponse(options: { findings?: any[]; compared?: boolean; checkedAt?: string } = {}) {
  const findings = options.findings ?? [STALE_FINDING];
  return {
    taskTitle: 'Run the first task',
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
      audit: {
        findings,
        problems: findings.filter((finding) => finding.severity === 'problem').length,
        notes: findings.filter((finding) => finding.severity === 'note').length,
        compared: { files: options.compared ?? true, commands: options.compared ?? true }
      },
      facts: { files: 2, scripts: ['test', 'build'], connected: options.compared ?? true },
      checkedAt: options.checkedAt ?? '2026-10-16T11:32:00.000Z'
    }
  };
}

/** Mocks every fetch, with the compile call answering the shape the server returns. */
function mockFetch(payload: unknown) {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/prompt/compile')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: payload }) } as unknown as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response);
  });
}

function compileRequestBody(spy: any): any {
  const call = spy.mock.calls.find((entry: any[]) => {
    const url = typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? '';
    return url.includes('/api/prompt/compile');
  });
  return call ? JSON.parse(call[1].body) : null;
}

async function compile(project = makeProject(), payload: unknown = compiledResponse()) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';

  const spy = mockFetch(payload);
  render(<App />);

  const start = (await screen.findAllByRole('button', { name: 'Начать' }))[0];
  fireEvent.click(start);
  return spy;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The rules travel with the compiled prompt', () => {
  it('1. sends the project rules and its name with the request', async () => {
    const spy = await compile();

    await waitFor(() => expect(compileRequestBody(spy)).toBeTruthy(), { timeout: 4000 });
    const body = compileRequestBody(spy);
    expect(body.rules.agentsMd).toContain('Assets/Gone.cs');
    expect(body.rules.cursorRules).toContain('Keep the grid pure');
    expect(body.projectName).toBe('Island Survival');
  }, 15000);

  it('2. shows the stale line the prompt was built with, next to the prompt', async () => {
    await compile();

    const block = await screen.findByTestId('compiler-rules-check');
    expect(within(block).getByText('Файла нет в папке')).toBeTruthy();
    expect(block.textContent).toContain('AGENTS.md:3');
    expect(block.textContent).toContain('Assets/Gone.cs');
    expect(screen.getByTestId('compiler-rules-problems').textContent).toContain('1');
  }, 15000);

  it('3. says the rules are sound when the check found nothing', async () => {
    await compile(makeProject(), compiledResponse({ findings: [] }));

    const block = await screen.findByTestId('compiler-rules-check');
    await waitFor(() => expect(block.textContent).toContain('Правила описывают папку'));
    expect(screen.getByTestId('compiler-rules-problems').textContent).toContain('0');
  }, 15000);

  it('4. admits what could not be compared when no folder is connected', async () => {
    await compile(makeProject(), compiledResponse({ findings: [], compared: false }));

    const block = await screen.findByTestId('compiler-rules-check');
    await waitFor(() => expect(block.textContent).toContain('Папка не подключена'));
    expect(block.textContent).toContain('не сверялись');
  }, 15000);

  it('5. dates the check the prompt was built with, so its facts are not of unknown age', async () => {
    await compile();

    const line = await screen.findByTestId('compiler-rules-checked-at');
    // The same shape the rules panel prints, so one date reads the same on both screens.
    expect(line.textContent).toContain('Сверено при сборке промпта');
    expect(line.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
  }, 15000);

  it('6. says nothing about rules when the response carries none', async () => {
    const payload = compiledResponse();
    // An older answer, or a project without rules: the screen must not invent a check.
    await compile(makeProject(), { ...payload, rulesCheck: undefined });

    await waitFor(() => expect(screen.getByText('COMPILED PROMPT TEXT')).toBeTruthy());
    expect(screen.queryByTestId('compiler-rules-check')).toBeNull();
  }, 15000);
});
