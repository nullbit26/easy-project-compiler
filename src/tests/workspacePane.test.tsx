import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { LanguageProvider } from '../context/LanguageContext';
import { WorkspacePane } from '../components/workspace/WorkspacePane';

/**
 * The pane beside the current screen, through its own DOM.
 *
 * Two things matter and both are visible only when it is drawn: an empty pane offers every screen
 * that is not already on screen (one window per screen), and a pane with a screen names it and can
 * go back to the chooser. No caption explains either — the plus that made the pane is the caption.
 */
describe('A pane beside the screen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('easy_project_compiler_lang', 'ru');
  });

  it('offers the screens that are not already open, and reports the choice', () => {
    const onPick = vi.fn();
    render(
      <LanguageProvider>
        <WorkspacePane
          path={null}
          taken={['/preview']}
          onPick={onPick}
          onClear={() => {}}
          onClose={() => {}}
        />
      </LanguageProvider>
    );

    // The chosen screen is not offered a second time; every other one is a button with a name.
    expect(screen.queryByRole('button', { name: 'Песочница' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'План' }));
    expect(onPick).toHaveBeenCalledWith('/plan');

    // The pane has no title of its own while it waits for a choice — only the way to close it.
    expect(screen.getByTestId('workspace-pane')).toHaveAttribute('data-screen', 'empty');
    expect(screen.queryByTestId('workspace-pane-change')).toBeNull();
  });

  it('names the screen it shows, and the name is the way back to the chooser', () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(
      <LanguageProvider>
        <WorkspacePane
          path="/files"
          taken={['/files']}
          onPick={() => {}}
          onClear={onClear}
          onClose={onClose}
        >
          <div>файлы проекта</div>
        </WorkspacePane>
      </LanguageProvider>
    );

    expect(screen.getByTestId('workspace-pane')).toHaveAttribute('data-screen', '/files');
    expect(screen.getByText('файлы проекта')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workspace-pane-change'));
    expect(onClear).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
    expect(onClose).toHaveBeenCalled();
  });
});
