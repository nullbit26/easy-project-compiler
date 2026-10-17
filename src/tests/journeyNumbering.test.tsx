import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../App';
import type { ProjectState } from '../types';
import { translations } from '../i18n/translations';
import { JOURNEY_STEPS, journeyHeading, journeyNumber, journeySentence } from '../utils/journeySteps';

/**
 * One journey, one count.
 *
 * The step-by-step helper and the workspace loop used to number their screens apart: the helper
 * called the folder step 1 and the finished prompt step 3, while the workspace loop called that same
 * prompt "Шаг 1: Компиляция промпта" and the check "Шаг 2". Switching interfaces restarted the
 * count, so the same act wore two numbers.
 *
 * What is pinned here is that both interfaces read the journey's numbers from `utils/journeySteps`:
 * the folder is step 1, the prompt is step 3 and the check is step 4 — on whichever screen they
 * appear.
 */

const ru = translations.ru;
const en = translations.en;

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'journey-demo',
    name: 'Journey Demo',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Advanced',
    interfaceMode: 'full',
    interfaceModeChosen: true,
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Journey Demo',
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
      projectName: 'Journey Demo',
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

/** Opens one screen of a loaded project. No folder is connected, so the helper stays on step 1. */
function openScreen(hash: string) {
  const project = makeProject();
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = hash;

  vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const data = url.includes('/api/files/workspace')
      ? { root: null, files: [], backups: [], timeline: [], checkpoints: [] }
      : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as unknown as Response);
  });

  render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The journey has one set of numbers', () => {
  it('1. orders the four steps once, and words each one the same way in both languages', () => {
    expect(JOURNEY_STEPS).toEqual(['folder', 'task', 'prompt', 'check']);
    JOURNEY_STEPS.forEach((step, index) => expect(journeyNumber(step)).toBe(index + 1));

    expect(journeyHeading('prompt', ru)).toBe('Шаг 3: Промпт');
    expect(journeyHeading('check', ru)).toBe('Шаг 4: Проверка');
    expect(journeyHeading('prompt', en)).toBe('Step 3: Prompt');
    expect(journeyHeading('check', en)).toBe('Step 4: Check');

    // The helper keeps its own sentence, but the number comes from the same place.
    expect(journeySentence('folder', ru, ru.simple.folderTitle)).toBe('Шаг 1. Где лежат файлы вашего проекта?');
  });

  it('2. numbers the workspace loop with the helper’s count instead of starting again at 1', async () => {
    openScreen('#/compiler');
    expect(await screen.findByText('Шаг 3: Промпт')).toBeInTheDocument();
    expect(screen.queryByText('Шаг 1: Компиляция промпта')).toBeNull();
  }, 20000);

  it('3. gives the check the same number in the loop, and points back with the prompt’s number', async () => {
    openScreen('#/review');
    expect(await screen.findByText('Шаг 4: Проверка')).toBeInTheDocument();
    expect(screen.getByText('← Шаг 3: Промпт')).toBeInTheDocument();
  }, 20000);

  it('4. starts the helper on step 1, with the same four names the loop uses', async () => {
    openScreen('#/simple');

    // The folder is step 1 of the journey, on the helper exactly as in the module.
    expect(await screen.findByText('Шаг 1. Где лежат файлы вашего проекта?')).toBeInTheDocument();
    // The four step tabs carry the journey's own names.
    for (const label of ['Папка', 'Задача', 'Промпт', 'Проверка']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  }, 20000);
});
