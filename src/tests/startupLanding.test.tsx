import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * Where the app opens.
 *
 * Nothing saved yet: the step-by-step helper, because it is the only screen with something to do on
 * it. Saved projects: the dashboard, on the project that was last worked on.
 */

const project = {
  id: 'p-landing',
  name: 'Демо-проект',
  projectType: 'React',
  engineOrFramework: 'React 19',
  language: 'TypeScript',
  selectedAgent: 'Cursor',
  technicalLevel: 'Vibe-coder',
  phases: [],
  projectMap: {
    projectName: 'Демо-проект',
    projectType: 'React',
    engineOrFramework: 'React 19',
    language: 'TypeScript',
    rulesFiles: [],
    files: []
  },
  recentErrors: [],
  nextBestAction: 'Сделать первую задачу',
  rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/';
  // None of these screens needs a real server: the app asks for its own state on the way in.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: {} })
  } as unknown as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Where the app opens', () => {
  it('opens the step-by-step helper when nothing is saved yet', async () => {
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe('#/simple'));
    expect(await screen.findByText('Сначала создайте проект')).toBeInTheDocument();
    expect(screen.getByText('Опишите идею — приложение само предложит план и файлы.')).toBeInTheDocument();
  });

  it('opens the dashboard when projects are saved', async () => {
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));

    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'));
    // The dashboard's own project header, so this is the dashboard with the project open — not
    // just the name showing up in the sidebar.
    expect(await screen.findByText('Готовность MVP')).toBeInTheDocument();
    expect((await screen.findAllByText('Демо-проект')).length).toBeGreaterThan(0);
  });

  it('keeps the dashboard for a beginner project that was already there', async () => {
    const beginner = { ...project, id: 'p-beginner', technicalLevel: 'Beginner / Non-coder' };
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([beginner]));
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(beginner));

    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'));
    expect(await screen.findByText('Готовность MVP')).toBeInTheDocument();
  });

  it('opens a project that really exists when the remembered one is gone', async () => {
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem(
      'easy_project_compiler_current_project',
      JSON.stringify({ ...project, id: 'p-deleted', name: 'Удалённый проект' })
    );

    render(<App />);

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || 'null')?.id).toBe('p-landing')
    );
  });

  it('leaves a link straight to one screen alone', async () => {
    window.location.hash = '#/plan';

    render(<App />);

    // A deliberate destination (a reload on a deep link) is not the start-up landing.
    await waitFor(() => expect(window.location.hash).toBe('#/plan'));
  });
});
