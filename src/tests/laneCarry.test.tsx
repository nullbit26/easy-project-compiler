import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';

import { ProjectProvider, useProject } from '../context/ProjectContext';
import { LanguageProvider } from '../context/LanguageContext';

/**
 * A zone and the cards lying on it are one gesture, and the project is the one place that has to
 * agree.
 *
 * Every writer in `ProjectContext` rebuilds the project from the copy it read when the screen
 * rendered, so two writes raised by one drag do not add up: the second is built from a project that
 * never saw the first. That is not a hypothetical — dragging a zone stored the zone and silently
 * dropped the cards it had carried, because the card write went out first and the lane write then
 * replaced the whole project with the version it still remembered.
 *
 * This test is about that contract rather than about the board's arithmetic: one call carries both
 * changes, and both survive.
 */

const PROJECT = {
  id: 'p_carry',
  name: 'Carry demo',
  canvasLanes: { done: { label: 'Сделано' } },
  phases: [
    {
      id: 'ph1',
      phaseNumber: 1,
      title: 'Core',
      purpose: '',
      deliverable: '',
      tasks: [
        { id: 't1', phaseId: 'ph1', title: 'First', status: 'ready', canvasPosition: { x: 20, y: 56 } },
        { id: 't2', phaseId: 'ph1', title: 'Second', status: 'ready' }
      ]
    }
  ]
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <ProjectProvider>{children}</ProjectProvider>
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([PROJECT]));
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(PROJECT));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
});

describe('Moving a zone and the cards it carries', () => {
  it('1. writes the zone and the cards on it in one update, keeping both', () => {
    const { result } = renderHook(() => useProject(), { wrapper });

    act(() => {
      result.current.onUpdateCanvasLanes({ done: { label: 'Сделано' }, ready: { offsetY: 140 } }, {
        t1: { x: 20, y: 196 }
      });
    });

    const project = result.current.currentProject!;
    // The zone is where it was dragged…
    expect(project.canvasLanes?.ready?.offsetY).toBe(140);
    // …the cards it carried moved with it…
    const t1 = project.phases[0].tasks.find((task) => task.id === 't1')!;
    expect(t1.canvasPosition).toEqual({ x: 20, y: 196 });
    // …and the lanes nobody touched are exactly as they were.
    expect(project.canvasLanes?.done?.label).toBe('Сделано');
  });

  it('2. leaves a card nobody carried without a position of its own', () => {
    const { result } = renderHook(() => useProject(), { wrapper });

    act(() => {
      result.current.onUpdateCanvasLanes({ ready: { offsetY: 140 } });
    });

    const project = result.current.currentProject!;
    expect(project.canvasLanes?.ready?.offsetY).toBe(140);
    // A plan may still lay out the cards it has never been told about; writing a position for one
    // would freeze it where it happened to be.
    expect(project.phases[0].tasks.find((task) => task.id === 't2')?.canvasPosition).toBeUndefined();
    expect(project.phases[0].tasks.find((task) => task.id === 't1')?.canvasPosition).toEqual({ x: 20, y: 56 });
  });
});
