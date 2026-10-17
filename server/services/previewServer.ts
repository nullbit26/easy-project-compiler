import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { URL } from 'url';

import { ERROR_INTERCEPTOR } from '../../src/utils/sandboxDocument';
import { getWorkspaceRoot, isSensitiveRelativePath, resolveWorkspacePath } from '../store/workspaceStore';
import { ARTIFACT_URL_PREFIX, contentTypeForFile, type PreviewPlanResult } from './previewBuilder';

/**
 * The preview origin.
 *
 * A project shown in the app has to behave exactly like the project itself, and that is decided by
 * how it is delivered. An inline `srcDoc` document has no URLs of its own: relative fetches, workers,
 * `import.meta.url`, streaming WebAssembly, media ranges and `SharedArrayBuffer` either break or need
 * workarounds that change how the code runs.
 *
 * So the folder is served instead — from a real loopback origin, on its own port, with the folder as
 * the document root. The browser then loads the project's own files the way it always would, and the
 * only thing the app adds is one small bridge script that reports console output and reloads the page
 * when a file changes.
 *
 * Everything is bound to 127.0.0.1 and answers nothing else: the Host header is checked (a rebinding
 * attack resolves a public name to loopback, but it cannot forge the Host header), only the connected
 * folder is reachable, and files that look like secrets are refused exactly as they are everywhere
 * else in the app.
 */

export interface PreviewServeResult {
  url: string;
  origin: string;
  port: number;
  kind: PreviewPlanResult['kind'];
  entry: string | null;
  isolation: boolean;
  /** True when the page reloads itself after a file in the folder changes. */
  liveReload: boolean;
  reused: boolean;
}

interface ArtifactFile {
  contents: Buffer;
  contentType: string;
}

interface ActivePreview {
  root: string;
  port: number;
  origin: string;
  document: { kind: 'file'; path: string } | { kind: 'generated'; html: string };
  artifacts: Map<string, ArtifactFile>;
  isolation: boolean;
  entry: string | null;
  planKind: PreviewPlanResult['kind'];
  /** Rebuilds the plan for a bundled project after a file changed. */
  rebuild: ((entry: string | null) => Promise<PreviewPlanResult | null>) | null;
  watcher: fs.FSWatcher | null;
  reloadTimer: NodeJS.Timeout | null;
  /** When the last reload was broadcast, so a noisy folder cannot reload in a loop. */
  lastReloadAt: number;
  sseClients: Set<http.ServerResponse>;
  rebuilding: boolean;
}

/**
 * The shortest gap between two automatic reloads.
 *
 * A watched folder can be noisy — a syncing cloud drive, an editor writing several files, a build
 * tool touching its output — and a page that reloads on every one of those events never finishes
 * loading. One reload per second is fast enough to feel live and slow enough to settle.
 */
const MIN_RELOAD_GAP_MS = 1_000;

let active: ActivePreview | null = null;
let server: http.Server | null = null;

/** Ports handed out by the OS, remembered so two previews never fight over one. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

/**
 * The bridge the app adds to every page it serves.
 *
 * It reuses the interceptor the sandbox already speaks (`PREVIEW_CONSOLE_LOG`), so the console panel
 * works the same for a served project as it does for a pasted snippet, and adds the live-reload
 * listener — the one thing a static server cannot do by itself.
 */
function bridgeSource(): string {
  const body = ERROR_INTERCEPTOR.replace(/^\s*<script>\s*/i, '').replace(/<\/script>\s*$/i, '');
  return `${body}
        (function () {
          try {
            var source = new EventSource('/__epc__/stream');
            source.onmessage = function (event) {
              if (event.data === 'reload') location.reload();
            };
          } catch (error) {
            // Live reload is a convenience; a page that cannot subscribe still runs.
          }
        })();
`;
}

/** Puts the bridge into a page without touching anything else in it. */
export function injectBridge(html: string): string {
  const tag = '<script src="/__epc__/bridge.js"></script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${tag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${tag}</head>`);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n${tag}\n</head>\n<body>\n${html}\n</body>\n</html>`;
}

function send(res: http.ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string): void {
  res.writeHead(status, headers);
  if (body === undefined) res.end();
  else res.end(body);
}

function previewHeaders(preview: ActivePreview, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    // The folder is edited while it is being previewed, so nothing may be cached between reloads.
    'Cache-Control': 'no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  if (contentType) headers['Content-Type'] = contentType;
  if (preview.isolation) {
    // Both are needed for `crossOriginIsolated`; `credentialless` keeps a CDN script working where
    // `require-corp` would silently drop every third-party asset that does not opt in.
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
    headers['Permissions-Policy'] = 'cross-origin-isolated=(self)';
  }
  return headers;
}

/** Only requests that were really made to this loopback address are answered. */
function hostAllowed(req: http.IncomingMessage, preview: ActivePreview): boolean {
  const host = (req.headers.host || '').toLowerCase();
  if (!host) return false;
  return (
    host === `127.0.0.1:${preview.port}` ||
    host === `localhost:${preview.port}` ||
    host === `[::1]:${preview.port}`
  );
}

function serveStream(req: http.IncomingMessage, res: http.ServerResponse, preview: ActivePreview): void {
  res.writeHead(200, {
    ...previewHeaders(preview, 'text/event-stream; charset=utf-8'),
    Connection: 'keep-alive',
    'Cache-Control': 'no-store'
  });
  res.write(': connected\n\n');
  preview.sseClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    preview.sseClients.delete(res);
  });
}

function broadcast(preview: ActivePreview, message: string): void {
  for (const client of preview.sseClients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch {
      preview.sseClients.delete(client);
    }
  }
}

/** A byte range, so video and audio can be streamed and seeked instead of being fully buffered. */
function rangeOf(req: http.IncomingMessage, size: number): { start: number; end: number } | null {
  const header = req.headers.range;
  if (typeof header !== 'string') return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const hasStart = match[1] !== '';
  const hasEnd = match[2] !== '';
  if (!hasStart && !hasEnd) return null;
  const start = hasStart ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = hasStart && hasEnd ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

function sendBuffer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  preview: ActivePreview,
  body: Buffer,
  contentType: string,
  status = 200
): void {
  const range = rangeOf(req, body.length);
  const sizeHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(body.length)
  };
  if (!range) {
    send(res, status, { ...previewHeaders(preview, contentType), ...sizeHeaders }, req.method === 'HEAD' ? undefined : body);
    return;
  }
  const slice = body.subarray(range.start, range.end + 1);
  send(
    res,
    206,
    {
      ...previewHeaders(preview, contentType),
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${range.start}-${range.end}/${body.length}`,
      'Content-Length': String(slice.length)
    },
    req.method === 'HEAD' ? undefined : slice
  );
}

/** Reads one file out of the connected folder, refusing everything the app refuses elsewhere. */
function readFolderFile(root: string, relativePath: string): { buffer: Buffer; contentType: string } | null {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized || normalized.startsWith('..')) return null;
  // Dotfiles are not part of a site: .git, .env, .vscode and friends stay invisible.
  if (normalized.split('/').some((segment) => segment.startsWith('.') && segment !== '.')) return null;
  if (isSensitiveRelativePath(normalized)) return null;

  let absolute: string;
  try {
    absolute = resolveWorkspacePath(normalized);
  } catch {
    return null;
  }
  try {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      const indexFile = path.join(absolute, 'index.html');
      return fs.existsSync(indexFile)
        ? { buffer: fs.readFileSync(indexFile), contentType: contentTypeForFile(indexFile) }
        : null;
    }
    if (!stat.isFile()) return null;
    return { buffer: fs.readFileSync(absolute), contentType: contentTypeForFile(absolute) };
  } catch {
    return null;
  }
}

/** The document served at `/`: the project's own page, or the generated shell of a build. */
function serveDocument(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  preview: ActivePreview
): void {
  if (preview.document.kind === 'generated') {
    return sendBuffer(req, res, preview, Buffer.from(injectBridge(preview.document.html), 'utf8'), 'text/html; charset=utf-8');
  }
  const file = readFolderFile(preview.root, preview.document.path);
  if (!file) return send(res, 404, previewHeaders(preview, 'text/plain; charset=utf-8'), 'The entry document is gone.');
  const isHtml = /text\/html/i.test(file.contentType);
  const body = isHtml ? Buffer.from(injectBridge(file.buffer.toString('utf8')), 'utf8') : file.buffer;
  sendBuffer(req, res, preview, body, file.contentType);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const preview = active;
  if (!preview) return send(res, 503, { 'Content-Type': 'text/plain; charset=utf-8' }, 'The preview is not running.');
  if (!hostAllowed(req, preview)) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Only this machine may use the preview.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'The preview is read-only.');
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${preview.port}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/__epc__/bridge.js') {
    return sendBuffer(req, res, preview, Buffer.from(bridgeSource(), 'utf8'), 'text/javascript; charset=utf-8');
  }
  if (pathname === '/__epc__/stream') {
    return serveStream(req, res, preview);
  }
  if (pathname.startsWith(`${ARTIFACT_URL_PREFIX}/`)) {
    const name = pathname.slice(ARTIFACT_URL_PREFIX.length + 1);
    const artifact = preview.artifacts.get(name);
    if (!artifact) return send(res, 404, previewHeaders(preview, 'text/plain; charset=utf-8'), 'No such build output.');
    return sendBuffer(req, res, preview, artifact.contents, artifact.contentType);
  }
  if (pathname === '/' || pathname === '') {
    return serveDocument(req, res, preview);
  }

  const file = readFolderFile(preview.root, pathname.replace(/^\/+/, ''));
  if (!file) return send(res, 404, previewHeaders(preview, 'text/plain; charset=utf-8'), 'Not found.');
  const isHtml = /text\/html/i.test(file.contentType);
  const body = isHtml ? Buffer.from(injectBridge(file.buffer.toString('utf8')), 'utf8') : file.buffer;
  sendBuffer(req, res, preview, body, file.contentType);
}

/** Watches the folder so an edit shows up in the preview without leaving it. */
function startWatching(preview: ActivePreview): void {
  try {
    preview.watcher = fs.watch(preview.root, { recursive: true }, (_event, changed) => {
      const relative = changed ? String(changed).split(path.sep).join('/') : '';
      if (relative.includes('node_modules') || relative.startsWith('.git')) return;
      if (preview.reloadTimer) clearTimeout(preview.reloadTimer);
      preview.reloadTimer = setTimeout(() => void scheduleReload(preview), 250);
    });
  } catch {
    // A folder that cannot be watched still previews; only live reload is missing.
  }
}

async function scheduleReload(preview: ActivePreview): Promise<void> {
  if (preview.rebuilding) return;
  preview.rebuilding = true;
  try {
    const since = Date.now() - preview.lastReloadAt;
    if (since < MIN_RELOAD_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_RELOAD_GAP_MS - since));
    }
    preview.lastReloadAt = Date.now();
    if (preview.rebuild && preview.planKind === 'bundle') {
      const rebuilt = await preview.rebuild(preview.entry);
      if (rebuilt?.ok) {
        preview.artifacts = new Map(rebuilt.assets.map((asset) => [asset.name, { contents: asset.contents, contentType: asset.contentType }]));
        if (rebuilt.document) preview.document = { kind: 'generated', html: rebuilt.document };
        preview.isolation = rebuilt.isolation;
      }
    }
    broadcast(preview, 'reload');
  } finally {
    preview.rebuilding = false;
  }
}

async function stopServer(): Promise<void> {
  const preview = active;
  active = null;
  if (preview?.watcher) {
    try {
      preview.watcher.close();
    } catch {
      // Already closed.
    }
  }
  if (preview?.reloadTimer) clearTimeout(preview.reloadTimer);
  preview?.sseClients.forEach((client) => {
    try {
      client.end();
    } catch {
      // Already gone.
    }
  });
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
}

/**
 * Serves a plan, reusing a running preview when it already shows this folder.
 *
 * `rebuild` is what makes a bundled project live: after a file changes the bundle is produced again
 * and the page reloads into the new build.
 */
export async function servePreviewPlan(
  plan: PreviewPlanResult,
  options: { rebuild?: (entry: string | null) => Promise<PreviewPlanResult | null> } = {}
): Promise<PreviewServeResult> {
  if (!plan.ok || (!plan.documentPath && !plan.document)) {
    throw new Error(plan.diagnostics[0]?.text || 'The preview could not be built.');
  }

  const reused = Boolean(active && active.root === plan.root && server?.listening);
  if (!reused) {
    await stopServer();
    const port = await findFreePort();
    active = {
      root: plan.root || getWorkspaceRoot() || '',
      port,
      origin: `http://127.0.0.1:${port}`,
      document: plan.documentPath ? { kind: 'file', path: plan.documentPath } : { kind: 'generated', html: plan.document || '' },
      artifacts: new Map(plan.assets.map((asset) => [asset.name, { contents: asset.contents, contentType: asset.contentType }])),
      isolation: plan.isolation,
      entry: plan.entry,
      planKind: plan.kind,
      rebuild: options.rebuild || null,
      watcher: null,
      reloadTimer: null,
      lastReloadAt: 0,
      sseClients: new Set(),
      rebuilding: false
    };
    server = http
      .createServer(handleRequest)
      // Slow trickles of bytes are normal for streamed media and long-running games.
      .setTimeout(0)
      .on('connection', (socket) => socket.setNoDelay(true));
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(port, '127.0.0.1', () => resolve());
    });
    startWatching(active);
  } else if (active) {
    // Same folder, new build: swap what is served without dropping the port the iframe already has.
    active.document = plan.documentPath ? { kind: 'file', path: plan.documentPath } : { kind: 'generated', html: plan.document || '' };
    active.artifacts = new Map(plan.assets.map((asset) => [asset.name, { contents: asset.contents, contentType: asset.contentType }]));
    active.isolation = plan.isolation;
    active.entry = plan.entry;
    active.planKind = plan.kind;
    active.rebuild = options.rebuild || active.rebuild;
  }

  const current = active!;
  return {
    url: `${current.origin}/`,
    origin: current.origin,
    port: current.port,
    kind: plan.kind,
    entry: plan.entry,
    isolation: plan.isolation,
    liveReload: Boolean(current.watcher),
    reused
  };
}

/** Closes the preview origin — used when the app quits and between tests. */
export async function stopPreviewServer(): Promise<void> {
  await stopServer();
}

/** What the running preview serves, for the settings/diagnostics screens. */
export function previewServerInfo(): { origin: string; port: number; clients: number } | null {
  if (!active || !server?.listening) return null;
  return { origin: active.origin, port: active.port, clients: active.sseClients.size };
}
