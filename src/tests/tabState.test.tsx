import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * Regression guard for the "switching tabs restarts everything" bug:
 * each screen used to unmount on tab change, so a running AI request was thrown away and the
 * Prompt Compiler silently started a fresh compile on every visit.
 *
 * The compiler also used to compile by itself as soon as it was opened and again on every
 * keystroke (debounced). Compiling is now an explicit action: only the Start button fires a
 * request, everything else just marks the result as outdated.
 */

const compiledPrompt = {
  id: 'c1',
  taskId: 't1',
  agent: 'Cursor',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  taskTitle: 'Demo task',
  confidence: 90,
  includedFiles: [],
  excludedFiles: [],
  missingContext: [],
  architectureWarnings: [],
  promptText: 'COMPILED PROMPT TEXT',
  acceptanceCriteria: ['Criterion'],
  tests: ['Test'],
  estimatedTokens: 100,
  nextBestAction: 'Copy the prompt',
  securityWarnings: [],
  contextMode: 'Balanced',
  createdAt: new Date().toISOString()
};

const project = {
  id: 'keep-alive-project',
  name: 'Keep Alive Demo',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  selectedAgent: 'Cursor',
  technicalLevel: 'Vibe-coder',
  nextBestAction: 'Run the first task',
  brief: {
    id: 'b1',
    projectName: 'Keep Alive Demo',
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
    projectName: 'Keep Alive Demo',
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
      title: 'Phase 0 - Setup',
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

function mockCompileApi() {
  return vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/prompt/compile')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: compiledPrompt })
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ data: {} })
    } as unknown as Response);
  });
}

function compileCallCount(spy: any): number {
  return spy.mock.calls.filter((call: any[]) => {
    const url = typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '';
    return url.includes('/api/prompt/compile');
  }).length;
}

describe('Workspace tabs keep their state', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('waits for the Start button instead of compiling on its own, and keeps the typed task across tabs', async () => {
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'en');

    const fetchSpy = mockCompileApi();

    render(<App />);

    // The sidebar starts folded — reveal the other screens first.
    fireEvent.click(await screen.findByRole('button', { name: 'Show all sections' }));

    // Open the Prompt Compiler: nothing may be compiled before the user asks for it.
    fireEvent.click(await screen.findByRole('button', { name: 'Prompt Compiler' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(compileCallCount(fetchSpy)).toBe(0);

    // Start is the only trigger: it sits next to the settings and in the empty output area.
    const startButtons = screen.getAllByRole('button', { name: 'Start' });
    expect(startButtons.length).toBeGreaterThan(0);
    fireEvent.click(startButtons[0]);
    await waitFor(() => expect(compileCallCount(fetchSpy)).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText('COMPILED PROMPT TEXT')).toBeInTheDocument(), { timeout: 4000 });

    const taskBox = screen.getByDisplayValue('Build the demo screen');

    // Editing the task must not start another request; it only asks the user to press Start again.
    fireEvent.change(taskBox, { target: { value: 'Build the login screen' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(compileCallCount(fetchSpy)).toBe(1);
    expect(screen.getByText(/Settings changed/)).toBeInTheDocument();

    // Leave the screen and come back. Previously this remounted the compiler and started a
    // brand-new compile, wiping what the tester had typed and any result on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Plan & Tasks' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prompt Compiler' }));

    // The typed task survived the round trip…
    expect(screen.getByDisplayValue('Build the login screen')).toBeInTheDocument();

    // …and returning to the tab did not fire another compile request either.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(compileCallCount(fetchSpy)).toBe(1);
    // The four deliberate "nothing happens on its own" waits add up to ~3.6s, which is too close
    // to the 5s default once the whole suite runs in parallel.
  }, 15000);
});
