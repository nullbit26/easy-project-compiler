/**
 * The only bridge between the page and the desktop shell.
 *
 * It exposes the three window buttons of the app's own title bar and whether the window is
 * maximised (so the middle button can show the right icon). Nothing else: the page keeps running
 * exactly as it does in a browser, with no access to Node, to the file system or to the shell.
 *
 * Bundled next to main.cjs by tools/desktop/build-desktop.mjs and loaded with `sandbox: true`.
 */
import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL = 'epc:window';
const STATE_CHANNEL = 'epc:window:maximized';

/**
 * Whether this run is the app checking itself (`--self-test`), told to the page by the shell.
 *
 * The app's own self-test measures the window as a person sees it, and the launch animation covers
 * that window for the first two and a half seconds. A check that wants to look at the app must not
 * be looking at the curtain — and it cannot take the curtain down itself either: the overlay belongs
 * to React, and a node React no longer owns is a page that tears itself apart the next time the
 * overlay is hidden. So the shell says who started it, and the app does not draw the animation at
 * all.
 */
const SELF_TEST_SWITCH = '--epc-self-test';

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send(CHANNEL, 'minimize'),
  selfTest: process.argv.includes(SELF_TEST_SWITCH),
  toggleMaximize: () => ipcRenderer.send(CHANNEL, 'toggle-maximize'),
  close: () => ipcRenderer.send(CHANNEL, 'close'),
  isMaximized: () => ipcRenderer.invoke(`${CHANNEL}:is-maximized`) as Promise<boolean>,
  /** Returns a function that removes the listener again. */
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, maximized: boolean) => listener(Boolean(maximized));
    ipcRenderer.on(STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(STATE_CHANNEL, handler);
    };
  }
});

/**
 * What the page may ask about updates — three verbs, no URLs.
 *
 * The shell owns everything that matters here: where releases live, which version is newer, and
 * where the new file is put. The page is only told what changed, so a page that has been tampered
 * with cannot point the updater anywhere or talk it into replacing the app from another address.
 */
const UPDATE_STATE_CHANNEL = 'epc:update:state-changed';

contextBridge.exposeInMainWorld('desktopUpdates', {
  state: () => ipcRenderer.invoke('epc:update:state') as Promise<unknown>,
  check: () => ipcRenderer.invoke('epc:update:check') as Promise<unknown>,
  download: () => ipcRenderer.invoke('epc:update:download') as Promise<unknown>,
  /** Puts the downloaded build in place and restarts into it. */
  install: () => ipcRenderer.invoke('epc:update:install') as Promise<unknown>,
  /** Returns a function that removes the listener again. */
  onStateChange: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state);
    ipcRenderer.on(UPDATE_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, handler);
    };
  }
});
