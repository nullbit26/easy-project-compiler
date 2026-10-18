import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { spawn } from 'child_process';

import projectRoutes from './server/routes/project.routes';
import promptRoutes from './server/routes/prompt.routes';
import sessionRoutes from './server/routes/session.routes';
import errorRoutes from './server/routes/error.routes';
import settingsRoutes from './server/routes/settings.routes';
import filesRoutes from './server/routes/files.routes';
import autonomousRoutes from './server/routes/autonomous.routes';
import previewRoutes from './server/routes/preview.routes';
import { getActiveProvider, getProviderStatuses, initApiKeyStore, resolveApiKey } from './server/store/apiKeyStore';
import { getWorkspaceRoot, initWorkspaceStore } from './server/store/workspaceStore';
import { requireLocal } from './server/utils/localRequest';

/**
 * The two things only the desktop shell can do, and the only reason the app calls its own server
 * from outside a page:
 *  - `focus` — a second launch of the same build brings the open window forward instead of starting
 *    a twin;
 *  - `quit` — a newer build starting while this one is on screen asks it to close, so the user sees
 *    the build they just started instead of the old one.
 * Both are answered on loopback only.
 */
export interface DesktopHooks {
  focus?: () => void;
  quit?: () => void;
}

// Load environment variables for local development.
// `.env.local` takes precedence over `.env` (mirrors the README setup instructions).
// `quiet` keeps dotenv's promotional tips out of the tester-facing console window.
dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const app = express();

/**
 * `npm run dev` keeps port 3000. The packaged app deliberately uses its own port, because an
 * origin is what a browser ties saved projects to: sharing 3000 with a development server would
 * put the developer's projects and the tester's projects in the same browser storage.
 */
const DEV_PORT = 3000;
const PACKAGED_PORT = 4123;

/**
 * The desktop build (electron/main.ts) runs this same server inside its own window, on loopback
 * only. It sets EPC_DESKTOP=1 and starts the server itself, so the server must not print the
 * "open this in a browser" banner or launch a browser for it.
 */
const desktopRuntime = process.env.EPC_DESKTOP === '1';

/** Set once the runtime is known, so /api/health can say which build answered. */
let packagedRuntime = false;
/** True for `npm start`, which serves the built app from dist/ instead of Vite's dev server. */
let productionBuild = false;

// Replaced with a literal by the build (see tools/desktop/build-desktop.mjs and tools/exe/build-sea.mjs).
// `typeof` on an identifier that was never defined is safe, so plain `npm run dev` and the tests
// simply see 'dev' here.
declare const __EPC_BUILD_ID__: string;
declare const __EPC_BUILT_AT__: string;
declare const __EPC_VERSION__: string;

const BUILD_ID = typeof __EPC_BUILD_ID__ === 'string' ? __EPC_BUILD_ID__ : 'dev';
const BUILT_AT = typeof __EPC_BUILT_AT__ === 'string' ? __EPC_BUILT_AT__ : '';
/** The release number, as opposed to the build id that tells builds apart. */
const APP_VERSION = typeof __EPC_VERSION__ === 'string' ? __EPC_VERSION__ : '';

/**
 * Which build is answering, where it runs and where it keeps the user's data. The window title and
 * the sidebar badge show the same id, so "which version am I looking at?" is answerable at a
 * glance instead of by guessing at a cache.
 */
function healthBuildInfo() {
  return {
    id: BUILD_ID,
    version: APP_VERSION,
    builtAt: BUILT_AT,
    mode: desktopRuntime
      ? 'desktop'
      : packagedRuntime
      ? 'packaged'
      : productionBuild
      ? 'server'
      : 'development',
    stateDir: process.env.EPC_STATE_DIR || null
  };
}

app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Easy Project Compiler',
    // Lets a second launch tell "another copy of this app" from "something else on this port".
    packaged: packagedRuntime,
    // The exact build that is serving this page — shown in the window title and the sidebar.
    build: healthBuildInfo(),
    hasGeminiKey: Boolean(resolveApiKey('gemini')),
    aiProvider: getActiveProvider(),
    workspaceRoot: getWorkspaceRoot()
  });
});

app.get('/api/api-status', (req, res) => {
  res.json({
    gemini: Boolean(resolveApiKey('gemini')),
    openai: Boolean(resolveApiKey('openai')),
    anthropic: Boolean(resolveApiKey('anthropic')),
    nvidia: Boolean(resolveApiKey('nvidia')),
    activeProvider: getActiveProvider(),
    providers: getProviderStatuses()
  });
});

/** Filled in by startServer() when the desktop shell starts this server. */
let desktopHooks: DesktopHooks = {};

if (desktopRuntime) {
  app.post('/api/focus', (req, res) => {
    if (!requireLocal(req, res, 'Only the app itself can do this.')) return;
    desktopHooks.focus?.();
    res.json({ ok: true, status: 'ok', app: 'Easy Project Compiler', build: healthBuildInfo() });
  });

  app.post('/api/quit', (req, res) => {
    if (!requireLocal(req, res, 'Only the app itself can do this.')) return;
    // Answer first: the copy that asked waits for this port to close before it takes the profile.
    res.json({ ok: true, status: 'ok', app: 'Easy Project Compiler', build: healthBuildInfo() });
    setTimeout(() => desktopHooks.quit?.(), 50);
  });
}

app.use('/api/settings', settingsRoutes);
// Reading and writing the user's real project folder (localhost only).
app.use('/api/files', filesRoutes);
// The autonomous coding loop: AI writes, formats and self-repairs, localhost only.
app.use('/api/autonomous', autonomousRoutes);
// Building and running the connected folder in the sandbox (localhost only).
app.use('/api/preview', previewRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/prompt', promptRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/error', errorRoutes);

// `npm run dev` runs this file through tsx and wants Vite's dev middleware (HMR).
// `npm start` runs the bundled dist/server.cjs, which must serve the built app from dist/
// instead — otherwise a plain `npm start` silently booted a second Vite dev server.
const isProductionBuild =
  process.env.NODE_ENV === 'production' || /server\.cjs$/.test(process.argv[1] ?? '');
productionBuild = isProductionBuild;

/**
 * The single-executable build carries the whole web app inside the binary and serves it from
 * `node:sea` assets — there is no dist/ folder next to the .exe for it to read.
 */
interface SeaRuntime {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
}

async function loadSeaRuntime(): Promise<SeaRuntime | null> {
  try {
    // @ts-ignore — `node:sea` only exists inside a Node single-executable application.
    const sea = await import('node:sea');
    return sea as unknown as SeaRuntime;
  } catch {
    return null;
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sendEmbeddedAsset(res: express.Response, body: Buffer, assetKey: string): void {
  const ext = path.extname(assetKey).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    assetKey.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
  );
  res.end(body);
}

function installEmbeddedAssets(sea: SeaRuntime): void {
  const cache = new Map<string, Buffer>();

  const readAsset = (assetKey: string): Buffer | null => {
    const cached = cache.get(assetKey);
    if (cached) return cached;
    try {
      const raw = sea.getAsset(assetKey);
      const body = Buffer.from(raw);
      cache.set(assetKey, body);
      return body;
    } catch {
      return null;
    }
  };

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();

    const relative = decodeURIComponent(req.path).replace(/^\/+/, '');
    const directKey = relative ? `dist/${relative}` : 'dist/index.html';

    const direct = readAsset(directKey);
    if (direct) {
      sendEmbeddedAsset(res, direct, directKey);
      return;
    }

    // Client-side routes (anything without a file extension) fall back to the app shell.
    if (!path.extname(relative)) {
      const shell = readAsset('dist/index.html');
      if (shell) {
        sendEmbeddedAsset(res, shell, 'dist/index.html');
        return;
      }
    }

    next();
  });
}

/** Binds the first free port in [start..start+10]. Returns the port that worked. */
function listenWithFallback(host: string, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryPort = (port: number) => {
      const server = app.listen(port, host, () => resolve(port));
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 10) {
          attempt += 1;
          tryPort(port + 1);
          return;
        }
        reject(err);
      });
    };

    tryPort(startPort);
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Opening a browser is a convenience; the printed URL is the fallback.
  }
}

/**
 * Who is answering on that port: another packaged copy of the app, or something else (the dev
 * server, or an unrelated program). Only the first case means "just open the browser": anything
 * else must leave the port alone and start this copy on the next free one.
 */
async function runningAppOn(port: number): Promise<{ app: boolean; packaged: boolean }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(800)
    });
    if (!res.ok) return { app: false, packaged: false };
    const body: any = await res.json();
    return { app: body?.app === 'Easy Project Compiler', packaged: body?.packaged === true };
  } catch {
    return { app: false, packaged: false };
  }
}

/**
 * Starts the app and answers with the address it actually bound.
 *
 * Exported because the desktop build starts this server in-process and needs the port to load its
 * window from; a plain `npm run dev`, `npm start` or the single-executable build reaches the
 * autostart at the bottom of this file instead.
 */
export async function startServer(hooks: DesktopHooks = {}): Promise<{ port: number; url: string }> {
  desktopHooks = hooks;

  const sea = await loadSeaRuntime();
  const isSea = Boolean(sea && sea.isSea());
  packagedRuntime = isSea;

  if (isSea) {
    // Keys and settings belong next to the executable, not in whatever folder launched it.
    try {
      process.chdir(path.dirname(process.execPath));
    } catch {
      // Keep the original working directory if it cannot be changed.
    }
  }

  // Keys pasted into the in-app settings panel live in a gitignored local file and are
  // exposed to the providers through process.env, exactly like keys from a .env file.
  initApiKeyStore();
  initWorkspaceStore();

  if (isSea && sea) {
    installEmbeddedAssets(sea);
  } else if (!isProductionBuild) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // The desktop build carries the built app inside its own resources folder and says where with
    // EPC_DIST_DIR — its working directory has to stay next to the .exe, where the user's data goes.
    const distPath = process.env.EPC_DIST_DIR || path.join(process.cwd(), 'dist');
    /**
     * The app shell is never allowed to sit in a cache: a rebuilt app must always show its own
     * screen, not yesterday's one. Vite already fingerprints the assets it references.
     */
    const shellHeaders = (res: express.Response) => {
      if (desktopRuntime) res.setHeader('Cache-Control', 'no-store, must-revalidate');
    };
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) shellHeaders(res);
        }
      })
    );
    app.get('*', (req, res) => {
      shellHeaders(res);
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const ownPort = isSea || desktopRuntime;
  const preferredPort = Number(process.env.PORT) || (ownPort ? PACKAGED_PORT : DEV_PORT);

  // A double-clicked .exe that is already running should just focus the browser tab. A development
  // server on the same port answers the same health check, so it is not enough here: reusing it
  // would show the developer's own projects through the tester's window. The desktop build never
  // adopts a foreign process — it always brings up its own window (see electron/main.ts).
  if (isSea && !desktopRuntime && (await runningAppOn(preferredPort)).packaged) {
    const url = `http://localhost:${preferredPort}`;
    console.log('');
    console.log('  \u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0443\u0436\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e \u2014 \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u044e \u0435\u0433\u043e \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.');
    console.log(`  The app is already running \u2014 opening ${url}`);
    openBrowser(url);
    return { port: preferredPort, url };
  }

  // Everything a stranger could reach is loopback-only once the app is packaged or desktop-hosted.
  const host = ownPort ? '127.0.0.1' : '0.0.0.0';
  const port = await listenWithFallback(host, preferredPort);
  const url = `http://localhost:${port}`;

  // The desktop build has no console window: one quiet line is all it needs for the logs.
  if (desktopRuntime) {
    console.log(`[server] ${url} (build ${BUILD_ID})`);
    return { port, url };
  }

  console.log('');
  console.log('  ==================================================');
  console.log('  Easy Project Compiler is running / \u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e');
  console.log(`  \u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435 / Open in browser:  ${url}`);
  console.log('  ==================================================');
  console.log('  \u041d\u0435 \u0437\u0430\u043a\u0440\u044b\u0432\u0430\u0439\u0442\u0435 \u044d\u0442\u043e \u043e\u043a\u043d\u043e, \u043f\u043e\u043a\u0430 \u0442\u0435\u0441\u0442\u0438\u0440\u0443\u0435\u0442\u0435: \u0437\u0430\u043a\u0440\u044b\u0442\u0438\u0435 \u043e\u043a\u043d\u0430 \u043e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u0442 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435.');
  console.log('  Keep this window open while testing \u2014 closing it stops the app.');
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot) {
    console.log(`  \u041f\u0430\u043f\u043a\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 / Project folder: ${workspaceRoot}`);
  }
  if (!getActiveProvider()) {
    console.log('  \u041a\u043b\u044e\u0447\u0438 API \u043d\u0435 \u0437\u0430\u0434\u0430\u043d\u044b \u2014 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0432\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0439 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u0434\u0432\u0438\u0436\u043e\u043a. \u041a\u043b\u044e\u0447 \u043c\u043e\u0436\u043d\u043e \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0438: \u00ab\u041a\u043b\u044e\u0447\u0438 API\u00bb \u0432\u043d\u0438\u0437\u0443 \u0441\u043b\u0435\u0432\u0430.');
  }
  console.log('');

  if (isSea && process.env.EPC_NO_BROWSER !== '1') {
    openBrowser(url);
  }

  return { port, url };
}

// Autostart for every entry point that is not the desktop shell: `npm run dev`, `npm start` and the
// single-executable build all load this file for its side effect. The desktop build sets
// EPC_EMBEDDED=1 and calls startServer() itself, so it gets the port back instead of racing it.
if (process.env.EPC_EMBEDDED !== '1') {
  startServer();
}
