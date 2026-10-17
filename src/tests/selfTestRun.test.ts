import { describe, it, expect, afterEach } from 'vitest';

import { isSelfTestRun } from '../utils/selfTest';

/**
 * The app is told who started it, because one thing it draws must not be drawn when it is being
 * checked: the launch animation covers the whole window for the first two and a half seconds, and a
 * check about the window cannot measure a window it cannot see.
 *
 * It used to take the animation out of the document by hand instead. That is a page removing a node
 * React still owns, and when the overlay's own timer then hid it, the removal threw and the whole
 * app came apart — a blank window moments after it had been measured. These tests keep the signal
 * that replaced it honest, including the case that matters most: a browser build must never claim
 * to be a self-test.
 */
describe('a run that is checking itself', () => {
  afterEach(() => {
    delete (window as unknown as { desktopWindow?: unknown }).desktopWindow;
  });

  it('is not what a plain browser build is', () => {
    expect(isSelfTestRun()).toBe(false);
  });

  it('is recognised from the word the shell puts on the page', () => {
    (window as unknown as { desktopWindow?: unknown }).desktopWindow = { selfTest: true };
    expect(isSelfTestRun()).toBe(true);
  });

  it('is not claimed by a browser build that only has the window buttons', () => {
    (window as unknown as { desktopWindow?: unknown }).desktopWindow = {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      isMaximized: async () => false,
      onMaximizedChange: () => () => {}
    };
    expect(isSelfTestRun()).toBe(false);
  });
});
