/**
 * Whether this window is the app checking itself, rather than a person using it.
 *
 * The desktop shell answers `--self-test` by passing `--epc-self-test` to the page (see
 * electron/preload.ts), and the page then leaves out what a check must not be looking at: the launch
 * animation, which covers the whole window for the first two and a half seconds.
 *
 * It is a question, not a setting: in a plain browser build there is no bridge and the answer is
 * "no", which is exactly the behaviour a browser should have.
 */
interface DesktopSelfTestBridge {
  selfTest?: boolean;
}

export function isSelfTestRun(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as unknown as { desktopWindow?: DesktopSelfTestBridge }).desktopWindow;
  return Boolean(bridge?.selfTest);
}
