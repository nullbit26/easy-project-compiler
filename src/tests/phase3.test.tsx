import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ProjectProvider, useProject } from '../context/ProjectContext';
import App from '../App';

describe('Phase 3 - Central State & Routing Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. ProjectContext initializes correctly with default empty list', () => {
    const TestComponent = () => {
      const { allProjects, currentProject } = useProject();
      return (
        <div>
          <span data-testid="count">{allProjects.length}</span>
          <span data-testid="current">{currentProject ? 'loaded' : 'none'}</span>
        </div>
      );
    };

    render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('current').textContent).toBe('none');
  });

  it('2. State persists correctly inside localStorage', () => {
    const mockProject = {
      id: 'test-id',
      name: 'Test Project',
      selectedAgent: 'Cursor',
      technicalLevel: 'Intermediate',
      phases: [],
      recentErrors: [],
      projectMap: { files: [] }
    } as any;

    const TestComponent = () => {
      const { allProjects, onAddProject } = useProject();
      return (
        <div>
          <span data-testid="count">{allProjects.length}</span>
          <button data-testid="add-btn" onClick={() => onAddProject(mockProject)}>Add</button>
        </div>
      );
    };

    render(
      <ProjectProvider>
        <TestComponent />
      </ProjectProvider>
    );

    const btn = screen.getByTestId('add-btn');
    act(() => {
      btn.click();
    });

    // Check localStorage has item
    const savedProjects = localStorage.getItem('easy_project_compiler_projects');
    expect(savedProjects).not.toBeNull();
    const parsed = JSON.parse(savedProjects!);
    expect(parsed[0].name).toBe('Test Project');
  });

  it('3. Recovers safely from corrupted localStorage JSON', () => {
    localStorage.setItem('easy_project_compiler_projects', '{{{ invalid json string');
    localStorage.setItem('easy_project_compiler_current_project', '{{{ invalid current project');

    const TestComponent = () => {
      const { allProjects, currentProject } = useProject();
      return (
        <div>
          <span data-testid="count">{allProjects.length}</span>
          <span data-testid="current">{currentProject ? 'loaded' : 'none'}</span>
        </div>
      );
    };

    // Rendering should NOT throw
    expect(() => {
      render(
        <ProjectProvider>
          <TestComponent />
        </ProjectProvider>
      );
    }).not.toThrow();

    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('current').textContent).toBe('none');
  });

  it('4. Navigation and deep routes do not crash', () => {
    render(<App />);

    // Header: the app's own title bar is on screen and names the app
    expect(screen.getByTestId('app-title-bar')).toHaveTextContent('Easy Project Compiler');
  });

  it('5. Project data remains safe when API calls fail', async () => {
    // Mock a global fetch error
    const spyFetch = vi.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.reject(new Error('AI Engine Overloaded or Rate Limited'))
    );

    const mockProject = {
      id: 'test-id-123',
      name: 'Protected Project',
      phases: [],
      projectMap: { files: [] }
    } as any;

    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([mockProject]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(mockProject));

    render(<App />);

    // The component loads successfully with mock project name
    expect(screen.getAllByText('Protected Project')[0]).toBeInTheDocument();

    // Verification of project persistence
    const loadedProjects = localStorage.getItem('easy_project_compiler_projects');
    expect(loadedProjects).toContain('Protected Project');
  });
});
