import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { TitleBar } from '../components/TitleBar';
import { Sidebar } from '../components/Sidebar';
import App from '../App';
import { ProjectState } from '../types';

/**
 * The window's frame and the button that deletes a project.
 *
 * Both are things the desktop self-test also checks in a real window (electron/main.ts); these tests
 * keep the behaviour honest in a plain jsdom run, where there is no Electron to ask.
 */

const project = {
  id: 'p1',
  name: 'Тестовый проект',
  projectType: 'React',
  engineOrFramework: 'React 19',
  language: 'TypeScript',
  selectedAgent: 'Cursor',
  technicalLevel: 'Advanced',
  phases: [],
  projectMap: {
    projectName: 'Тестовый проект',
    projectType: 'React',
    engineOrFramework: 'React 19',
    language: 'TypeScript',
    rulesFiles: [],
    files: []
  },
  recentErrors: [],
  nextBestAction: '',
  rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
} as unknown as ProjectState;

afterEach(() => {
  delete (window as any).desktopWindow;
});

const renderSidebar = (onDeleteProject: (id: string) => void = () => {}) =>
  render(
    <Sidebar
      allProjects={[project]}
      currentProject={project}
      onSelectProject={() => {}}
      onDeleteProject={onDeleteProject}
      activeTab="dashboard"
      setActiveTab={() => {}}
      onOpenNewProjectModal={() => {}}
      onOpenApiSettings={() => {}}
    />
  );

describe('Title bar', () => {
  it('leaves the window controls out of a browser build, where there is no window to control', () => {
    render(<TitleBar />);

    expect(screen.getByTestId('app-title-bar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Свернуть')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Закрыть')).not.toBeInTheDocument();
  });

  it('carries the app mark beside the name, cut out and not a badge', () => {
    renderSidebar();

    const header = screen.getByTestId('app-brand');
    expect(header).toHaveTextContent('Easy Project Compiler');
    const wrapper = screen.getByTestId('app-mark');
    const mark = wrapper.querySelector('img') as HTMLImageElement;
    expect(mark).toBeTruthy();

    // The same bundled file the launch screen uses: the window opens with no network, so a mark
    // fetched from somewhere would be an empty corner on the machine that needs it most.
    expect(mark.getAttribute('src')).toBeTruthy();
    expect(mark.getAttribute('src')).not.toMatch(/^https?:/);

    // Nothing behind it: the picture is cut out, and a plate would make it a badge again.
    expect(wrapper.className).not.toMatch(/\bbg-/);
    expect(mark.className).not.toMatch(/\bbg-/);
    expect(mark.className).toContain('title-mark-img');

    // Dragging the window by the mark must move the window, not start an image drag.
    expect(mark.getAttribute('draggable')).toBe('false');

    // The glint is drawn through the mark's own shape, not over its rectangle.
    const sheen = wrapper.querySelector('.title-mark-sheen') as HTMLElement;
    expect(sheen).toBeTruthy();
    expect(sheen).toHaveAttribute('aria-hidden', 'true');
  });

  it('drives the desktop shell through the window buttons', async () => {
    const bridge = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => () => {})
    };
    (window as any).desktopWindow = bridge;

    render(<TitleBar />);
    await waitFor(() => expect(bridge.isMaximized).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Свернуть'));
    fireEvent.click(screen.getByLabelText('Развернуть'));
    fireEvent.click(screen.getByLabelText('Закрыть'));

    expect(bridge.minimize).toHaveBeenCalledTimes(1);
    expect(bridge.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it('gives the add-a-column plus the title bar, away from the scrolling screen', () => {
    const open = vi.fn();
    const { rerender } = render(<TitleBar onOpenScreenBeside={open} />);

    // Inside the window's own bar: the screen's scrollbar is no place for a control, and a plus
    // floating over a full-bleed panel covered the very thing it was adding a column beside.
    const plus = within(screen.getByTestId('app-title-bar')).getByRole('button', {
      name: 'Открыть экран рядом'
    });
    fireEvent.click(plus);
    expect(open).toHaveBeenCalledTimes(1);

    rerender(<TitleBar onOpenScreenBeside={open} openScreenBesideDisabled />);
    expect(
      within(screen.getByTestId('app-title-bar')).getByRole('button', {
        name: 'Открыть экран рядом'
      })
    ).toBeDisabled();
  });

  it('offers to restore the window once it is maximised', async () => {
    const bridge = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(true),
      onMaximizedChange: vi.fn(() => () => {})
    };
    (window as any).desktopWindow = bridge;

    render(<TitleBar />);

    await waitFor(() => expect(screen.getByLabelText('Восстановить')).toBeInTheDocument());
    expect(screen.queryByLabelText('Развернуть')).not.toBeInTheDocument();
  });
});

describe('Deleting a project', () => {
  it('asks before removing anything', () => {
    const onDeleteProject = vi.fn();
    renderSidebar(onDeleteProject);

    fireEvent.click(screen.getByLabelText('Удалить: Тестовый проект'));

    expect(onDeleteProject).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Удалить проект?')).toBeInTheDocument();
    expect(within(dialog).getByText('Тестовый проект')).toBeInTheDocument();
  });

  it('removes the project once the confirmation is answered', () => {
    const onDeleteProject = vi.fn();
    renderSidebar(onDeleteProject);

    fireEvent.click(screen.getByLabelText('Удалить: Тестовый проект'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Удалить'));

    expect(onDeleteProject).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the project when the confirmation is cancelled', () => {
    const onDeleteProject = vi.fn();
    renderSidebar(onDeleteProject);

    fireEvent.click(screen.getByLabelText('Удалить: Тестовый проект'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Отмена'));

    expect(onDeleteProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Тестовый проект')).toBeInTheDocument();
  });
});

describe('The window shell', () => {
  /*
   * The sidebar is the window's one full-height column. It used to start under the title bar, so a
   * horizontal rule crossed above it and the project switcher read as a block floating between that
   * rule and the groups below — while the vertical divider stopped at the header and left a T-shaped
   * corner with no meaning. These are the three measurements that keep that from coming back.
   */
  it('runs the sidebar from the top of the window and starts the title bar at its edge', () => {
    render(<App />);

    const sidebar = document.querySelector('[data-sidebar]') as HTMLElement;
    const titleBar = screen.getByTestId('app-title-bar');

    expect(sidebar).toBeTruthy();
    expect(sidebar.className).toContain('border-r');
    expect(sidebar.className).toContain('h-full');

    // The name heads the column itself…
    expect(within(sidebar).getByTestId('app-brand')).toHaveTextContent('Easy Project Compiler');

    // …the title bar is beside the column, not a strip running above it…
    expect(sidebar.compareDocumentPosition(titleBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(titleBar.contains(sidebar)).toBe(false);

    // …and no horizontal rule cuts the column into separate blocks.
    expect(sidebar.querySelectorAll('[class*="border-t"]')).toHaveLength(0);
  });
});
