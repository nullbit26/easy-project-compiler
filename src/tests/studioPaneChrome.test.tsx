import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import React from 'react';

import { StudioScreen } from '../components/studio/StudioScreen';
import { presetState, serializeStudioState, STUDIO_STORAGE_KEY } from '../components/studio/studioLayout';

/**
 * One header per window, not two.
 *
 * Every pane used to open with a header of its own — a small label and three buttons — sitting
 * directly on top of the header the panel inside it already drew: the plan's filter row, the
 * preview's entry and rebuild, the checks strip's title. A titled tab inside a titled tab, and two
 * rows of chrome over content that was the point of the split. The window's controls now ride at the
 * end of the panel's own header, so these tests guard both halves of that: the controls are inside
 * each pane, and the pane label above the panel is gone.
 */

const project = {
  id: 'pane-chrome-demo',
  name: 'Pane Chrome Demo',
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
        }
      ]
    }
  ]
} as any;

const renderStudio = () =>
  render(
    <StudioScreen
      project={project}
      onUpdateTaskStatus={() => {}}
      onUpdateTaskPositions={() => {}}
      onCompileTaskPrompt={() => {}}
      onAddTask={() => {}}
    />
  );

describe('Studio windows draw one header each', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    // The four-pane arrangement: plan, preview, checks and the autopilot log, all at once.
    localStorage.setItem(STUDIO_STORAGE_KEY, serializeStudioState(presetState('studio')));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }) as unknown as Response)
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('puts the window controls inside each panel instead of a row above it', () => {
    renderStudio();

    for (const slot of ['a', 'b', 'c', 'd']) {
      const pane = screen.getByTestId(`studio-pane-${slot}`);
      expect(within(pane).getByTestId(`studio-pane-actions-${slot}`)).toBeInTheDocument();
      // One copy per pane, and it is the pane's own: not a header that the split layout draws.
      expect(within(pane).getAllByRole('button', { name: 'Сменить окно' })).toHaveLength(1);
      expect(within(pane).getByRole('button', { name: 'Развернуть окно' })).toBeInTheDocument();
      expect(within(pane).getByRole('button', { name: 'Закрыть окно' })).toBeInTheDocument();
      // And no focus outline around the pane: a ring inside the studio's own border is one frame
      // too many, drawn straight across the toolbar's first row.
      expect(pane.className).not.toMatch(/ring-1/);
    }
  });

  it('draws the split as the window, with no frame or inset around it', () => {
    renderStudio();

    // A rounded, bordered container around the panes was one window inside another: its top edge
    // ran just above the plan's toolbar, over a screen that is already the whole workspace.
    const split = screen.getByTestId('studio-split');
    expect(split.className).not.toMatch(/\bborder\b/);
    expect(split.className).not.toMatch(/rounded/);
  });

  it('lends the plan\'s window controls to the plan toolbar, with no label above it', () => {
    renderStudio();

    const pane = screen.getByTestId('studio-pane-a');
    const toolbar = within(pane).getByTestId('plan-toolbar');
    expect(within(toolbar).getByRole('button', { name: 'Сменить окно' })).toBeInTheDocument();
    expect(within(toolbar).getByTestId('studio-pane-actions-divider')).toBeInTheDocument();

    // The old header rendered the panel's name over a panel that already says what it is.
    expect(within(pane).queryByText('ПЛАН')).toBeNull();
    // The toolbar is the board's first row: no chrome row was left above it for the pane to draw.
    expect(toolbar.parentElement?.firstElementChild).toBe(toolbar);

    // No card inside the pane either: the pane is the frame, the board runs to its edges.
    const board = within(pane).getByTestId('plan-board');
    expect(board.className).not.toMatch(/\bborder\b/);
    expect(board.className).not.toMatch(/rounded-2xl/);
  });

  it('draws no close control when the studio holds a single window', () => {
    localStorage.setItem(STUDIO_STORAGE_KEY, serializeStudioState(presetState('focus')));
    renderStudio();

    const pane = screen.getByTestId('studio-pane-a');
    expect(within(pane).getByRole('button', { name: 'Развернуть окно' })).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Закрыть окно' })).toBeNull();
  });
});
