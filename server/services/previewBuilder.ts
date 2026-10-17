import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { ERROR_INTERCEPTOR } from '../../src/utils/sandboxDocument';
import { WorkspaceError, getWorkspaceRoot, resolveWorkspacePath } from '../store/workspaceStore';

/**
 * Turns the connected project folder into a document the sandbox iframe can actually run.
 *
 * The screen used to hand the iframe one pasted file, so a real project — a Vite app, a Phaser
 * game, a plain HTML site — showed nothing. Here the folder is read as a project instead:
 *
 *  - an HTML entry is served as a site: its own stylesheets, scripts and images are inlined, so
 *    the document is self-contained and relative paths cannot break;
 *  - a script entry (main.tsx, index.js, …) is bundled by esbuild, JSX and TypeScript included;
 *  - a package that is not installed in the folder is not a dead end: it is left external and
 *    mapped to a CDN in the import map, so a game engine or a UI library still loads.
 *
 * Nothing is written to disk, every path goes through the workspace store's checks, and the whole
 * build is bounded in time and size so the screen can answer with an error instead of hanging.
 */

export type PreviewKind = 'static' | 'bundle';

export interface PreviewCandidate {
  path: string;
  kind: PreviewKind;
}

export interface PreviewDiagnostic {
  file: string;
  line: number | null;
  column: number | null;
  text: string;
}

/** One thing that ended up in the bundle: the folder's own file, or a package it pulled in. */
export interface BundleCompositionPart {
  name: string;
  kind: 'local' | 'package';
  bytes: number;
  /** Share of the JavaScript and CSS the bundle produced, in per cent. */
  pct: number;
}

/**
 * What the bundle is actually made of.
 *
 * "The bundle is 1.4 MB" is a diagnosis; "this dependency is 900 KB of it" is an address. The
 * numbers come from esbuild's own metafile, so nothing is guessed: every byte is attributed to the
 * module the bundler says put it there, and "this package" never includes a file of the folder's
 * own code.
 */
export interface BundleComposition {
  /** Bytes of the JavaScript and CSS the bundle produced. */
  bytes: number;
  /** The heaviest contributors, heaviest first. */
  parts: BundleCompositionPart[];
  /** Packages the folder does not have installed, answered by a CDN instead of the bundle. */
  externals: string[];
  /** True when smaller contributors were left off the list — the total still counts them. */
  truncated: boolean;
}

export interface PreviewBuildResult {
  ok: boolean;
  kind: PreviewKind | null;
  entry: string | null;
  html: string | null;
  diagnostics: PreviewDiagnostic[];
  warnings: string[];
  candidates: PreviewCandidate[];
  durationMs: number;
  root: string;
  /** What the bundle is made of, for a bundled entry. Null for a page that needed no bundling. */
  composition?: BundleComposition | null;
}

const MAX_ENTRY_BYTES = 2_000_000;
const MAX_BUNDLE_BYTES = 12_000_000;
const MAX_INLINE_ASSET_BYTES = 4_000_000;
const MAX_INLINE_DEPTH = 4;
const MAX_HTML_FILES = 8;

/** Site entries, in the order the app prefers them. */
const STATIC_CANDIDATES = [
  'index.html',
  'public/index.html',
  'www/index.html',
  'site/index.html',
  'game/index.html',
  'dist/index.html'
];

/** Script entries: the usual names a Vite, Parcel, CRA or hand-made app starts from. */
const BUNDLE_CANDIDATES = [
  'src/main.tsx',
  'src/main.ts',
  'src/index.tsx',
  'src/index.ts',
  'src/main.jsx',
  'src/main.js',
  'src/index.jsx',
  'src/index.js',
  'src/app.js',
  'main.tsx',
  'main.ts',
  'main.jsx',
  'main.js',
  'index.tsx',
  'index.jsx',
  'app.js',
  'index.js',
  'src/App.tsx',
  'src/App.jsx'
];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css']);

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json'
};

const BASE_STYLE = `
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body { background-color: #0f172a; color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }
  `;

/**
 * Libraries a project may use through a browser global instead of an import.
 *
 * A game folder written by hand very often loads the engine with a plain `<script src>` and then
 * says `new Phaser.Game(...)` — and a folder that never ran `npm install` has no node_modules to
 * bundle from. Such a script is not broken, it is just missing its engine, so the engine is added
 * back as a tag in front of the bundle.
 */
interface GlobalLibrary {
  package: string;
  defaultVersion: string;
  /** A reference that only shows up when the code uses the library without importing it. */
  usage: RegExp;
  url: (version: string) => string;
}

const GLOBAL_LIBRARIES: GlobalLibrary[] = [
  {
    package: 'phaser',
    defaultVersion: '3.80.1',
    usage: /\bPhaser\s*\.\s*(Game|AUTO|CANVAS|WEBGL|Scene|Math|Display|Input|Tweens|Physics)\b/,
    url: (version) => `https://cdn.jsdelivr.net/npm/phaser@${version}/dist/phaser.min.js`
  },
  {
    package: 'three',
    defaultVersion: '0.158.0',
    usage: /\bTHREE\s*\.\s*(Scene|WebGLRenderer|Mesh|Color|Vector3|PerspectiveCamera|BoxGeometry)\b/,
    url: (version) => `https://cdn.jsdelivr.net/npm/three@${version}/build/three.min.js`
  },
  {
    package: 'pixi.js',
    defaultVersion: '7.4.2',
    usage: /\bPIXI\s*\.\s*(Application|Sprite|Container|Graphics|Texture)\b/,
    url: (version) => `https://cdn.jsdelivr.net/npm/pixi.js@${version}/dist/pixi.min.js`
  },
  {
    package: 'matter-js',
    defaultVersion: '0.19.0',
    usage: /\bMatter\s*\.\s*(Engine|Render|Runner|Bodies|Composite)\b/,
    url: (version) => `https://cdn.jsdelivr.net/npm/matter-js@${version}/build/matter.min.js`
  },
  {
    package: 'p5',
    defaultVersion: '1.9.0',
    usage: /(^|[^.\w])p5\s*\.\s*(setup|createCanvas|draw|VERSION)\b|new\s+p5\s*\(/,
    url: (version) => `https://cdn.jsdelivr.net/npm/p5@${version}/lib/p5.min.js`
  },
  {
    package: 'gsap',
    defaultVersion: '3.12.5',
    usage: /\b(gsap|TweenLite|TweenMax)\s*\.\s*(to|from|fromTo|timeline|set|registerPlugin)\b/,
    url: (version) => `https://cdn.jsdelivr.net/npm/gsap@${version}/dist/gsap.min.js`
  },
  {
    package: 'chart.js',
    defaultVersion: '4.4.1',
    usage: /new\s+Chart\s*\(/,
    url: (version) => `https://cdn.jsdelivr.net/npm/chart.js@${version}/dist/chart.umd.js`
  },
  {
    package: 'jquery',
    defaultVersion: '3.7.1',
    usage: /\bjQuery\b|window\s*\.\s*\$\s*\(|\$\s*\(\s*(function|document|"#|'#)/,
    url: (version) => `https://cdn.jsdelivr.net/npm/jquery@${version}/dist/jquery.min.js`
  },
  {
    package: 'animejs',
    defaultVersion: '3.2.2',
    usage: /(^|[^.\w])anime\s*\(/,
    url: (version) => `https://cdn.jsdelivr.net/npm/animejs@${version}/lib/anime.min.js`
  }
];

/** Mount points a generated page offers, so a game or an app has somewhere to attach to. */
const SHELL_MOUNT_POINTS = ['root', 'app-root', 'app', 'game', 'canvas'];

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function fileExists(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/** Reads a text file inside the folder; returns null for anything unreadable or oversized. */
function readText(relativePath: string, maxBytes = MAX_ENTRY_BYTES): string | null {
  let absolute: string;
  try {
    absolute = resolveWorkspacePath(relativePath);
  } catch {
    return null;
  }
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function toDataUrl(relativePath: string): string | null {
  let absolute: string;
  try {
    absolute = resolveWorkspacePath(relativePath);
  } catch {
    return null;
  }
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > MAX_INLINE_ASSET_BYTES) return null;
    const mime = MIME_TYPES[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Keeps an inlined script or style from closing its own tag early. */
function escapeEmbedded(source: string): string {
  return source
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<\/style/gi, '<\\/style');
}

function attributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return null;
  return (match[2] ?? match[3] ?? match[4] ?? '').trim();
}

/**
 * A reference inside the document can point anywhere: another file in the project, a CDN, or out
 * of the folder. Only the first kind is resolvable, and anything outside the folder is refused by
 * the workspace store.
 */
function resolveDocumentReference(baseDir: string, reference: string): string | null {
  if (!reference) return null;
  if (/^(https?:|data:|blob:|mailto:|tel:|javascript:|\/\/|#)/i.test(reference)) return null;
  const withoutQuery = reference.split('?')[0].split('#')[0];
  if (!withoutQuery) return null;
  const candidate = withoutQuery.startsWith('/')
    ? withoutQuery.slice(1)
    : toPosix(path.posix.normalize(path.posix.join(baseDir, withoutQuery)));
  try {
    resolveWorkspacePath(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** Rewrites url(...) and @import inside a stylesheet so the CSS needs no folder around it. */
function inlineCssAssets(css: string, baseDir: string, warnings: string[], depth: number): string {
  let output = css.replace(/@import\s+(?:url\()?["']([^"')]+)["']\)?\s*;?/gi, (whole, reference: string) => {
    if (depth >= MAX_INLINE_DEPTH) return whole;
    const target = resolveDocumentReference(baseDir, reference);
    if (!target) return whole;
    const nested = readText(target, MAX_INLINE_ASSET_BYTES);
    if (nested === null) return whole;
    return inlineCssAssets(nested, path.posix.dirname(target), warnings, depth + 1);
  });

  output = output.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, reference: string) => {
    const target = resolveDocumentReference(baseDir, reference);
    if (!target) return whole;
    const data = toDataUrl(target);
    if (!data) {
      warnings.push(reference);
      return whole;
    }
    return `url("${data}")`;
  });

  return output;
}

/**
 * Inlines everything a page references from inside the folder: stylesheets, scripts and media.
 * What is left pointing at the network keeps working — the iframe has internet access.
 */
function inlineDocument(root: string, relativePath: string, warnings: string[], depth = 0): string {
  const html = readText(relativePath, MAX_ENTRY_BYTES);
  if (html === null) throw new WorkspaceError('not_found', `Cannot read ${relativePath}`);
  const baseDir = path.posix.dirname(relativePath);

  // Stylesheets.
  let output = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attributeOf(tag, 'href');
    const rel = attributeOf(tag, 'rel') || '';
    if (!href || !/stylesheet/i.test(rel)) return tag;
    const target = resolveDocumentReference(baseDir, href);
    if (!target) return tag;
    const css = readText(target, MAX_INLINE_ASSET_BYTES);
    if (css === null) return tag;
    const inlined = inlineCssAssets(css, path.posix.dirname(target), warnings, depth);
    return `<style data-epc-from="${target}">\n${escapeEmbedded(inlined)}\n</style>`;
  });

  // Scripts with a local src.
  output = output.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attributes: string, body: string) => {
    const src = attributeOf(whole, 'src');
    if (!src) return whole;
    const target = resolveDocumentReference(baseDir, src);
    if (!target) return whole;
    if (!TEXT_EXTENSIONS.has(path.extname(target).toLowerCase())) return whole;
    const code = readText(target, MAX_ENTRY_BYTES);
    if (code === null) return whole;
    const isModule = /type\s*=\s*(["']?)module/i.test(attributes || '');
    return `<script${isModule ? ' type="module"' : ''} data-epc-from="${target}">\n${escapeEmbedded(code)}\n</script>`;
  });

  // Media and embedded documents.
  output = output.replace(/<(img|source|audio|video|track|input)\b[^>]*>/gi, (tag) => {
    const reference = attributeOf(tag, 'src') || attributeOf(tag, 'poster');
    if (!reference) return tag;
    const target = resolveDocumentReference(baseDir, reference);
    if (!target) return tag;
    const data = toDataUrl(target);
    if (!data) {
      warnings.push(reference);
      return tag;
    }
    return tag.replace(/src\s*=\s*(["'])[^"']*\1/i, `src="${data}"`);
  });

  return output;
}

/** Puts the console bridge into a finished document, and guarantees a runnable shell. */
function withInterceptor(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}\n${ERROR_INTERCEPTOR}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${ERROR_INTERCEPTOR}</head>`);
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n${ERROR_INTERCEPTOR}\n<style>${BASE_STYLE}</style>\n</head>\n<body>\n${html}\n</body>\n</html>`;
}

/** Every file the folder could be started from, best first. */
export function listPreviewCandidates(root = getWorkspaceRoot()): PreviewCandidate[] {
  if (!root) return [];
  const candidates: PreviewCandidate[] = [];
  const push = (relativePath: string, kind: PreviewKind) => {
    if (!fileExists(path.join(root, relativePath))) return;
    if (candidates.some((entry) => entry.path === relativePath)) return;
    candidates.push({ path: relativePath, kind });
  };

  for (const candidate of STATIC_CANDIDATES) push(candidate, 'static');
  for (const candidate of BUNDLE_CANDIDATES) push(candidate, 'bundle');

  // Any other top-level page, so a project with about.html or menu.html is still runnable.
  try {
    const topLevelHtml = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of topLevelHtml.slice(0, MAX_HTML_FILES)) push(name, 'static');
  } catch {
    // An unreadable folder simply has no extra candidates.
  }

  /**
   * A page that pulls in a script the lists above do not name — `/src/game.ts`, `/src/app.tsx` —
   * says exactly what has to run. Without this, an index.html pointing at src/game.ts would be
   * served as-is and the browser would be handed TypeScript it cannot read.
   */
  const referencedScripts: string[] = [];
  for (const page of candidates.filter((entry) => entry.kind === 'static').slice(0, 3)) {
    const html = readText(page.path, 200_000);
    if (html === null) continue;
    const baseDir = path.posix.dirname(page.path);
    for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const target = resolveDocumentReference(baseDir, match[1]);
      if (target && /\.[cm]?[jt]sx?$/i.test(target)) referencedScripts.push(target);
    }
  }
  for (const script of referencedScripts.slice(0, MAX_HTML_FILES)) push(script, 'bundle');

  return candidates;
}

/**
 * True when a page pulls in code the browser cannot run by itself. A Vite page points at
 * /src/main.tsx, and inlining that file raw would hand the browser TypeScript.
 */
function pageNeedsBundling(root: string, relativePath: string): boolean {
  const html = readText(relativePath, 200_000);
  if (html === null) return false;
  const directory = path.posix.dirname(relativePath);
  const referenced = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  return referenced.some((reference) => {
    const target = resolveDocumentReference(directory, reference);
    return Boolean(target && /\.(ts|tsx|jsx|vue|svelte)$/i.test(target));
  });
}

/**
 * Which entry the screen starts with.
 *
 * A page that stands on its own is what the user means by "run my project" — a folder can easily
 * carry a loose src/main.js from an earlier attempt next to the real page (and the wrong pick
 * runs the wrong thing). Only a page that needs compiling steps aside for the script entry.
 */
function pickDefaultEntry(root: string, candidates: PreviewCandidate[]): PreviewCandidate | undefined {
  const page = candidates.find((candidate) => candidate.kind === 'static');
  const script = candidates.find((candidate) => candidate.kind === 'bundle');
  if (page && !pageNeedsBundling(root, page.path)) return page;
  return script || page || candidates[0];
}

/**
 * What a build produced, before it is turned into a document.
 *
 * The parts are kept apart on purpose: an inline `srcDoc` document has to glue everything together
 * (data URLs, inlined scripts), while the preview origin serves the same build as real URLs — which
 * is what keeps streaming WebAssembly, workers, `import.meta.url` and media ranges working.
 */
export interface BundleParts {
  jsName: string;
  js: string;
  cssName: string | null;
  css: string;
  importMap: Record<string, string>;
  /** Engine tags a hand-written game expects as globals. */
  scripts: string[];
  /** The project's own index.html with its folder-local script tags removed. */
  projectHtml: string | null;
  /** Files the bundle emitted (images, fonts, wasm), keyed by the name they are served under. */
  assets: Array<{ name: string; contents: Buffer; contentType: string }>;
}

interface BundleOutcome {
  html: string | null;
  parts: BundleParts | null;
  diagnostics: PreviewDiagnostic[];
  warnings: string[];
  composition: BundleComposition | null;
}

const MAX_COMPOSITION_PARTS = 10;
const MAX_COMPOSITION_EXTERNALS = 20;

/** Where the preview origin exposes build output. */
export const ARTIFACT_URL_PREFIX = '/__epc__/artifact';

/**
 * Loads esbuild's Node API.
 *
 * It is resolved from disk on purpose: a plain `import('esbuild')` is answered by esbuild's
 * browser build whenever the surrounding bundler prefers the `browser` field (the test environment
 * does), and that build cannot touch a real project folder.
 */
async function loadEsbuild(): Promise<any> {
  const bases = [typeof __dirname === 'string' ? __dirname : '', process.cwd()].filter(Boolean);
  let lastError: any = null;
  for (const base of bases) {
    try {
      const requireFrom = createRequire(path.join(base, 'index.js'));
      const resolved = requireFrom.resolve('esbuild');
      const loaded: any = await import(pathToFileURL(resolved).href);
      return loaded?.build ? loaded : loaded?.default;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('esbuild is not installed');
}

/**
 * One esbuild message, as the screen wants it: a file, a position and a sentence — never the
 * multi-error dump esbuild prints for a console.
 */
/**
 * A path esbuild handed back, made relative to the folder — or rejected when it is outside it.
 *
 * Two ways a path is outside: it walks up (`..`) or it cannot be expressed as a relative path at
 * all, which is what Windows answers when the two paths are on different drives. The second case
 * has to be rejected explicitly — `path.relative` then returns the absolute path, and a check for
 * a leading `..` would let it through as if it were the folder's own file. It is not a rare case:
 * it happens on a build machine whose checkout and temporary folder sit on different disks, which
 * is exactly how the release pipeline ran into it.
 */
function toWorkspaceRelative(root: string, candidate: string): string | null {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
  const relative = toPosix(path.relative(root, absolute));
  if (!relative || relative.startsWith('..') || /^[A-Za-z]:/.test(relative) || relative.startsWith('/')) {
    return null;
  }
  return relative;
}

function diagnosticFrom(
  message: { text?: string; location?: { file?: string; line?: number; column?: number } | null },
  root: string,
  fallbackEntry: string
): PreviewDiagnostic {
  const location = message.location || null;
  const raw = (message.text || '').replace(/^Build failed with \d+ errors?:\s*/i, '').trim();
  // esbuild often puts the position in the text while leaving `location` empty.
  const parsed = raw.match(/^(.+?):(\d+):(\d+):\s*(?:ERROR|WARNING)?:?\s*([\s\S]*)$/);

  /*
    Every path esbuild reports — in the text and in `location` alike — is relative to the working
    directory the build was started in, which is the folder itself (`absWorkingDir: root` above).
    Resolving them against the process's own directory instead used to look right only because a
    developer's checkout and the temporary folder usually sit on the same disk.
  */
  const fileFromText = parsed ? toWorkspaceRelative(root, parsed[1]) : null;
  const fileFromLocation = location?.file
    ? toWorkspaceRelative(root, path.isAbsolute(location.file) ? location.file : path.resolve(root, location.file))
    : null;

  return {
    file: fileFromText || fileFromLocation || fallbackEntry,
    line: location?.line ?? (parsed ? Number(parsed[2]) : null),
    column: location?.column ?? (parsed ? Number(parsed[3]) : null),
    text: parsed ? parsed[4].trim() : raw || 'The bundle failed.'
  };
}

function bundledResultFailure(_root: string, entry: string, text: string): PreviewDiagnostic {
  return { file: entry, line: null, column: null, text };
}

const VIRTUAL_ENTRY = 'epc-preview-entry';

/** Concrete versions the folder declares, so a CDN tag matches what the project asked for. */
function declaredVersions(root: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const text = readText('package.json', 500_000);
  if (text === null) return versions;
  try {
    const parsed = JSON.parse(text);
    for (const table of [parsed?.dependencies, parsed?.devDependencies, parsed?.peerDependencies]) {
      if (!table || typeof table !== 'object') continue;
      for (const [name, range] of Object.entries(table)) {
        // '^3.60.0' → '3.60.0'; a git url or a tag like 'latest' is simply skipped.
        const version = typeof range === 'string' ? range.match(/(\d+\.\d+\.\d+)/) : null;
        if (version && !versions[name]) versions[name] = version[1];
      }
    }
  } catch {
    // A malformed package.json never fails a preview.
  }
  return versions;
}

/**
 * Engine tags the bundle needs.
 *
 * Only the folder's own sources are inspected: a package esbuild resolved from node_modules is
 * already inside the bundle and must not be loaded a second time.
 */
function globalLibraryScripts(
  root: string,
  sourceFiles: string[],
  resolveLocally: (specifier: string, resolveDir: string) => string | null,
  warnings: string[]
): string[] {
  const sources: string[] = [];
  for (const relativePath of sourceFiles.slice(0, 60)) {
    const text = readText(relativePath, 600_000);
    if (text !== null) sources.push(text);
  }
  if (sources.length === 0) return [];
  const code = sources.join('\n');
  const declared = declaredVersions(root);

  const scripts: string[] = [];
  for (const library of GLOBAL_LIBRARIES) {
    if (!library.usage.test(code)) continue;
    if (resolveLocally(library.package, root)) continue;
    const version = declared[library.package] || library.defaultVersion;
    scripts.push(library.url(version));
    warnings.push(
      `${library.package} is not installed in this folder, so ${library.package}@${version} is loaded from a CDN for this run.`
    );
  }
  return scripts;
}

/** The package a CDN url belongs to, so a page's own script tag is never repeated. */
function packageOfScriptUrl(url: string): string {
  const match = url.match(/\/npm\/((?:@[^/]+\/)?[^@/]+)@/);
  return match ? match[1] : '';
}

/**
 * The shell the bundle runs inside, reusing the project's own index.html when it has one.
 *
 * The page's own `<script src>` tags that point at a path in the folder are removed — the bundle
 * now contains those files, and running them twice is what makes a mount component render twice.
 * Tags that point at the network are kept: those are the project's libraries, not duplicates.
 */
function bundleShell(options: {
  projectHtml: string | null;
  css: string;
  js: string;
  importMap: Record<string, string> | null;
  scripts: string[];
}): string {
  const importMapTag = options.importMap
    ? `<script type="importmap">${JSON.stringify({ imports: options.importMap })}</script>`
    : '';
  const bundleTag = `<script type="module">\n${escapeEmbedded(options.js)}\n</script>`;
  const styleTag = options.css ? `<style data-epc-bundle-css>${escapeEmbedded(options.css)}</style>` : '';

  if (options.projectHtml) {
    // The page keeps its own <head> (fonts, meta, CDN scripts); the app itself comes from the bundle.
    let page = options.projectHtml
      // Scripts inlined from the folder, and tags still pointing at a path rather than a host.
      .replace(/<script\b[^>]*\bdata-epc-from\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\bsrc\s*=\s*["'](?!https?:|\/\/)[^"']*["'][^>]*>\s*<\/script>/gi, '');

    const extra = options.scripts.filter((url) => {
      const name = packageOfScriptUrl(url);
      return !name || !new RegExp(`<script[^>]*src=["'][^"']*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(page);
    });
    const extraTags = extra.length > 0 ? `${extra.map((url) => `<script src="${url}"></script>`).join('\n')}\n` : '';

    return page
      .replace(/<\/head>/i, `${importMapTag}\n${styleTag}\n</head>`)
      .replace(/<\/body>/i, `${extraTags}${bundleTag}\n</body>`);
  }

  const extraTags =
    options.scripts.length > 0 ? `${options.scripts.map((url) => `<script src="${url}"></script>`).join('\n')}\n` : '';
  const mounts = SHELL_MOUNT_POINTS.map((id) => `<div id="${id}"></div>`).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${importMapTag}
<style>${BASE_STYLE}</style>
${styleTag}
</head>
<body>
${mounts}
${extraTags}${bundleTag}
</body>
</html>`;
}

/**
 * Bundles a script entry.
 *
 * A bare import that the folder does not have installed is not an error: it is left external and
 * answered by esm.sh through the import map, which is what makes a Phaser or Three.js game run in
 * a folder that never ran `npm install`.
 */
async function bundleEntry(root: string, entry: string, warnings: string[]): Promise<BundleOutcome> {
  const diagnostics: PreviewDiagnostic[] = [];
  const externalPackages = new Set<string>();
  let esbuild: any;
  try {
    esbuild = await loadEsbuild();
  } catch {
    return {
      html: null,
      diagnostics: [
        bundledResultFailure(
          root,
          entry,
          'esbuild is not available in this build of the app, so a project folder cannot be bundled. Run the app through npm (npm run dev / npm start) to preview real projects.'
        )
      ],
      parts: null,
      warnings,
      composition: null
    };
  }

  const requireFrom = createRequire(path.join(root, 'package.json'));
  const resolveLocally = (specifier: string, resolveDir: string): string | null => {
    try {
      return requireFrom.resolve(specifier, { paths: [resolveDir, root] });
    } catch {
      return null;
    }
  };

  const wrapperSource = `
import * as __epc_module from ${JSON.stringify(entry.startsWith('.') ? entry : `./${entry}`)};
(function () {
  try { window.__EPC_PREVIEW_MODULE__ = __epc_module; } catch (error) {}
  // The keys are looked up through a variable on purpose: a literal property read of "default"
  // makes the bundler warn on every entry that exports nothing — every app that mounts itself.
  function pickExport(mod) {
    var keys = ['default', 'App'];
    for (var i = 0; i < keys.length; i += 1) {
      var value = mod ? mod[keys[i]] : null;
      if (typeof value === 'function') return value;
    }
    return null;
  }
  var exported = pickExport(__epc_module);
  var host = document.getElementById('root') || document.getElementById('app-root');
  if (!exported || typeof exported !== 'function' || !host || host.hasChildNodes()) return;
  // Anything that renders itself already has; a lone component file is mounted here instead.
  Promise.all([import('react'), import('react-dom/client')])
    .then(function (modules) {
      var React = modules[0].default || modules[0];
      var client = modules[1];
      var createRoot = client.createRoot || (client.default && client.default.createRoot);
      if (!createRoot) return;
      createRoot(host).render(React.createElement(exported));
    })
    .catch(function (error) {
      console.error('Preview could not mount the component: ' + (error && error.message ? error.message : error));
    });
})();
`;

  const plugins: any[] = [
    {
      name: 'epc-entry',
      setup(build) {
        build.onResolve({ filter: new RegExp(`^${VIRTUAL_ENTRY}$`) }, () => ({
          path: VIRTUAL_ENTRY,
          namespace: 'epc'
        }));
        build.onLoad({ filter: /.*/, namespace: 'epc' }, () => ({
          contents: wrapperSource,
          loader: 'js',
          resolveDir: root
        }));
      }
    },
    {
      name: 'epc-cdn-fallback',
      setup(build) {
        // Bare specifiers: try the folder's own node_modules first, fall back to a CDN.
        build.onResolve({ filter: /^[a-zA-Z@][^:]*$/ }, (args) => {
          if (args.path === VIRTUAL_ENTRY) return { path: VIRTUAL_ENTRY, namespace: 'epc' };
          const resolveDir = args.resolveDir || path.join(root, path.dirname(entry));
          const local = resolveLocally(args.path, resolveDir);
          if (local) return { path: local };
          // Vite-style alias: '@' means 'src'.
          if (args.path.startsWith('@/')) {
            const aliased = resolveLocally(
              path.join(root, 'src', args.path.slice(2)),
              resolveDir
            );
            if (aliased) return { path: aliased };
          }
          externalPackages.add(args.path);
          return { path: args.path, external: true };
        });
      }
    }
  ];

  const buildOptions = {
    entryPoints: [VIRTUAL_ENTRY],
    absWorkingDir: root,
    bundle: true,
    write: false,
    outdir: '.epc-preview',
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    // The input list is what tells the shell whether the folder's own code expects an engine
    // as a browser global (see globalLibraryScripts).
    metafile: true,
    // Preview text is Cyrillic half the time: without this esbuild escapes every character.
    charset: 'utf8',
    logLevel: 'silent',
    sourcemap: false,
    legalComments: 'none',
    logOverride: { 'unsupported-require-call': 'silent' },
    loader: {
      '.png': 'file',
      '.jpg': 'file',
      '.jpeg': 'file',
      '.gif': 'file',
      '.webp': 'file',
      '.avif': 'file',
      '.bmp': 'file',
      '.ico': 'file',
      '.svg': 'file',
      '.mp3': 'file',
      '.wav': 'file',
      '.ogg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.otf': 'file',
      '.wasm': 'file',
      '.json': 'json',
      '.txt': 'text'
    },
    plugins
  };

  try {
    /**
     * esbuild rejects on a failed build and puts the errors on the failure object, so the errors
     * are read from both places: a rejected build must still answer with per-file diagnostics.
     */
    const runBuild = async (): Promise<any> => {
      try {
        return await esbuild.build(buildOptions);
      } catch (failure: any) {
        if (Array.isArray(failure?.errors) && failure.errors.length > 0) {
          return { errors: failure.errors, warnings: failure.warnings || [], outputFiles: [] };
        }
        throw failure;
      }
    };

    const result = await runBuild();

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        diagnostics.push(diagnosticFrom(error, root, entry));
      }
      return { html: null, parts: null, diagnostics, warnings, composition: null };
    }

    for (const warning of result.warnings.slice(0, 10)) {
      warnings.push(diagnosticFrom(warning, root, entry).text);
    }

    const jsFile = result.outputFiles.find((file) => file.path.endsWith('.js'));
    const cssFile = result.outputFiles.find((file) => file.path.endsWith('.css'));
    if (!jsFile) {
      diagnostics.push(bundledResultFailure(root, entry, 'The bundle produced no JavaScript output.'));
      return { html: null, parts: null, diagnostics, warnings, composition: null };
    }
    if (jsFile.contents.byteLength > MAX_BUNDLE_BYTES) {
      diagnostics.push(
        bundledResultFailure(
          root,
          entry,
          `The bundle is ${Math.round(jsFile.contents.byteLength / 1_000_000)} MB — too large to run in the sandbox.`
        )
      );
      return { html: null, parts: null, diagnostics, warnings, composition: null };
    }

    const importMap: Record<string, string> = {};
    for (const specifier of externalPackages) {
      importMap[specifier] = `https://esm.sh/${specifier}`;
      // Subpath imports ('react-dom/client') are separate keys in an import map, and esm.sh
      // answers them directly, so the entry above is enough for both.
    }

    const projectHtml = fileExists(path.join(root, 'index.html'))
      ? (() => {
          try {
            const inlined = inlineDocument(root, 'index.html', warnings);
            return withInterceptor(inlined);
          } catch {
            return null;
          }
        })()
      : null;

    // A game that was never installed still has to run: the folder's own sources are what decide
    // whether an engine has to arrive as a tag in front of the bundle.
    const localInputs = Object.keys(result.metafile?.inputs || {})
      .filter((key) => key !== VIRTUAL_ENTRY && !key.includes('node_modules'))
      .map((key) => toWorkspaceRelative(root, key))
      .filter((value): value is string => Boolean(value));
    const scripts = globalLibraryScripts(root, localInputs, resolveLocally, warnings);

    const assetFiles = result.outputFiles
      .filter((file) => !file.path.endsWith('.js') && !file.path.endsWith('.css'))
      .map((file) => ({
        name: outputName(file.path),
        contents: Buffer.from(file.contents),
        contentType: contentTypeForFile(file.path)
      }));
    const assetNames = assetFiles.map((asset) => asset.name);

    const parts: BundleParts = {
      jsName: outputName(jsFile.path),
      js: redirectAssetUrls(jsFile.text, assetNames),
      cssName: cssFile ? outputName(cssFile.path) : null,
      css: cssFile ? redirectAssetUrls(cssFile.text, assetNames) : '',
      importMap,
      scripts,
      projectHtml: projectHtml ? stripFolderScripts(root, projectHtml, 'index.html') : null,
      assets: assetFiles
    };

    return {
      html: bundleShell({
        projectHtml,
        css: cssFile ? cssFile.text : '',
        js: jsFile.text,
        importMap: Object.keys(importMap).length > 0 ? importMap : null,
        scripts
      }),
      parts,
      diagnostics,
      warnings,
      // What the bundle is made of, straight from the bundler's own report.
      composition: describeBundleComposition({
        metafile: result.metafile,
        root,
        jsBytes: jsFile.contents.byteLength,
        cssBytes: cssFile ? cssFile.contents.byteLength : 0,
        externals: externalPackages
      })
    };
  } catch (error: any) {
    diagnostics.push(bundledResultFailure(root, entry, error?.message || 'The bundle failed.'));
    return { html: null, parts: null, diagnostics, warnings, composition: null };
  }
}

/** The package a bundled module came from, or null when it is one of the folder's own files. */
function packageOfInput(inputPath: string): string | null {
  const parts = inputPath.split('\\').join('/').split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index === -1) return null;
  const rest = parts.slice(index + 1);
  if (rest.length === 0) return null;
  // A scoped package is two segments ('@scope/name'); everything else is one.
  return rest[0].startsWith('@') && rest.length > 1 ? `${rest[0]}/${rest[1]}` : rest[0];
}

/**
 * What the bundle is made of, from esbuild's metafile.
 *
 * `bytesInOutput` is the bundler's own attribution: it already accounts for tree shaking and
 * minification, so a package that is imported but never used does not get blamed for weight it
 * did not add. Everything is grouped — all the files of one dependency become one line — because
 * "which dependency" is the question worth answering, not which file inside it.
 */
function describeBundleComposition(input: {
  metafile: any;
  root: string;
  jsBytes: number;
  cssBytes: number;
  externals: Set<string>;
}): BundleComposition | null {
  const outputs = input.metafile?.outputs;
  if (!outputs || typeof outputs !== 'object') return null;

  const totals = new Map<string, BundleCompositionPart>();
  for (const output of Object.values<any>(outputs)) {
    const inputs = output?.inputs;
    if (!inputs || typeof inputs !== 'object') continue;
    for (const [inputPath, info] of Object.entries<any>(inputs)) {
      if (inputPath === VIRTUAL_ENTRY) continue;
      const bytes = Number(info?.bytesInOutput) || 0;
      if (bytes <= 0) continue;

      const pkg = packageOfInput(inputPath);
      const local = pkg ? null : toWorkspaceRelative(input.root, inputPath);
      // A file outside the folder that is not a package (a Node builtin, a generated file) is not
      // something the user can act on, so it is not named.
      if (!pkg && !local) continue;

      const kind: 'local' | 'package' = pkg ? 'package' : 'local';
      const name = pkg || local!;
      const key = `${kind}:${name}`;
      const existing = totals.get(key);
      if (existing) {
        existing.bytes += bytes;
        continue;
      }
      totals.set(key, { name, kind, bytes, pct: 0 });
    }
  }

  if (totals.size === 0) return null;

  const outputBytes = input.jsBytes + input.cssBytes;
  const sorted = [...totals.values()].sort((a, b) => b.bytes - a.bytes);
  const parts = sorted.slice(0, MAX_COMPOSITION_PARTS).map((part) => ({
    ...part,
    pct: outputBytes > 0 ? Math.round((part.bytes / outputBytes) * 1000) / 10 : 0
  }));

  return {
    bytes: outputBytes,
    parts,
    externals: [...input.externals].slice(0, MAX_COMPOSITION_EXTERNALS),
    truncated: sorted.length > parts.length
  };
}

/** The name a build output is served under — esbuild reports a platform path, not a URL. */
function outputName(filePath: string): string {
  return path.basename(filePath.split('\\').join('/'));
}

/**
 * Points the bundle's asset references at the preview origin.
 *
 * esbuild writes an emitted asset as a path next to the bundle (`./asset-ABC123.png`). The bundle is
 * not served from a folder — it is served from the origin's artifact route — so every reference to an
 * emitted file is rewritten to that route. Assets keep real URLs this way, which is the whole point:
 * a data URL cannot be streamed into WebAssembly, fetched by a worker, or used as an asset base.
 */
function redirectAssetUrls(source: string, names: string[]): string {
  let output = source;
  for (const name of names) {
    output = output.split(`./${name}`).join(`${ARTIFACT_URL_PREFIX}/${name}`);
    output = output.split(`"${name}"`).join(`"${ARTIFACT_URL_PREFIX}/${name}"`);
  }
  return output;
}

/** The content type a file is served with — the browser's own decisions are the faithful ones. */
export function contentTypeForFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8';
  if (extension === '.json' || extension === '.map') return 'application/json; charset=utf-8';
  if (extension === '.wasm') return 'application/wasm';
  if (extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.jsx' || extension === '.ts' || extension === '.tsx' || extension === '.vue' || extension === '.svelte') {
    return 'text/plain; charset=utf-8';
  }
  return MIME_TYPES[extension] || 'application/octet-stream';
}

/**
 * Removes the scripts a bundle replaces.
 *
 * Only tags pointing at a path inside the folder are dropped: those files are inside the bundle now,
 * and running them a second time is what makes an app mount twice. Tags that point at the network
 * are the project's own libraries and are left exactly as the author wrote them.
 */
function stripFolderScripts(root: string, html: string, documentPath: string): string {
  const baseDir = path.posix.dirname(documentPath);
  return html.replace(/<script\b[^>]*\bsrc\s*=\s*["'](?!https?:|\/\/)[^"']*["'][^>]*>\s*<\/script>/gi, (tag) => {
    const src = attributeOf(tag, 'src') || '';
    return resolveDocumentReference(baseDir, src) ? '' : tag;
  });
}

/**
 * The page the preview origin serves for a bundled project.
 *
 * Every reference is a real URL on the preview's own origin: the bundle, its stylesheet and the
 * emitted assets. Nothing is inlined, so the document behaves like the built site it is.
 */
function servedBundleDocument(parts: BundleParts): string {
  const importMapTag =
    Object.keys(parts.importMap).length > 0
      ? `<script type="importmap">${JSON.stringify({ imports: parts.importMap })}</script>`
      : '';
  const cssTag = parts.cssName
    ? `<link rel="stylesheet" href="${ARTIFACT_URL_PREFIX}/${parts.cssName}">`
    : '';
  const engineTags = parts.scripts.map((url) => `<script src="${url}"></script>`).join('\n');
  const bundleTag = `<script type="module" src="${ARTIFACT_URL_PREFIX}/${parts.jsName}"></script>`;

  if (parts.projectHtml) {
    return parts.projectHtml
      .replace(/<\/head>/i, `${importMapTag}\n${cssTag}\n</head>`)
      .replace(/<\/body>/i, `${engineTags}\n${bundleTag}\n</body>`);
  }

  const mounts = SHELL_MOUNT_POINTS.map((id) => `<div id="${id}"></div>`).join('\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${importMapTag}
<style>${BASE_STYLE}</style>
${cssTag}
</head>
<body>
${mounts}
${engineTags}
${bundleTag}
</body>
</html>`;
}

/**
 * Libraries and features that only work with cross-origin isolation.
 *
 * Shared memory, threaded WebAssembly and the engines that build on them (Unity, Godot, ffmpeg,
 * emscripten pthread builds) need COOP+COEP on the *document's* response — something an inline
 * `srcDoc` document cannot have at all, and something a plain page should not pay for otherwise,
 * since `require-corp` can hide third-party assets.
 */
const ISOLATION_MARKERS = [
  /SharedArrayBuffer/,
  /crossOriginIsolated/,
  /Atomics\s*\./,
  /pthread/,
  /-s\s*USE_PTHREADS/,
  /\.wasm\?\w*threads/,
  /unity(loader|framework|\.)/i,
  /godot/i,
  /ffmpeg(-core)?/i,
  /emscripten/i
];

/** True when the project's own code asks for cross-origin isolation. */
export function needsCrossOriginIsolation(root: string, sourceFiles: string[]): boolean {
  const sources: string[] = [];
  for (const relativePath of sourceFiles.slice(0, 40)) {
    const text = readText(relativePath, 400_000);
    if (text !== null) sources.push(text);
  }
  if (sources.length === 0) return false;
  const code = sources.join('\n');
  return ISOLATION_MARKERS.some((marker) => marker.test(code));
}

/**
 * The plan the preview origin serves: which file is the document, and what has to be kept in memory
 * because it does not exist on disk.
 */
export interface PreviewPlanResult {
  ok: boolean;
  kind: PreviewKind | null;
  entry: string | null;
  /** Workspace-relative path served at `/`. Null when the document is generated. */
  documentPath: string | null;
  /** Generated document served at `/` (bundled entries without a page of their own). */
  document: string | null;
  assets: Array<{ name: string; contents: Buffer; contentType: string }>;
  isolation: boolean;
  diagnostics: PreviewDiagnostic[];
  warnings: string[];
  candidates: PreviewCandidate[];
  durationMs: number;
  root: string;
  /** What the served bundle is made of, for a script entry. Null when nothing was bundled. */
  composition: BundleComposition | null;
}

/**
 * Builds what the preview origin should serve for the connected folder.
 *
 * A page is served as it is on disk: its stylesheets, scripts, images, workers and WebAssembly are
 * requested by the browser from the folder itself, which is the only way a project looks exactly
 * like it does when the folder is opened normally. A script entry is bundled, and the bundle plus
 * everything esbuild emitted is served from the same origin.
 */
export async function buildPreviewPlan(entryPath?: unknown): Promise<PreviewPlanResult> {
  const startedAt = Date.now();
  const root = getWorkspaceRoot();
  const base = {
    assets: [] as PreviewPlanResult['assets'],
    durationMs: 0,
    root: root || '',
    composition: null as BundleComposition | null
  };

  if (!root) {
    return {
      ...base,
      ok: false,
      kind: null,
      entry: null,
      documentPath: null,
      document: null,
      isolation: false,
      candidates: [],
      warnings: [],
      diagnostics: [
        {
          file: '',
          line: null,
          column: null,
          text: 'No project folder is connected yet, so there is nothing to run.'
        }
      ]
    };
  }

  const candidates = listPreviewCandidates(root);
  const requested = typeof entryPath === 'string' && entryPath.trim() ? toPosix(entryPath.trim()) : null;
  const fallback = pickDefaultEntry(root, candidates);
  const chosen = (requested ? candidates.find((candidate) => candidate.path === requested) : undefined) || fallback;
  const orderedCandidates = chosen
    ? [chosen, ...candidates.filter((candidate) => candidate.path !== chosen.path)]
    : candidates;

  const fail = (diagnostics: PreviewDiagnostic[], warnings: string[] = []) => ({
    ...base,
    ok: false,
    kind: chosen ? chosen.kind : null,
    entry: chosen ? chosen.path : null,
    documentPath: null,
    document: null,
    isolation: false,
    candidates: orderedCandidates,
    warnings,
    diagnostics,
    durationMs: Date.now() - startedAt
  });

  if (!chosen) {
    return fail([
      {
        file: '',
        line: null,
        column: null,
        text:
          'Nothing to run in this folder: no index.html and no entry script (src/main.tsx, src/main.js, index.js …).'
      }
    ]);
  }

  const warnings: string[] = [];
  try {
    if (chosen.kind === 'static') {
      // The page is served untouched apart from the console bridge the app injects, and the folder's
      // own files answer every request the page makes.
      const isolation = needsCrossOriginIsolation(root, localHtmlSources(root, chosen.path));
      return {
        ...base,
        ok: true,
        kind: 'static',
        entry: chosen.path,
        documentPath: chosen.path,
        document: null,
        isolation,
        candidates: orderedCandidates,
        warnings: [...new Set(warnings)].slice(0, 12),
        diagnostics: [],
        durationMs: Date.now() - startedAt
      };
    }

    const bundled = await bundleEntry(root, chosen.path, warnings);
    if (!bundled.parts) {
      return fail(bundled.diagnostics, [...new Set(warnings)].slice(0, 12));
    }

    const isolation = needsCrossOriginIsolation(root, [chosen.path]);
    return {
      ...base,
      ok: true,
      kind: 'bundle',
      entry: chosen.path,
      documentPath: null,
      document: servedBundleDocument(bundled.parts),
      assets: [
        { name: bundled.parts.jsName, contents: Buffer.from(bundled.parts.js, 'utf8'), contentType: 'text/javascript; charset=utf-8' },
        ...(bundled.parts.cssName
          ? [
              {
                name: bundled.parts.cssName,
                contents: Buffer.from(bundled.parts.css, 'utf8'),
                contentType: 'text/css; charset=utf-8'
              }
            ]
          : []),
        ...bundled.parts.assets
      ],
      isolation,
      candidates: orderedCandidates,
      warnings: [...new Set(warnings)].slice(0, 12),
      diagnostics: bundled.diagnostics,
      durationMs: Date.now() - startedAt,
      // The screen that shows the running bundle also says what is inside it.
      composition: bundled.composition
    };
  } catch (error: any) {
    const code = error instanceof WorkspaceError ? error.code : null;
    return fail(
      [
        {
          file: chosen.path,
          line: null,
          column: null,
          text: code ? `${code}: ${error.message}` : error?.message || 'The preview could not be built.'
        }
      ],
      [...new Set(warnings)].slice(0, 12)
    );
  }
}

/** The page and the folder-local scripts it loads — the code that decides about isolation. */
function localHtmlSources(root: string, documentPath: string): string[] {
  const sources = [documentPath];
  const html = readText(documentPath, 400_000);
  if (html === null) return sources;
  const baseDir = path.posix.dirname(documentPath);
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const target = resolveDocumentReference(baseDir, match[1]);
    if (target) sources.push(target);
  }
  return sources;
}

/**
 * Builds the runnable document for the connected folder.
 *
 * `entryPath` is the candidate the user picked; without one the first candidate wins, which is the
 * project's own index.html when it has one.
 */
export async function buildPreview(entryPath?: unknown): Promise<PreviewBuildResult> {
  const startedAt = Date.now();
  const root = getWorkspaceRoot();
  const candidates = listPreviewCandidates(root);

  if (!root) {
    return {
      ok: false,
      kind: null,
      entry: null,
      html: null,
      diagnostics: [
        {
          file: '',
          line: null,
          column: null,
          text: 'No project folder is connected yet, so there is nothing to run.'
        }
      ],
      warnings: [],
      candidates: [],
      durationMs: Date.now() - startedAt,
      root: ''
    };
  }

  const requested = typeof entryPath === 'string' && entryPath.trim() ? toPosix(entryPath.trim()) : null;
  const fallback = pickDefaultEntry(root, candidates);
  const chosen = (requested ? candidates.find((candidate) => candidate.path === requested) : undefined) || fallback;

  // The default entry leads the list, so the picker opens on what the screen actually runs.
  const orderedCandidates = chosen
    ? [chosen, ...candidates.filter((candidate) => candidate.path !== chosen.path)]
    : candidates;

  if (!chosen) {
    return {
      ok: false,
      kind: null,
      entry: null,
      html: null,
      diagnostics: [
        {
          file: '',
          line: null,
          column: null,
          text:
            'Nothing to run in this folder: no index.html and no entry script (src/main.tsx, src/main.js, index.js …).'
        }
      ],
      warnings: [],
      candidates: orderedCandidates,
      durationMs: Date.now() - startedAt,
      root
    };
  }

  const warnings: string[] = [];
  try {
    if (chosen.kind === 'static') {
      const html = withInterceptor(inlineDocument(root, chosen.path, warnings));
      return {
        ok: true,
        kind: 'static',
        entry: chosen.path,
        html,
        diagnostics: [],
        warnings: [...new Set(warnings)].slice(0, 12),
        candidates: orderedCandidates,
        durationMs: Date.now() - startedAt,
        root
      };
    }

    const bundled = await bundleEntry(root, chosen.path, warnings);
    return {
      ok: Boolean(bundled.html),
      kind: 'bundle',
      entry: chosen.path,
      html: bundled.html,
      diagnostics: bundled.diagnostics,
      warnings: [...new Set(warnings)].slice(0, 12),
      candidates: orderedCandidates,
      durationMs: Date.now() - startedAt,
      root,
      composition: bundled.composition
    };
  } catch (error: any) {
    const code = error instanceof WorkspaceError ? error.code : null;
    return {
      ok: false,
      kind: chosen.kind,
      entry: chosen.path,
      html: null,
      diagnostics: [
        {
          file: chosen.path,
          line: null,
          column: null,
          text: code ? `${code}: ${error.message}` : error?.message || 'The preview could not be built.'
        }
      ],
      warnings: [...new Set(warnings)].slice(0, 12),
      candidates: orderedCandidates,
      durationMs: Date.now() - startedAt,
      root
    };
  }
}
