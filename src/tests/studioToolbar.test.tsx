import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import React from 'react';

import { TitleBar } from '../components/TitleBar';
import { StudioScreen } from '../components/studio/StudioScreen';
import { presetState, serializeStudioState, STUDIO_STORAGE_KEY } from '../components/studio/studioLayout';

/**
 * The studio's window controls live in the app's title bar.
 *
 * They used to be a row of their own between the title bar and the panes: two rows of chrome above
 * the content, the first one empty once the studio had drawn its tools. The bar is already there,
 * so the tools are mounted into it — provided here as a slot, because the bar knows nothing about
 * the studio's state and the studio knows nothing about the window's controls.
 *
 * What this guards: the tools are in the bar, there is exactly one copy of them, and a studio
 * rendered without a title bar (a test, an older shell) still shows them rather than losing them.
 */

const project = {
  id: 'studio-tools-demo',
  name: 'Studio Tools Demo',
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

/** Just the controls, so the test does not depend on the default arrangement's panes. */
const renderStudio = () =>
  render(
    <>
      <TitleBar />
      <StudioScreen
        project={project}
        onUpdateTaskStatus={() => {}}
        onUpdateTaskPositions={() => {}}
        onCompileTaskPrompt={() => {}}
        onAddTask={() => {}}
      />
    </>
  );

describe('The studio tools in the title bar', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    // One pane: the tools are what this test looks at, not the four-pane arrangement.
    localStorage.setItem(STUDIO_STORAGE_KEY, serializeStudioState(presetState('focus')));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }) as unknown as Response)
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mounts the tools into the title bar instead of a row of their own', () => {
    renderStudio();

    const bar = screen.getByTestId('app-title-bar');
    const tools = within(bar).getByTestId('studio-tools');
    expect(tools).toBeInTheDocument();

    // All of them, not just the first: adding, the three arrangements and the reset.
    for (const name of ['Новое окно справа', 'Новое окно снизу', 'Сбросить раскладку']) {
      expect(within(tools).getByRole('button', { name })).toBeInTheDocument();
    }

    // One copy, in the bar: a second row above the panes is the double header this removes.
    expect(document.querySelectorAll('[data-testid="studio-tools"]')).toHaveLength(1);
    expect(tools.closest('[data-testid="app-title-bar"]')).not.toBeNull();
  });

  it('leaves the title bar alone while the studio is kept behind another screen', () => {
    renderStudio();
    expect(within(screen.getByTestId('app-title-bar')).queryByTestId('studio-tools')).not.toBeNull();

    // The screen stays mounted behind another one; its tools must not stay in the bar with it.
    cleanup();
    render(
      <>
        <TitleBar />
        <StudioScreen
          active={false}
          project={project}
          onUpdateTaskStatus={() => {}}
          onUpdateTaskPositions={() => {}}
          onCompileTaskPrompt={() => {}}
          onAddTask={() => {}}
        />
      </>
    );

    expect(within(screen.getByTestId('app-title-bar')).queryByTestId('studio-tools')).toBeNull();
  });

  it('keeps the tools when the studio is drawn without a title bar', () => {
    render(
      <StudioScreen
        project={project}
        onUpdateTaskStatus={() => {}}
        onUpdateTaskPositions={() => {}}
        onCompileTaskPrompt={() => {}}
        onAddTask={() => {}}
      />
    );

    // Nothing to mount into: the controls fall back to their own row rather than disappear.
    expect(screen.getByTestId('studio-tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сбросить раскладку' })).toBeInTheDocument();
  });
});
