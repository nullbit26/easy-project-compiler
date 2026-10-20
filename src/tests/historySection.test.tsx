import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CheckpointTimeline } from '../components/CheckpointTimeline';
import type { WorkspaceChangeset, WorkspaceCheckpoint } from '../services/api';

/**
 * The history is one story, not two.
 *
 * The screen used to stack «Чекпоинты и откат» above «Что было записано»: the same writes, in two
 * different dresses, each taking a heading. A checkpoint is a name on a write, so it now appears on
 * the row it marks — and the whole section is one disclosure, closed by default, because history
 * is something consulted, not the place work happens.
 */

function changeset(overrides: Partial<WorkspaceChangeset> = {}): WorkspaceChangeset {
  return {
    id: 'write-1',
    createdAt: '2026-10-18T12:00:00.000Z',
    root: 'C:/projects/demo',
    fileCount: 1,
    applied: 1,
    failed: 0,
    paths: ['src/index.ts'],
    ...overrides
  };
}

const writes = [
  changeset({ id: 'write-2', createdAt: '2026-10-18T13:00:00.000Z', paths: ['src/menu.ts'] }),
  changeset({ id: 'write-1' })
];

const checkpoints: WorkspaceCheckpoint[] = [
  { id: 'cp-1', name: 'Меню работает', createdAt: '2026-10-18T13:00:01.000Z', changesetId: 'write-2' }
];

function renderHistory(overrides: Partial<React.ComponentProps<typeof CheckpointTimeline>> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onRollback: vi.fn(),
    onDelete: vi.fn(),
    onUndoChangeset: vi.fn()
  };
  render(
    <CheckpointTimeline
      ru
      checkpoints={checkpoints}
      timeline={writes}
      busy={false}
      busyId={null}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

const toggle = () => screen.getByRole('button', { name: /История/ });

describe('History section', () => {
  it('1. stays closed until asked, and keeps its count on the closed row', () => {
    renderHistory();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('2')).toBeTruthy();
    // Closed means closed: no rows, no checkpoint controls, no name field.
    expect(screen.queryByText('Меню работает')).toBeNull();
    expect(screen.queryByText('Откатить сюда')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('2. shows one feed, with the checkpoint on the write it marks', () => {
    renderHistory();
    fireEvent.click(toggle());

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const rows = document.querySelectorAll('[data-history-row]');
    expect(rows).toHaveLength(2);
    // The checkpoint is a marker inside the write row, not a second list with its own heading.
    expect(rows[0].textContent).toContain('Меню работает');
    expect(screen.queryByText('Что было записано')).toBeNull();
    expect(screen.queryByText('Чекпоинты и откат')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Отменить только эту запись' })).toHaveLength(2);
  });

  it('3. marks a point with the name that was typed, and clears the field', () => {
    const { onCreate } = renderHistory();
    fireEvent.click(toggle());

    const field = screen.getByRole('textbox', { name: 'Название точки' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '  Меню работает  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отметить точку' }));

    expect(onCreate).toHaveBeenCalledWith('Меню работает');
    expect(field.value).toBe('');
  });

  it('4. asks before rolling back, and only then undoes the writes after the point', () => {
    const { onRollback, onDelete } = renderHistory();
    fireEvent.click(toggle());

    fireEvent.click(screen.getByRole('button', { name: 'Откатить сюда' }));
    expect(onRollback).not.toHaveBeenCalled();
    expect(screen.getByText(/Все записи после этой точки будут отменены/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Да, откатить' }));
    expect(onRollback).toHaveBeenCalledWith('cp-1');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('5. keeps a point whose write has fallen out of the list the screen shows', () => {
    renderHistory({
      checkpoints: [
        { id: 'cp-old', name: 'Первый запуск', createdAt: '2026-10-15T15:02:43.000Z', changesetId: 'long-gone' }
      ]
    });
    fireEvent.click(toggle());

    const older = document.querySelector('[data-history-older]');
    expect(older?.textContent).toContain('Первый запуск');
    // A point that cannot be reached is not a way back.
    expect(screen.getByRole('button', { name: 'Откатить сюда' })).toBeTruthy();
  });

  it('6. keeps a point taken before the first write, and does not lose it in the feed', () => {
    renderHistory({
      checkpoints: [
        { id: 'cp-start', name: 'Чистый проект', createdAt: '2026-10-17T09:00:00.000Z', changesetId: null }
      ]
    });
    fireEvent.click(toggle());

    const start = document.querySelector('[data-history-start]');
    expect(start?.textContent).toContain('Чистый проект');
    expect(screen.getByText('Состояние до первой записи')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Откатить сюда' })).toBeTruthy();
  });
});
