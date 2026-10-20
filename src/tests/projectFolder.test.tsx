import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/api', () => {
  // Both names are the same server answer: the screens read through the gate, the repair reads
  // around it, and neither should see a different folder here.
  const workspaceRead = vi.fn();
  return {
    fetchWorkspaceApi: workspaceRead,
    readWorkspaceApi: workspaceRead,
    bindWorkspaceApi: vi.fn()
  };
});

import { fetchWorkspaceApi, bindWorkspaceApi } from '../services/api';
import { connectProjectFolder, sameFolder } from '../services/projectFolder';
import { ProjectProvider, useProject } from '../context/ProjectContext';
import { LanguageProvider } from '../context/LanguageContext';

const fetchWorkspace = fetchWorkspaceApi as unknown as ReturnType<typeof vi.fn>;
const bindWorkspace = bindWorkspaceApi as unknown as ReturnType<typeof vi.fn>;

const empty = (root: string | null) => ({ root, files: [], backups: [], timeline: [] });

/**
 * One connected folder, and the project that owns it.
 *
 * The server is the source every screen reads from (Files, Git, checks, preview, the studio, the Auto
 * run all go through `/api/files/workspace`), but the project list is what survives a restart. These
 * tests pin the one place that reconciles the two, so a data folder that came up empty, or a switch
 * to another project, cannot leave the windows disagreeing about which code they are looking at.
 */
describe('Which folder the project works in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchWorkspace.mockResolvedValue(empty(null));
    bindWorkspace.mockImplementation(async ({ path }: { path: string }) => empty(path));
  });

  it('1. leaves the server alone when it already holds the project’s folder', async () => {
    fetchWorkspace.mockResolvedValue(empty('C:\\demo\\game'));

    const result = await connectProjectFolder({ workspaceRoot: 'c:/demo/GAME/' }, 'ru');

    expect(result.root).toBe('C:\\demo\\game');
    expect(bindWorkspace).not.toHaveBeenCalled();
  });

  it('2. connects the project’s folder when the server came up without one', async () => {
    const result = await connectProjectFolder({ workspaceRoot: 'C:\\demo\\game' }, 'ru');

    expect(bindWorkspace).toHaveBeenCalledWith({ path: 'C:\\demo\\game', language: 'ru' });
    expect(result.root).toBe('C:\\demo\\game');
    expect(result.connected).toBe('C:\\demo\\game');
  });

  it('3. moves the connected folder to the project that was opened, not the one before it', async () => {
    fetchWorkspace.mockResolvedValue(empty('C:\\previous-project'));

    await connectProjectFolder({ workspaceRoot: 'C:\\next-project' }, 'ru');

    // Opening another project with the first one's folder still connected would show — and write
    // into — the wrong code, which is what every screen asking the server would then agree on.
    expect(bindWorkspace).toHaveBeenCalledWith({ path: 'C:\\next-project', language: 'ru' });
  });

  it('4. never takes over a folder another project has when the caller may not', async () => {
    fetchWorkspace.mockResolvedValue(empty('D:/another-project'));

    const result = await connectProjectFolder({ workspaceRoot: 'C:\\demo\\game' }, 'ru', {
      bindWhenDifferent: false
    });

    // The Auto run refuses this situation instead of quietly switching: this is the safety net for
    // the case where the folder was moved by something other than opening the project.
    expect(bindWorkspace).not.toHaveBeenCalled();
    expect(result.root).toBe('D:/another-project');
    expect(result.connected).toBeUndefined();
  });

  it('5. reports a folder that is gone without pretending it is connected', async () => {
    fetchWorkspace.mockResolvedValue(empty('D:/still-connected'));
    const failure = Object.assign(new Error('The folder does not exist'), {
      status: 404,
      userMessage: 'Такой папки или файла не существует.'
    });
    bindWorkspace.mockRejectedValueOnce(failure);

    const result = await connectProjectFolder({ workspaceRoot: 'C:\\demo\\gone' }, 'ru');

    expect(result.root).toBe('D:/still-connected');
    expect(result.error).toBe(failure);
    expect(result.connected).toBeUndefined();
  });

  it('6. connects once when two screens open at the same moment', async () => {
    const [a, b] = await Promise.all([
      connectProjectFolder({ workspaceRoot: 'C:\\demo\\game' }, 'ru'),
      connectProjectFolder({ workspaceRoot: 'c:/demo/game' }, 'ru')
    ]);

    expect(bindWorkspace).toHaveBeenCalledTimes(1);
    expect(a.root).toBe('C:\\demo\\game');
    expect(b.root).toBe('C:\\demo\\game');
  });

  it('7. compares Windows paths without case or separator surprises', () => {
    expect(sameFolder('C:\\Demo\\Game', 'c:/demo/game/')).toBe(true);
    expect(sameFolder('C:\\demo\\game', 'C:\\demo\\game-2')).toBe(false);
    expect(sameFolder(null, 'C:\\demo\\game')).toBe(false);
  });
});

/** Everything the provider knows, on screen: the project, and a button for each one. */
const Probe: React.FC = () => {
  const { currentProject, allProjects, onSelectProject } = useProject();
  return (
    <div>
      <span data-testid="current">{currentProject?.id ?? ''}</span>
      <span data-testid="root">{currentProject?.workspaceRoot ?? ''}</span>
      {allProjects.map((project) => (
        <button key={project.id} onClick={() => onSelectProject(project)}>
          {project.name}
        </button>
      ))}
    </div>
  );
};

function project(id: string, name: string, workspaceRoot?: string) {
  return { id, name, phases: [], workspaceRoot };
}

function renderProvider() {
  return render(
    <LanguageProvider>
      <ProjectProvider>
        <Probe />
      </ProjectProvider>
    </LanguageProvider>
  );
}

describe('The folder follows the project that is open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('easy_project_compiler_lang', 'ru');
    fetchWorkspace.mockResolvedValue(empty(null));
    bindWorkspace.mockImplementation(async ({ path }: { path: string }) => empty(path));
  });

  it('8. restores the folder of the project this run started on', async () => {
    const saved = project('p1', 'Saved', 'C:\\saved-project');
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([saved]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(saved));

    renderProvider();

    // A restart whose data file is empty used to leave every screen saying "no folder" while the
    // project still remembered its own path; the project is what repairs it now.
    await waitFor(() =>
      expect(bindWorkspace).toHaveBeenCalledWith({ path: 'C:\\saved-project', language: 'ru' })
    );
  });

  it('9. connects the folder of the project the user selects', async () => {
    const first = project('p1', 'First', 'C:\\first-project');
    const second = project('p2', 'Second', 'C:\\second-project');
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([first, second]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(first));

    renderProvider();
    await waitFor(() => expect(bindWorkspace).toHaveBeenCalledWith({ path: 'C:\\first-project', language: 'ru' }));

    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    await waitFor(() =>
      expect(bindWorkspace).toHaveBeenCalledWith({ path: 'C:\\second-project', language: 'ru' })
    );
    expect(screen.getByTestId('root')).toHaveTextContent('C:\\second-project');
  });

  it('10. leaves the connected folder alone for a project that never had one', async () => {
    // The app has exactly one folder; a project without a recorded path works in it rather than
    // inventing a second one or clearing the folder another screen is showing.
    const loose = project('p3', 'Loose');
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([loose]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(loose));
    fetchWorkspace.mockResolvedValue(empty('D:/the-connected-folder'));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('p3'));

    expect(bindWorkspace).not.toHaveBeenCalled();
  });
});
