import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

import App from '../App';
import { LaunchSplash } from '../components/LaunchSplash';

/**
 * The launch screen's promises, in the order a user meets them: it says what is starting, the app is
 * behind it and untouched, it goes away by itself, and anything the user does ends the wait.
 *
 * The animation itself (the fade, the drift, the blur) is CSS and is watched by eye in the preview;
 * what is testable — and what actually breaks — is the timeline that takes the overlay out of the
 * document, and the fact that it never needs anything from the network to draw.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Starting the app', () => {
  it('1. says what is starting: the mark, the name, and what the app is', () => {
    render(<LaunchSplash leaveAtMs={100000} />);

    const splash = screen.getByTestId('launch-splash');
    expect(splash.getAttribute('data-phase')).toBe('playing');
    expect(splash).toHaveAttribute('role', 'status');

    expect(screen.getByTestId('launch-name')).toHaveTextContent('Easy Project Compiler');
    expect(screen.getByTestId('launch-tagline')).toHaveTextContent('AI MVP Architect');

    const mark = screen.getByTestId('launch-logo') as HTMLImageElement;
    expect(mark.getAttribute('src')).toBeTruthy();
    // The mark is bundled with the app: a splash that fetches its own logo is a splash that shows
    // nothing on a machine with no network — and the desktop build promises to start offline.
    expect(mark.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('2. draws over the app without taking it away', () => {
    render(
      <>
        <App />
        <LaunchSplash leaveAtMs={100000} />
      </>
    );

    // Both are on screen: the app has already built its own window chrome behind the animation.
    expect(screen.getByTestId('app-title-bar')).toHaveTextContent('Easy Project Compiler');
    expect(screen.getByTestId('launch-splash')).toBeTruthy();
  });

  it('3. leaves on its own, and takes itself out of the document', () => {
    vi.useFakeTimers();
    render(<LaunchSplash leaveAtMs={2000} fadeMs={400} />);

    expect(screen.getByTestId('launch-splash').getAttribute('data-phase')).toBe('playing');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Fading out is a phase of its own: the app underneath is visible while it goes.
    expect(screen.getByTestId('launch-splash').getAttribute('data-phase')).toBe('leaving');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });

  it('4. ends the wait when the user does anything at all', () => {
    vi.useFakeTimers();
    render(<LaunchSplash leaveAtMs={100000} fadeMs={300} />);

    // The pointer going down anywhere — including on the animation itself, which is why it listens
    // on the window rather than on its own box.
    fireEvent.pointerDown(window);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });

  it('5. is finished by a key press, without waiting for the pointer', () => {
    vi.useFakeTimers();
    render(<LaunchSplash leaveAtMs={100000} fadeMs={300} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('launch-splash')).toBeNull();
  });
});
