import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { Sidebar } from '../components/Sidebar';
import { ProjectState } from '../types';

/**
 * The folded panel.
 *
 * Folded, the sidebar is a strip of icons: the words go, the controls stay. What is pinned here is
 * that each icon still carries the name of the screen it opens (so the entry is a control and not a
 * picture), that the project rows survive as their initials, and that the way back is one click.
 */

const project = {
  id: 'p1',
  name: 'Island Survival 3D (Unity)',
  projectType: 'Unity',
  engineOrFramework: 'Unity 6',
  language: 'C#',
  selectedAgent: 'Cursor',
  technicalLevel: 'Advanced',
  phases: [],
  projectMap: {
    projectName: 'Island Survival 3D (Unity)',
    projectType: 'Unity',
    engineOrFramework: 'Unity 6',
    language: 'C#',
    rulesFiles: [],
    files: []
  },
  recentErrors: [],
  nextBestAction: '',
  rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
} as unknown as ProjectState;

const renderFolded = (overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) => {
  const props = {
    allProjects: [project],
    currentProject: project,
    onSelectProject: vi.fn(),
    onDeleteProject: vi.fn(),
    activeTab: 'project_plan',
    setActiveTab: vi.fn(),
    onOpenNewProjectModal: vi.fn(),
    onOpenApiSettings: vi.fn(),
    onToggleCollapsed: vi.fn(),
    collapsed: true,
    ...overrides
  };
  const view = render(<Sidebar {...props} />);
  return { ...props, ...view };
};

describe('the folded sidebar', () => {
  it('keeps every entry as a named control instead of a bare icon', () => {
    renderFolded();

    expect(document.querySelector('[data-sidebar-rail]')).toBeTruthy();

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', { name: 'Пошаговый помощник' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'План и задачи' })).toBeInTheDocument();
  });

  it('opens a screen from the strip and offers the way back', () => {
    const { setActiveTab, onToggleCollapsed } = renderFolded();

    fireEvent.click(screen.getByRole('button', { name: 'Пошаговый помощник' }));
    expect(setActiveTab).toHaveBeenCalledWith('simple_flow');

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть панель' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('names the project by its initials, with the full name still in reach', () => {
    const { onSelectProject } = renderFolded();

    const row = screen.getByRole('button', { name: 'Island Survival 3D (Unity)' });
    expect(row).toHaveTextContent('IS');

    fireEvent.click(row);
    expect(onSelectProject).toHaveBeenCalledWith(project);
  });
});
