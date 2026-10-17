import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';

const Boom: React.FC = () => {
  throw new Error('render exploded');
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary title="t" hint="h" retryLabel="r">
        <span>healthy panel</span>
      </ErrorBoundary>
    );

    expect(screen.getByText('healthy panel')).toBeInTheDocument();
    expect(screen.queryByText('t')).not.toBeInTheDocument();
  });

  it('2. Shows the local fallback instead of letting the error escape', () => {
    render(
      <ErrorBoundary title="Раздел упал" hint="остальное работает" retryLabel="Перерисовать">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Раздел упал')).toBeInTheDocument();
    expect(screen.getByText('остальное работает')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Перерисовать/ })).toBeInTheDocument();
    // The technical message stays visible for the user, not silently swallowed.
    expect(screen.getByText('render exploded')).toBeInTheDocument();
  });

  it('3. Sibling content outside the boundary keeps rendering', () => {
    render(
      <div>
        <span>sidebar stays alive</span>
        <ErrorBoundary title="t" hint="h" retryLabel="r">
          <Boom />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByText('sidebar stays alive')).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument();
  });
});
