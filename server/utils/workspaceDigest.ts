import type { ProjectFile } from '../../src/types';

/**
 * Turns a real project folder into something an AI can understand.
 *
 * The app may only see a file tree and a handful of file contents, so this module decides which
 * files "say something about themselves" (README, manifests, rules, entry points), reads their
 * text into a prompt-sized digest, and — with no API key — infers the stack straight from the
 * file names so the import never ends up as an empty generic project.
 */

export interface DigestFileEntry {
  path: string;
  type?: ProjectFile['type'];
  sizeBytes?: number;
  isText?: boolean;
}

export interface DigestKeyFile {
  path: string;
  content: string;
}

export interface WorkspaceSignals {
  projectType: string;
  engineOrFramework: string;
  language: string;
  frameworks: string[];
  entryPoints: string[];
  topFolders: string[];
  /** Short, human-readable findings that explain where the guess came from. */
  evidence: string[];
  fileCount: number;
  extensions: { ext: string; count: number }[];
}

export interface WorkspaceDigest {
  text: string;
  signals: WorkspaceSignals;
  keyFiles: DigestKeyFile[];
}

/** Files whose contents describe the project best, most informative first. */
const README_RE = /(^|\/)readme(\.|$)/i;
const RULES_RE = /(^|\/)(agents\.md|claude\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md)$/i;
const DOC_RE = /(^|\/)(architecture|design|spec|about|overview|game[-_]?design).*\.(md|txt)$/i;
const MANIFEST_NAMES = new Set([
  'package.json',
  'composer.json',
  'pubspec.yaml',
  'cargo.toml',
  'go.mod',
  'requirements.txt',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gemfile',
  'project.godot',
  'tsconfig.json',
  'manifest.json',
  'info.plist'
]);
const ENTRY_RE = /(^|\/)(main|index|app|program|game|bootstrap|server|client|player|gamemanager|game_manager|world|scene)\.(ts|tsx|js|jsx|mjs|cjs|py|cs|gd|dart|go|rs|java|kt|c|cc|cpp|h|hpp|lua|rb|php)$/i;

/** How many files are read into the digest, and how much of each one. */
const MAX_KEY_FILES = 8;
const MAX_KEY_FILE_CHARS = 2500;
const MAX_DIGEST_PATHS = 220;

function depthOf(filePath: string): number {
  return filePath.split('/').length - 1;
}

function baseName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function extensionOf(filePath: string): string {
  const name = baseName(filePath).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.cs', '.gd', '.dart', '.go', '.rs', '.java',
  '.kt', '.swift', '.cpp', '.cc', '.c', '.h', '.hpp', '.lua', '.rb', '.php', '.sh', '.ps1', '.bat',
  '.html', '.htm', '.css', '.scss', '.vue', '.svelte', '.sql'
]);
const SCENE_EXTENSIONS = new Set(['.unity', '.tscn', '.scene', '.umap', '.prefab', '.tres', '.res', '.asset']);
const CONFIG_EXTENSIONS = new Set([
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.plist', '.gradle', '.properties',
  '.csproj', '.sln', '.asmdef', '.props', '.targets', '.editorconfig', '.json', '.jsonc', '.md', '.txt'
]);

/**
 * A file may arrive with no type (e.g. from a pasted list), so the extension is the fallback
 * that keeps the ranking and the plan honest.
 */
function effectiveType(file: DigestFileEntry): ProjectFile['type'] {
  if (file.type) return file.type;
  const ext = extensionOf(file.path);
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  return 'asset';
}

function priority(file: DigestFileEntry, index: number): number {
  const name = baseName(file.path).toLowerCase();
  if (README_RE.test(file.path)) return 0;
  if (MANIFEST_NAMES.has(name)) return 1;
  if (RULES_RE.test(file.path)) return 2;
  if (DOC_RE.test(file.path)) return 3;
  if (ENTRY_RE.test(file.path)) return 4;
  const type = effectiveType(file);
  if (type === 'config') return 6;
  if (type === 'code' || type === 'scene' || type === 'prefab') return 5 + depthOf(file.path);
  return 20 + index;
}

/** The files worth reading first: what it is (README/manifest) before how it is written (code). */
export function pickKeyFiles(files: DigestFileEntry[], max = MAX_KEY_FILES): DigestFileEntry[] {
  return files
    .map((file, index) => ({ file, rank: priority(file, index) }))
    .filter((entry) => entry.rank < 20)
    .sort((a, b) => a.rank - b.rank || a.file.path.localeCompare(b.file.path))
    .slice(0, max)
    .map((entry) => entry.file);
}

function countByExtension(files: DigestFileEntry[]): { ext: string; count: number }[] {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const ext = extensionOf(file.path);
    if (!ext) return;
    counts.set(ext, (counts.get(ext) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
}

function topLevelFolders(files: DigestFileEntry[]): string[] {
  const folders = new Map<string, number>();
  files.forEach((file) => {
    const [first] = file.path.split('/');
    if (file.path.includes('/') && first) folders.set(first, (folders.get(first) || 0) + 1);
  });
  return [...folders.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .slice(0, 12);
}

/**
 * Works out the stack from what is actually in the folder. This is the honest baseline: it only
 * claims what the files prove, and it doubles as the offline fallback when there is no API key.
 */
export function detectSignals(files: DigestFileEntry[], contents: DigestKeyFile[] = []): WorkspaceSignals {
  const paths = files.map((file) => file.path);
  const lowerPaths = paths.map((value) => value.toLowerCase());
  const manifests = contents.filter((file) => MANIFEST_NAMES.has(baseName(file.path).toLowerCase()));
  const manifestText = manifests.map((file) => file.content.toLowerCase()).join('\n');
  const readme = contents.find((file) => README_RE.test(file.path))?.content || '';
  const extensions = countByExtension(files);
  const evidence: string[] = [];
  const frameworks: string[] = [];

  const has = (ext: string) => extensions.some((entry) => entry.ext === ext);
  const countOf = (ext: string) => extensions.find((entry) => entry.ext === ext)?.count || 0;
  const hasPath = (fragment: string) => lowerPaths.some((value) => value.includes(fragment));

  const entryPoints = paths.filter((value) => ENTRY_RE.test(value)).slice(0, 6);

  let projectType = 'Generic';
  let engineOrFramework = 'Generic';
  let language = 'Unknown';

  const unityScripts = paths.filter((value) => /\.cs$/i.test(value)).length;
  const isUnity = hasPath('assets/') && (unityScripts > 0 || has('.unity') || has('.prefab'));
  const isGodot = hasPath('project.godot') || has('.gd') || has('.tscn');
  const isUnreal = hasPath('.uproject') || (hasPath('source/') && has('.cpp'));
  const isPhaser = /"phaser"/.test(manifestText) || hasPath('phaser');
  const isThree = /"three"|@react-three/.test(manifestText) || hasPath('three');
  const isReact = /"react"/.test(manifestText) || has('.tsx') || has('.jsx');
  const isNext = /"next"/.test(manifestText) || hasPath('next.config');
  const isVue = /"vue"/.test(manifestText) || has('.vue');
  const isSvelte = /"svelte"/.test(manifestText) || has('.svelte');
  const isNode = hasPath('package.json');
  const isPython = has('.py') || hasPath('requirements.txt') || hasPath('pyproject.toml');
  const isFlutter = has('.dart') || hasPath('pubspec.yaml');
  const isRust = has('.rs') || hasPath('cargo.toml');
  const isGo = has('.go') || hasPath('go.mod');
  const isDotnet = hasPath('.csproj') || hasPath('.sln');
  const isHtml = has('.html') || has('.htm');

  if (isUnity) {
    projectType = 'Unity';
    engineOrFramework = 'Unity 6 (URP)';
    language = 'C#';
    evidence.push(`Папка Assets/ и ${unityScripts} скриптов на C#`);
  } else if (isGodot) {
    projectType = 'Godot';
    engineOrFramework = 'Godot 4 (GDScript)';
    language = 'GDScript';
    evidence.push('Файлы Godot (.gd/.tscn) или project.godot');
  } else if (isUnreal) {
    projectType = 'Unreal Engine';
    engineOrFramework = 'Unreal Engine 5 (C++ / Blueprint)';
    language = 'C++ / Blueprint';
    evidence.push('Файл .uproject и исходники C++ в Source/');
  } else if (isFlutter) {
    projectType = 'Flutter';
    engineOrFramework = 'Flutter (Dart)';
    language = 'Dart';
    evidence.push('pubspec.yaml или файлы .dart');
  } else if (isNext) {
    projectType = 'Next.js';
    engineOrFramework = 'Next.js (React / Node)';
    language = has('.ts') || has('.tsx') ? 'TypeScript' : 'JavaScript';
    evidence.push('Зависимость next в package.json');
  } else if (isPhaser) {
    projectType = 'Phaser.js';
    engineOrFramework = 'Phaser.js 3 (Canvas / WebGL)';
    language = has('.ts') || has('.tsx') ? 'TypeScript' : 'JavaScript';
    evidence.push('Зависимость phaser в package.json');
  } else if (isThree) {
    projectType = 'Three.js';
    engineOrFramework = 'Three.js / React Three Fiber';
    language = has('.ts') || has('.tsx') ? 'TypeScript' : 'JavaScript';
    evidence.push('Зависимость three / @react-three в package.json');
  } else if (isReact) {
    projectType = 'React';
    engineOrFramework = 'React + Vite';
    language = has('.ts') || has('.tsx') ? 'TypeScript' : 'JavaScript';
    evidence.push(has('.tsx') || has('.jsx') ? 'Компоненты .tsx/.jsx в папке' : 'Зависимость react в package.json');
  } else if (isVue) {
    projectType = 'Generic';
    engineOrFramework = 'Vue';
    language = has('.ts') ? 'TypeScript' : 'JavaScript';
    evidence.push('Зависимость vue или файлы .vue');
  } else if (isSvelte) {
    projectType = 'Generic';
    engineOrFramework = 'Svelte';
    language = has('.ts') ? 'TypeScript' : 'JavaScript';
    evidence.push('Зависимость svelte или файлы .svelte');
  } else if (isPlainNodeProject(manifestText, isNode)) {
    projectType = 'Node.js';
    engineOrFramework = 'Node.js';
    language = has('.ts') ? 'TypeScript' : 'JavaScript';
    evidence.push('package.json без UI-фреймворка — серверный проект');
  } else if (isPython) {
    projectType = 'Python';
    engineOrFramework = hasPath('fastapi') || /fastapi/.test(manifestText) ? 'Python FastAPI' : 'Python';
    language = 'Python';
    evidence.push('Файлы .py или requirements/pyproject');
  } else if (isRust) {
    projectType = 'Generic';
    engineOrFramework = 'Rust (Cargo)';
    language = 'Rust';
    evidence.push('Cargo.toml или файлы .rs');
  } else if (isGo) {
    projectType = 'Generic';
    engineOrFramework = 'Go modules';
    language = 'Go';
    evidence.push('go.mod или файлы .go');
  } else if (isDotnet) {
    projectType = 'Generic';
    engineOrFramework = 'C# / .NET';
    language = 'C#';
    evidence.push('.csproj/.sln — проект на C#');
  } else if (isHtml) {
    projectType = 'Generic';
    engineOrFramework = 'HTML / CSS / JavaScript';
    language = 'JavaScript';
    evidence.push('Страницы .html и скрипты .js');
  } else if (extensions.length > 0) {
    language = languageForExtension(extensions[0].ext);
    engineOrFramework = `Проект на ${language}`;
    evidence.push(`Преобладают файлы ${extensions[0].ext}`);
  }

  if (readme) {
    const firstLine = readme.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find((line) => line.length > 3);
    if (firstLine) evidence.push(`README: ${firstLine.slice(0, 120)}`);
  }

  const topFolders = topLevelFolders(files);
  if (topFolders.length > 0) evidence.push(`Основные папки: ${topFolders.slice(0, 5).join(', ')}`);

  frameworks.push(engineOrFramework);
  manifests.forEach((file) => {
    if (baseName(file.path).toLowerCase() === 'package.json') {
      try {
        const parsed = JSON.parse(file.content);
        const deps = Object.keys({ ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) });
        frameworks.push(...deps.slice(0, 12));
      } catch {
        /* A broken manifest still said enough by existing. */
      }
    }
  });

  return {
    projectType,
    engineOrFramework,
    language,
    frameworks: [...new Set(frameworks)].filter(Boolean),
    entryPoints,
    topFolders,
    evidence,
    fileCount: files.length,
    extensions
  };
}

/** package.json with no UI framework in it is a service, not a page. */
function isPlainNodeProject(manifestText: string, hasPackageJson: boolean): boolean {
  if (!hasPackageJson) return false;
  return !/"react"|"vue"|"svelte"|"next"|"angular"|"phaser"|"three"/.test(manifestText);
}

function languageForExtension(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.py': 'Python',
    '.cs': 'C#',
    '.gd': 'GDScript',
    '.dart': 'Dart',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.swift': 'Swift',
    '.cpp': 'C++',
    '.cc': 'C++',
    '.c': 'C',
    '.h': 'C/C++',
    '.hpp': 'C++',
    '.rs': 'Rust',
    '.go': 'Go',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.lua': 'Lua'
  };
  return map[ext] || ext.replace('.', '').toUpperCase();
}

/** Builds the prompt-ready digest: the tree, the findings and the contents of the key files. */
export function buildWorkspaceDigest(
  files: DigestFileEntry[],
  contents: DigestKeyFile[] = [],
  options: { maxPaths?: number } = {}
): WorkspaceDigest {
  const maxPaths = options.maxPaths ?? MAX_DIGEST_PATHS;
  const signals = detectSignals(files, contents);

  const listed = files.slice(0, maxPaths);
  const tree = listed
    .map((file) => `- ${file.path}${file.sizeBytes !== undefined ? ` (${file.type || 'file'}, ${file.sizeBytes} B)` : ''}`)
    .join('\n');
  const treeNote = files.length > listed.length ? `\n... и ещё ${files.length - listed.length} файлов` : '';

  const keyFiles = contents.map((file) => ({
    path: file.path,
    content: file.content.length > MAX_KEY_FILE_CHARS ? `${file.content.slice(0, MAX_KEY_FILE_CHARS)}\n...(сокращено)` : file.content
  }));

  const contentsBlock = keyFiles
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join('\n\n');

  const text = [
    `Файлов в папке проекта: ${files.length}`,
    ``,
    `ДЕРЕВО ФАЙЛОВ:`,
    tree + treeNote,
    ``,
    `ЧТО УДАЛОСЬ ОПРЕДЕЛИТЬ ПО ФАЙЛАМ:`,
    signals.evidence.map((line) => `- ${line}`).join('\n') || '- ничего явного',
    ``,
    `СОДЕРЖИМОЕ КЛЮЧЕВЫХ ФАЙЛОВ:`,
    contentsBlock || '(недоступно)'
  ].join('\n');

  return { text, signals, keyFiles };
}

/** Trims a file content down to what is useful for understanding, not for editing. */
export function clipFileContent(content: string, limit = MAX_KEY_FILE_CHARS): string {
  const trimmed = (content || '').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n...(сокращено)` : trimmed;
}

/**
 * The plan shape shared with `/api/project/create-idea` — the client builds a project from it the
 * same way, no matter whether the description came from an idea or from a real folder.
 */
export interface ImportedProjectPayload {
  projectName: string;
  projectType: string;
  engineOrFramework: string;
  language: string;
  tagline: string;
  targetAudience: string;
  coreProblem: string;
  coreValue: string;
  mvpFeatures: string[];
  futureFeatures: string[];
  nonGoals: string[];
  technicalConstraints: string[];
  successCriteria: string[];
  clarifyingQuestions: string[];
  architecture: {
    technologyStack: string[];
    folderStructure: string[];
    coreEntities: string[];
    dataFlow: string;
    testingStrategy: string;
    deploymentPlan: string;
    securityRisks: string[];
  };
  phases: Array<{
    phaseNumber: number;
    title: string;
    purpose: string;
    deliverable: string;
    tasks: Array<{
      title: string;
      goal: string;
      relevantFiles: string[];
      acceptanceCriteria: string[];
      testRequirements: string[];
      estimatedComplexity: string;
      dependencies: string[];
    }>;
  }>;
}

/**
 * Windows sends `src\\App.tsx`, a pasted list may say `./src/App.tsx` — the same file either way.
 * The key is only ever used to look a path up, the stored value stays the path that really exists.
 */
function normalizePathKey(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

/**
 * Whether an AI plan can actually drive the flow. The model sometimes answers with a good
 * description of the project but an empty (or task-less) plan, and an imported project with no
 * tasks stalls on the first screen — so this decides if a plan is usable at all.
 */
export function planHasTasks(plan: { phases?: Array<{ tasks?: unknown[] }> | null } | null | undefined): boolean {
  return (plan?.phases || []).some((phase) => (phase?.tasks || []).length > 0);
}

/**
 * The model is told that every `relevantFiles` entry must be a path from the real tree, and it
 * usually obeys — but not always. A task that points at a file the project does not have sends the
 * agent to a dead end, so the plan is aligned with the real folder before it leaves the server.
 */
export function alignPlanFilesToWorkspace<
  T extends {
    architecture?: { coreEntities?: string[] } | null;
    phases?: Array<{ tasks?: Array<{ relevantFiles?: string[] }> }> | null;
  }
>(plan: T, files: DigestFileEntry[]): T {
  const knownPaths = new Map<string, string>();
  files.forEach((file) => {
    const key = normalizePathKey(file.path);
    if (key && !knownPaths.has(key)) knownPaths.set(key, file.path);
  });
  if (knownPaths.size === 0) return plan;

  // What a task can fall back to when the model named nothing real at all.
  const fallbackFiles = pickKeyFiles(files, 4).map((file) => file.path);

  const align = (paths: unknown): string[] => {
    const result: string[] = [];
    (Array.isArray(paths) ? paths : []).forEach((value) => {
      const real = knownPaths.get(normalizePathKey(String(value)));
      if (real && !result.includes(real)) result.push(real);
    });
    return result;
  };

  const phases = (plan.phases || []).map((phase) => ({
    ...phase,
    tasks: (phase.tasks || []).map((task) => {
      const aligned = align(task.relevantFiles);
      return { ...task, relevantFiles: aligned.length > 0 ? aligned : fallbackFiles };
    })
  }));

  const entities = align(plan.architecture?.coreEntities);

  return {
    ...plan,
    architecture: plan.architecture
      ? { ...plan.architecture, coreEntities: entities.length > 0 ? entities : fallbackFiles }
      : plan.architecture,
    phases
  } as T;
}

/** The paths a task should point at, always taken from the real folder. */
function realFiles(files: DigestFileEntry[], matcher: (file: DigestFileEntry) => boolean, fallback: string[]): string[] {
  const matched = files.filter(matcher).map((file) => file.path).slice(0, 4);
  return matched.length > 0 ? matched : fallback.slice(0, 4);
}

/**
 * Understands the project without an AI provider: the plan is built from the real file names and
 * the detected stack, so even offline the imported project keeps its real paths and structure
 * instead of falling back to a generic placeholder.
 */
export function buildLocalImportProject(params: {
  signals: WorkspaceSignals;
  files: DigestFileEntry[];
  isRu: boolean;
  projectName?: string;
  folderName?: string;
}): ImportedProjectPayload {
  const { signals, files, isRu } = params;
  const name = (params.projectName || '').trim() || params.folderName || (isRu ? 'Импортированный проект' : 'Imported project');

  const codeFiles = files.filter((file) => {
    const type = effectiveType(file);
    return type === 'code' || type === 'scene' || type === 'prefab';
  });
  const manifestFiles = realFiles(files, (file) => MANIFEST_NAMES.has(baseName(file.path).toLowerCase()), []);
  const entryFiles = realFiles(files, (file) => ENTRY_RE.test(file.path), codeFiles.map((file) => file.path));
  const mainFiles = entryFiles.length > 0 ? entryFiles : codeFiles.slice(0, 3).map((file) => file.path);
  const moduleFiles = codeFiles.map((file) => file.path).filter((value) => !mainFiles.includes(value)).slice(0, 3);
  const reviewFiles = [...new Set([...mainFiles, ...moduleFiles])].slice(0, 3);
  const folders = signals.topFolders.length > 0 ? signals.topFolders.map((folder) => `${folder}/`) : ['src/'];

  const entryLabel = entryFiles[0] || (isRu ? 'главный файл проекта' : 'the project entry point');
  const stackLabel = signals.engineOrFramework;

  return {
    projectName: name,
    projectType: signals.projectType,
    engineOrFramework: signals.engineOrFramework,
    language: signals.language,
    tagline: isRu
      ? `Существующий проект (${stackLabel}) — ${signals.fileCount} файлов, состав определён по содержимому папки.`
      : `An existing project (${stackLabel}) — ${signals.fileCount} files, understood from the folder contents.`,
    targetAudience: isRu
      ? 'Разработчик проекта и те, кто будет продолжать его с ИИ-агентом'
      : 'The project developer and everyone continuing it with an AI agent',
    coreProblem: isRu
      ? 'Проект уже написан: продолжать его сложно, потому что нет карты файлов и понятного плана следующего шага.'
      : 'The project already exists: continuing it is hard without a file map and a clear next step.',
    coreValue: isRu
      ? 'Карта реальных файлов и задачи, привязанные именно к этому коду'
      : 'A map of the real files and tasks pinned to this exact code',
    mvpFeatures: isRu
      ? [
          `Разобраться в существующих модулях (${signals.topFolders.slice(0, 3).join(', ') || 'структура проекта'})`,
          `Собирать и запускать проект без ошибок (${entryLabel})`,
          'Развивать функциональность небольшими проверяемыми шагами'
        ]
      : [
          `Understand the existing modules (${signals.topFolders.slice(0, 3).join(', ') || 'project structure'})`,
          `Build and run the project cleanly (${entryLabel})`,
          'Grow the functionality in small, verifiable steps'
        ],
    futureFeatures: isRu
      ? ['Автотесты на текущие модули', 'Правила для ИИ-агентов на основе реальной архитектуры']
      : ['Automated tests for the current modules', 'AI agent rules derived from the real architecture'],
    nonGoals: isRu
      ? ['Переписывание проекта с нуля', 'Смена движка или языка без необходимости']
      : ['Rewriting the project from scratch', 'Switching engine or language without a reason'],
    technicalConstraints: isRu
      ? [
          `Сохранять текущий стек (${stackLabel})`,
          'Не менять структуру папок без необходимости',
          ...signals.evidence.slice(0, 2)
        ]
      : [
          `Keep the current stack (${stackLabel})`,
          'Do not restructure folders without a reason',
          ...signals.evidence.slice(0, 2)
        ],
    successCriteria: isRu
      ? ['Проект собирается и запускается', 'Новая функциональность появляется без регрессий', 'План задач соответствует реальным файлам']
      : ['The project builds and runs', 'New features land without regressions', 'The task plan matches the real files'],
    clarifyingQuestions: isRu
      ? ['Какую функцию развиваем первой?', 'Есть ли ограничения по зависимостям и лицензиям?', 'На чём проверяем результат?']
      : ['Which feature comes first?', 'Any dependency or licence constraints?', 'How do we verify the result?'],
    architecture: {
      technologyStack: signals.frameworks.length > 0 ? signals.frameworks.slice(0, 8) : [stackLabel],
      folderStructure: folders,
      coreEntities: mainFiles.length > 0 ? mainFiles : ['src/'],
      dataFlow: isRu
        ? 'Данные текут между уже существующими модулями — меняем их точечно, не ломая связи.'
        : 'Data flows between the modules that already exist — change them surgically, without breaking links.',
      testingStrategy: isRu
        ? `Собирать проект после каждой задачи${manifestFiles[0] ? ` (${manifestFiles[0]})` : ''} и покрывать изменённые модули тестами.`
        : `Build the project after every task${manifestFiles[0] ? ` (${manifestFiles[0]})` : ''} and cover changed modules with tests.`,
      deploymentPlan: isRu ? 'Сборка проекта и запуск локально из подключанной папки.' : 'Build the project and run it locally from the connected folder.',
      securityRisks: isRu
        ? ['Не читать .env и ключи', 'Не удалять существующие файлы без подтверждения']
        : ['Never read .env files or keys', 'Never delete existing files without confirmation']
    },
    phases: [
      {
        phaseNumber: 0,
        title: isRu ? 'Знакомство с проектом' : 'Project Onboarding',
        purpose: isRu ? 'Понять, что уже написано, и убедиться, что проект собирается.' : 'Understand what is already written and confirm the project builds.',
        deliverable: isRu ? 'Понятная карта файлов и рабочая сборка.' : 'A clear file map and a working build.',
        tasks: [
          {
            title: isRu ? `Изучить точку входа и структуру (${mainFiles.length} файлов)` : `Review the entry point and structure (${mainFiles.length} files)`,
            goal: isRu
              ? 'Прочитать главные файлы проекта и выписать, что уже реализовано, а что нет.'
              : 'Read the main project files and note what is already implemented and what is not.',
            relevantFiles: mainFiles.length > 0 ? mainFiles : files.slice(0, 2).map((file) => file.path),
            acceptanceCriteria: isRu
              ? ['Главные модули прочитаны и понятны', 'Список готовых и отсутствующих частей записан']
              : ['The main modules are read and understood', 'The list of done and missing parts is written down'],
            testRequirements: isRu ? ['Сборка проекта'] : ['Project build'],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: []
          },
          {
            title: isRu ? 'Проверить сборку и запуск проекта' : 'Verify the build and the run',
            goal: isRu
              ? 'Собрать проект текущими командами и исправить всё, что мешает запуску.'
              : 'Build the project with its current commands and fix whatever blocks the run.',
            relevantFiles: manifestFiles.length > 0 ? manifestFiles : mainFiles.slice(0, 2),
            acceptanceCriteria: isRu
              ? ['Проект собирается без ошибок', 'Ошибки запуска исправлены']
              : ['The project builds without errors', 'Startup errors are fixed'],
            testRequirements: isRu ? ['Чистая сборка'] : ['Clean build'],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: []
          }
        ]
      },
      {
        phaseNumber: 1,
        title: isRu ? 'Развитие текущей функциональности' : 'Growing the Current Features',
        purpose: isRu ? 'Добавлять новое в существующие модули, не ломая уже работающее.' : 'Add to the existing modules without breaking what already works.',
        deliverable: isRu ? 'Работающая новая функциональность в реальных файлах.' : 'Working new functionality in the real files.',
        tasks: [
          {
            title: isRu ? 'Определить следующую функцию и её место в коде' : 'Decide the next feature and where it lives in the code',
            goal: isRu
              ? 'Описать функцию, критерии готовности и файлы, которые она затронет.'
              : 'Describe the feature, its acceptance criteria and the files it will touch.',
            relevantFiles: reviewFiles.length > 0 ? reviewFiles : files.slice(0, 3).map((file) => file.path),
            acceptanceCriteria: isRu
              ? ['Функция и её критерии записаны', 'Список затрагиваемых файлов понятен']
              : ['The feature and its criteria are written down', 'The list of touched files is clear'],
            testRequirements: isRu ? ['Проверка на существующих данных'] : ['Check against existing data'],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: ['0_0']
          },
          {
            title: isRu ? 'Реализовать функцию в существующих модулях' : 'Implement the feature inside the existing modules',
            goal: isRu
              ? 'Внести изменения точечно, сохранив текущие стиль и архитектуру проекта.'
              : 'Make the change surgically, keeping the current style and architecture.',
            relevantFiles: reviewFiles.length > 0 ? reviewFiles : files.slice(0, 2).map((file) => file.path),
            acceptanceCriteria: isRu
              ? ['Новая логика работает', 'Старое поведение не сломано']
              : ['The new logic works', 'Existing behaviour is not broken'],
            testRequirements: isRu ? ['Проверка сборки и ручной сценарий'] : ['Build check and a manual scenario'],
            estimatedComplexity: 'Medium (2-3 prompts)',
            dependencies: ['1_0']
          }
        ]
      },
      {
        phaseNumber: 2,
        title: isRu ? 'Проверка и порядок' : 'Verification & Housekeeping',
        purpose: isRu ? 'Убедиться, что изменения не оставили мусора, и зафиксировать правила проекта.' : 'Make sure the change left no mess and record the project rules.',
        deliverable: isRu ? 'Проверенная сборка и правила для агента.' : 'A verified build and agent rules.',
        tasks: [
          {
            title: isRu ? 'Проверить результат и обновить правила агентов' : 'Verify the result and update the agent rules',
            goal: isRu
              ? 'Пройти основной сценарий вручную, проверить сборку и описать договорённости проекта в AGENTS.md.'
              : 'Walk the main scenario by hand, check the build and describe the project conventions in AGENTS.md.',
            relevantFiles: realFiles(files, (file) => RULES_RE.test(file.path), mainFiles.slice(0, 2)),
            acceptanceCriteria: isRu
              ? ['Сборка чистая', 'Основной сценарий работает', 'Правила агентов описывают реальную архитектуру']
              : ['The build is clean', 'The main scenario works', 'The agent rules describe the real architecture'],
            testRequirements: isRu ? ['Ручной сценарий и сборка'] : ['Manual scenario and build'],
            estimatedComplexity: 'Small (1 prompt)',
            dependencies: ['1_1']
          }
        ]
      }
    ]
  };
}
