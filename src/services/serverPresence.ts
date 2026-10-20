/**
 * Whether the app's own server is behind this page.
 *
 * The page can be served by a bare Vite or static server while the interface is being looked at.
 * Every `/api/*` is answered there with the app's own HTML, which looks like success until it is
 * parsed. `/api/health` is the one address that can tell: the real server answers with a small JSON
 * envelope that names the build, while a page without one answers with HTML (or with nothing).
 *
 * The question is asked once, when the window opens. A failure is not retried: a server that is not
 * there will not start by itself, and the title bar keeps saying so until the window is reloaded.
 */
export type ServerPresence = 'present' | 'missing';

export async function probeServer(): Promise<ServerPresence> {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) return 'missing';
    const payload = await response.json();
    return payload && typeof payload === 'object' && payload.status === 'ok' ? 'present' : 'missing';
  } catch {
    // Unreachable, or an HTML page where JSON was promised: both mean no server behind this page.
    return 'missing';
  }
}
