import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The working mode reaches the compiler: the prompt that ends up in the user's AI agent knows how
 * much the agent has to do on its own. And a lower level is not handed knobs it did not ask for —
 * the context settings are picked for it and stay folded away until it wants them.
 */

function makeProject(technicalLevel: string) {
  return {
    id: `compiler-level-${technicalLevel}`,
    name: 'Compiler Level Demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel,
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Compiler Level Demo',
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
    architecture: {
      technologyStack: ['React'],
      folderStructure: [],
      coreEntities: [],
      dataFlow: 'ui -> api',
      testingStrategy: 'vitest',
      deploymentPlan: 'static',
      securityRisks: []
    },
    projectMap: {
      projectName: 'Compiler Level Demo',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'src/App.tsx', type: 'code', description: 'Main entry point' }]
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
            title: 'Build the demo screen',
            goal: 'Render the demo screen',
            status: 'ready',
            relevantFiles: ['src/App.tsx'],
            acceptanceCriteria: [{ id: 'ac1', description: 'Renders', passed: false }],
            testRequirements: [],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
}

function mockCompileApi() {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/prompt/compile')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            taskTitle: 'Build the demo screen',
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
            createdAt: new Date().toISOString()
          }
        })
      } as unknown as Response);
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

async function openCompiler(project: any) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';

  const spy = mockCompileApi();
  render(<App />);

  // The trigger sits twice on the screen: next to the settings and in the empty output area.
  const start = (await screen.findAllByRole('button', { name: 'Начать' }))[0];
  return { spy, start };
}

describe('Working mode reaches the prompt compiler', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('sends the project mode with the compiled prompt', async () => {
    const { spy, start } = await openCompiler(makeProject('Intermediate'));

    fireEvent.click(start);
    await waitFor(() => expect(compileRequestBody(spy)).toBeTruthy(), { timeout: 4000 });
    expect(compileRequestBody(spy).skillLevel).toBe('Intermediate');
  }, 15000);

  it('keeps the context knobs out of the way for a lower level, but one click away', async () => {
    const { spy, start } = await openCompiler(makeProject('Vibe-coder'));

    // The settings were chosen for the user: no mode switch, no file checklist.
    expect(screen.getByText('Настройки выбраны за вас — менять их не обязательно.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Минимальный' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Полный' })).toBeNull();
    expect(screen.queryByText(/Индекс файлов проекта \(/)).toBeNull();

    // Asking for them brings the whole setup back.
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вручную' }));
    expect(screen.getByRole('button', { name: 'Минимальный' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Полный' })).toBeInTheDocument();

    // And the level still travels with the request.
    fireEvent.click(start);
    await waitFor(() => expect(compileRequestBody(spy)).toBeTruthy(), { timeout: 4000 });
    expect(compileRequestBody(spy).skillLevel).toBe('Vibe-coder');
  }, 15000);

  it('leaves the full setup on screen for a higher level', async () => {
    await openCompiler(makeProject('Advanced'));

    expect(screen.queryByText('Настройки выбраны за вас — менять их не обязательно.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Минимальный' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Полный' })).toBeInTheDocument();
  }, 15000);
});
