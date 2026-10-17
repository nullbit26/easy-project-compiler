import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import {
  AUTONOMY_LEVELS,
  autonomyOf,
  interfaceModeOf,
  isGuidedInterface,
  presetParts,
  withAutonomy,
  withInterfaceMode,
  withPreset
} from '../utils/workingMode';
import { ProjectState } from '../types';

/**
 * The working mode is two independent parts: the interface (which screens a project gets) and the
 * autonomy (how much the agent does itself and how much it explains). A preset sets both, and either
 * part can then be changed on its own.
 *
 * What these tests guard above all: the split must not become a way to change what the code has to
 * be. Only the autonomy value travels to the AI, so switching the interface can never move a single
 * quality demand — and switching the autonomy moves the wording, never the demands themselves (the
 * server-side half of that is pinned in levelGuidance.test.ts).
 */

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'parts-demo',
    name: 'Mode Parts Demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Intermediate',
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Mode Parts Demo',
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
      projectName: 'Mode Parts Demo',
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
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' },
    ...overrides
  };
}

/** Loads one project, opens a screen straight away and records every AI request body. */
function openScreen(project: ProjectState, hash: string) {
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = hash;

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
    const data = url.includes('/api/prompt/compile')
      ? {
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
      : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as unknown as Response);
  });

  render(<App />);
  return bodies;
}

function savedProject(): any {
  const raw = localStorage.getItem('easy_project_compiler_current_project');
  return raw ? JSON.parse(raw) : null;
}

describe('Working mode split into an interface and an autonomy', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('derives both parts from the preset, and lets each be changed alone', () => {
    // A project saved before the split carries only the preset — both parts follow it.
    const legacy = makeProject({ technicalLevel: 'Beginner / Non-coder' });
    expect(interfaceModeOf(legacy)).toBe('guided');
    expect(autonomyOf(legacy)).toBe('Beginner / Non-coder');
    expect(isGuidedInterface(legacy)).toBe(true);
    expect(interfaceModeOf(makeProject({ technicalLevel: 'Advanced' }))).toBe('full');

    // Changing one part leaves the other exactly as it was.
    const fullAtBeginner = withInterfaceMode(legacy, 'full');
    expect(interfaceModeOf(fullAtBeginner)).toBe('full');
    expect(autonomyOf(fullAtBeginner)).toBe('Beginner / Non-coder');

    const guidedAtAdvanced = withAutonomy(makeProject({ technicalLevel: 'Advanced' }), 'Beginner / Non-coder');
    expect(interfaceModeOf(guidedAtAdvanced)).toBe('full');
    expect(autonomyOf(guidedAtAdvanced)).toBe('Beginner / Non-coder');

    // A preset sets both, and every preset maps to one pair.
    for (const preset of AUTONOMY_LEVELS) {
      const applied = withPreset(legacy, preset);
      expect(autonomyOf(applied)).toBe(preset);
      expect(interfaceModeOf(applied)).toBe(presetParts(preset).interface);
    }

    // Junk in a project file cannot turn a screen or a request into something unexpected.
    const junk = makeProject({ interfaceMode: 'everything' as any, autonomyLevel: 'Godmode' as any });
    expect(interfaceModeOf(junk)).toBe(presetParts('Intermediate').interface);
    expect(autonomyOf(junk)).toBe('Intermediate');
  });

  it('opens the step-by-step helper by itself for every level but the most technical one', () => {
    // Picking a preset is the user saying how technical they are; the answer for everyone except the
    // most technical level is the helper. The workspace being the default for the other three was
    // what put ten sections in front of someone who had just asked for explanations.
    for (const preset of AUTONOMY_LEVELS) {
      const guided = isGuidedInterface(makeProject({ technicalLevel: preset }));
      expect(guided).toBe(preset !== 'Advanced');
    }
  });

  it('does not mistake the interface a preset wrote for a choice of the user', () => {
    // Presets write their own interface into a project. Counting that as a choice is what used to
    // freeze every saved project into the interface its author never picked — including the ones
    // saved while the default was the workspace.
    const writtenByPreset = makeProject({ technicalLevel: 'Intermediate', interfaceMode: 'full' });
    expect(interfaceModeOf(writtenByPreset)).toBe('guided');

    // A choice is remembered as one, and survives a preset change only as long as the preset is not
    // the thing being changed.
    const chosenFull = makeProject({ technicalLevel: 'Intermediate', interfaceMode: 'full', interfaceModeChosen: true });
    expect(interfaceModeOf(chosenFull)).toBe('full');

    // Changing the preset is a fresh start for the interface, and the parts stay independent.
    const afterPreset = withPreset(chosenFull, 'Vibe-coder');
    expect(interfaceModeOf(afterPreset)).toBe('guided');
    expect(afterPreset.interfaceModeChosen).toBe(false);
    expect(autonomyOf(afterPreset)).toBe('Vibe-coder');
  });

  it('keeps the project, agent and mode pickers out of the top bar', async () => {
    // The agent, the interface and the autonomy are project settings picked in the creation wizard;
    // a row of pickers above every screen read as chrome and made the app look like a settings panel.
    // The project's own name was in that bar too, in a dropdown, directly above the sidebar list that
    // already shows the same projects — the same words twice, an inch apart, and the copy on top was
    // the one that truncated first. Choosing a project is the sidebar's job.
    openScreen(makeProject({ interfaceMode: 'full', interfaceModeChosen: true }), '#/');
    await screen.findByTestId('app-title-bar');

    const bar = screen.getByTestId('app-top-bar');
    expect(bar.querySelector('select')).toBeNull();
    expect(bar.textContent).not.toContain('Mode Parts Demo');
    // One banner on the page, and it is the window's own title bar: the strip below it is a strip.
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.queryByLabelText('Интерфейс')).toBeNull();
    expect(screen.queryByLabelText('Автономия ИИ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Когда меняется режим' })).toBeNull();
  });

  it('offers a way out of the helper, which used to have none', async () => {
    openScreen(makeProject({ technicalLevel: 'Intermediate' }), '#/simple');
    await screen.findByText('Простой режим: шаг за шагом');

    // The guided interface hides the pickers — including the one that would switch it back — and
    // revealing the sections in the sidebar only reveals screens. This button is the door.
    expect(screen.queryByLabelText('Интерфейс')).toBeNull();
    const openWorkspace = screen.getByRole('button', { name: 'Полный экран' });

    fireEvent.click(openWorkspace);

    await waitFor(() => expect(savedProject().interfaceMode).toBe('full'));
    expect(savedProject().interfaceModeChosen).toBe(true);
    // The helper is no longer the interface, so the door is gone and the full sections are open.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Полный экран' })).toBeNull());
  }, 20000);

  it('sends the autonomy with an AI request, whatever the interface is', async () => {
    // A technical autonomy behind the guided interface still travels as the technical one.
    const bodies = openScreen(
      makeProject({ technicalLevel: 'Beginner / Non-coder', interfaceMode: 'guided', autonomyLevel: 'Advanced' }),
      '#/compiler'
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Начать' }))[0]);
    await waitFor(() => expect(bodies.some((call) => call.url.includes('/api/prompt/compile'))).toBe(true), {
      timeout: 4000
    });
    const compileCall = () => bodies.find((call) => call.url.includes('/api/prompt/compile')).body;
    expect(compileCall().skillLevel).toBe('Advanced');
    // Nothing about the interface part is sent: it has no say over what the agent is asked for.
    expect(JSON.stringify(compileCall())).not.toContain('guided');
    expect(JSON.stringify(compileCall())).not.toContain('interfaceMode');
  }, 20000);

  it('keeps the beginner autonomy on a technical interface', async () => {
    const bodies = openScreen(
      makeProject({ technicalLevel: 'Advanced', interfaceMode: 'full', autonomyLevel: 'Beginner / Non-coder' }),
      '#/compiler'
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Начать' }))[0]);
    await waitFor(() => expect(bodies.some((call) => call.url.includes('/api/prompt/compile'))).toBe(true), {
      timeout: 4000
    });
    expect(bodies.find((call) => call.url.includes('/api/prompt/compile')).body.skillLevel).toBe(
      'Beginner / Non-coder'
    );
  }, 20000);
});
