import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ProjectProvider, useProject } from '../context/ProjectContext';
import { LanguageProvider } from '../context/LanguageContext';
import type { ProjectState } from '../types';

/**
 * A project from the canvas demo has a plan, a folder and no map at all.
 *
 * Syncing the folder used to read `projectMap.files` straight off that project and throw
 * "Cannot read properties of undefined (reading 'files')" — which the helper then reported as a
 * failed file write, because creating the first file ends with that same sync. The folder is the
 * truth about the files, so the map is built from the project's own identity the first time it is
 * needed.
 */
const bareProject = {
  id: 'p_no_map',
  name: 'Island Survival 3D (Unity)',
  projectType: 'Unity',
  engineOrFramework: 'Unity',
  language: 'C#',
  selectedAgent: 'Cursor',
  technicalLevel: 'Beginner / Non-coder',
  interfaceMode: 'guided',
  nextBestAction: 'Start',
  brief: {
    id: 'b1',
    projectName: 'Island Survival 3D (Unity)',
    tagline: '',
    targetAudience: '',
    coreProblem: '',
    coreValue: '',
    mvpFeatures: [],
    futureFeatures: [],
    nonGoals: [],
    technicalConstraints: [],
    successCriteria: []
  },
  phases: [{ id: 'p0', phaseNumber: 1, title: 'Этап 1', purpose: '', deliverable: '', tasks: [] }],
  recentErrors: [],
  rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
} as unknown as ProjectState;

function Probe() {
  const { currentProject, onSyncProjectFiles, onUpdateProjectFiles } = useProject();
  return (
    <div>
      <button
        onClick={() =>
          onSyncProjectFiles(
            [{ path: 'Assets/Scripts/Main.cs', type: 'code', description: '. • 12 B' }],
            'C:/island-project'
          )
        }
      >
        sync
      </button>
      <button onClick={() => onUpdateProjectFiles([{ path: 'Assets/Scripts/Hunger.cs', content: 'class Hunger {}' }])}>
        write
      </button>
      <span data-files>{(currentProject?.projectMap?.files || []).map((file) => file.path).join(',')}</span>
      <span data-root>{currentProject?.workspaceRoot || ''}</span>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(bareProject));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([bareProject]));
  vi.restoreAllMocks();
});

describe('A project with no map still follows its folder', () => {
  it('creates the map on the first sync, with the files the folder really has', () => {
    render(
      <LanguageProvider>
        <ProjectProvider>
          <Probe />
        </ProjectProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('', { selector: '[data-files]' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sync' }));

    expect(screen.getByText('Assets/Scripts/Main.cs')).toBeInTheDocument();
    expect(screen.getByText('C:/island-project')).toBeInTheDocument();
  });

  it('appends a file the agent wrote without losing the ones the folder had', () => {
    render(
      <LanguageProvider>
        <ProjectProvider>
          <Probe />
        </ProjectProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(screen.getByText('Assets/Scripts/Main.cs,Assets/Scripts/Hunger.cs')).toBeInTheDocument();
  });
});
