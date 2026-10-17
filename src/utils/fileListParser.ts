import { ProjectFile, ProjectType } from '../types';

/**
 * Parses a pasted folder tree / GitHub file list into a verified file index.
 *
 * Handles:
 * - Plain path lists: `src/App.tsx, src/index.css`
 * - Tree output:      `│   ├── GameManager.cs`
 * - Both newline- and comma-separated entries.
 */

const FILE_PATH_REGEX = /[A-Za-z0-9_@][A-Za-z0-9_\-./@]*\.[A-Za-z0-9]+/g;

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cs', 'gd', 'py', 'dart', 'go', 'rs', 'java',
  'kt', 'swift', 'cpp', 'h', 'hpp', 'lua', 'rb', 'php', 'vue', 'svelte', 'sh',
  'html', 'css', 'scss', 'sass', 'less', 'xml', 'sql',
]);

const CONFIG_EXTENSIONS = new Set(['json', 'toml', 'yml', 'yaml', 'ini', 'env', 'config', 'md']);
const ASSET_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'fbx', 'glb', 'gltf', 'ttf']);
const SCENE_EXTENSIONS = new Set(['unity', 'tscn', 'scene', 'umap']);

export interface FileListParseResult {
  paths: string[];
  projectType: ProjectType;
  language: string;
  engineOrFramework: string;
}

function extractExtension(path: string): string {
  const match = path.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function cleanMatch(raw: string): string | null {
  const cleaned = raw
    .replace(/^[.\-/]+/, '') // leading ./ or /
    .trim();

  if (cleaned.length < 3 || cleaned.length > 200) return null;
  if (/^(https?|www)\./i.test(cleaned)) return null;
  if (/^\d+(\.\d+)+$/.test(cleaned)) return null; // version numbers like 1.2.3

  const ext = extractExtension(cleaned);
  if (!ext) return null;

  const isKnown =
    CODE_EXTENSIONS.has(ext) ||
    CONFIG_EXTENSIONS.has(ext) ||
    ASSET_EXTENSIONS.has(ext) ||
    SCENE_EXTENSIONS.has(ext);

  if (!isKnown && !cleaned.includes('/')) return null; // standalone unknown filename — likely noise (e.g. a domain)

  return cleaned;
}

/** Infers the ProjectFile type used across the app. */
export function inferFileType(path: string): ProjectFile['type'] {
  const lower = path.toLowerCase();
  const ext = extractExtension(lower);

  if (/[/.](test|tests|spec)\.?/.test(lower) || /\/__tests__\//.test(lower)) return 'test';
  if (ext === 'prefab') return 'prefab';
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (ext === 'json') return 'json';
  if (lower.endsWith('.cursorrules') || /(^|\/)agents\.md$/.test(lower) || /(^|\/)claude\.md$/.test(lower)) return 'rule';
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';
  return 'code';
}

export function parseFileList(text: string): FileListParseResult | null {
  if (!text || !text.trim()) return null;

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const matches = line.match(FILE_PATH_REGEX) || [];
    for (const raw of matches) {
      const cleaned = cleanMatch(raw);
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      paths.push(cleaned);
    }
  }

  if (paths.length === 0) return null;

  const lowerText = text.toLowerCase();
  const lowerPaths = paths.map((p) => p.toLowerCase());
  const hasExt = (ext: string) => lowerPaths.some((p) => p.endsWith(`.${ext}`));
  const hasUnityAssets = lowerPaths.some((p) => p.startsWith('assets/'));
  // Tree output lists leaf file names only, so also honor folder mentions like "Assets/".
  const isUnityLayout = hasUnityAssets || /(^|\n)\s*assets\/?/.test(lowerText) || lowerText.includes('unity');

  let projectType: ProjectType = 'Generic';
  let language = 'TypeScript';
  let engineOrFramework = 'Generic project structure';

  if (hasExt('gd') || hasExt('tscn')) {
    projectType = 'Godot';
    language = 'GDScript';
    engineOrFramework = 'Godot 4.3 (GDScript)';
  } else if (hasExt('cs') && isUnityLayout) {
    projectType = 'Unity';
    language = 'C#';
    engineOrFramework = 'Unity 6 (URP)';
  } else if (hasExt('dart')) {
    projectType = 'Flutter';
    language = 'Dart';
    engineOrFramework = 'Flutter';
  } else if (lowerText.includes('phaser') && (hasExt('ts') || hasExt('js'))) {
    projectType = 'Phaser.js';
    language = 'TypeScript';
    engineOrFramework = 'Phaser.js 3 (Canvas)';
  } else if (hasExt('tsx') || hasExt('jsx')) {
    projectType = 'React';
    language = hasExt('ts') || hasExt('tsx') ? 'TypeScript' : 'JavaScript';
    engineOrFramework =
      language === 'TypeScript' ? 'React 19 + Vite' : 'React + Vite';
  } else if (hasExt('py')) {
    projectType = 'Python';
    language = 'Python';
    engineOrFramework = 'Python 3';
  } else if (hasExt('ts')) {
    projectType = 'Node.js';
    language = 'TypeScript';
    engineOrFramework = 'Node.js + TypeScript';
  } else if (hasExt('cs')) {
    projectType = 'Generic';
    language = 'C#';
    engineOrFramework = '.NET / C#';
  }

  return {
    paths: paths.slice(0, 200),
    projectType,
    language,
    engineOrFramework,
  };
}
