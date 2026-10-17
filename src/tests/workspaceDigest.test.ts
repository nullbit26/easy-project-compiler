import { describe, it, expect } from 'vitest';
import {
  alignPlanFilesToWorkspace,
  buildLocalImportProject,
  buildWorkspaceDigest,
  detectSignals,
  pickKeyFiles,
  planHasTasks,
  type DigestFileEntry
} from '../../server/utils/workspaceDigest';

/**
 * Understanding an existing project folder: which files are read first, what the stack is, and
 * what the plan looks like when there is no API key to ask.
 */

const reactFiles: DigestFileEntry[] = [
  { path: 'README.md', type: 'asset', sizeBytes: 120, isText: true },
  { path: 'package.json', type: 'json', sizeBytes: 400, isText: true },
  { path: 'src/App.tsx', type: 'code', sizeBytes: 900, isText: true },
  { path: 'src/components/Board.tsx', type: 'code', sizeBytes: 700, isText: true },
  { path: 'src/services/api.ts', type: 'code', sizeBytes: 800, isText: true }
];

const reactContents = [
  { path: 'README.md', content: '# Team task board\nA kanban board for small teams.' },
  { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^19.0.0', vite: '^6.0.0' } }) }
];

describe('workspace digest', () => {
  it('reads what it is before how it is written', () => {
    const key = pickKeyFiles([
      { path: 'src/deep/legacy/helpers.ts' },
      { path: 'src/main.tsx' },
      { path: '.cursorrules' },
      { path: 'README.md' },
      { path: 'package.json' }
    ]);

    expect(key.map((file) => file.path)).toEqual([
      'README.md',
      'package.json',
      '.cursorrules',
      'src/main.tsx',
      'src/deep/legacy/helpers.ts'
    ]);
  });

  it('builds a digest with the real tree, the findings and the key file contents', () => {
    const digest = buildWorkspaceDigest(reactFiles, reactContents);

    expect(digest.text).toContain('README.md');
    expect(digest.text).toContain('kanban board for small teams');
    expect(digest.text).toContain('package.json');
    expect(digest.signals.projectType).toBe('React');
    expect(digest.signals.language).toBe('TypeScript');
    expect(digest.signals.fileCount).toBe(reactFiles.length);
    expect(digest.signals.evidence.join(' ')).toMatch(/\.tsx|react/i);
    expect(digest.signals.topFolders).toContain('src');
  });

  it('recognises the engine from the files that prove it', () => {
    expect(
      detectSignals([
        { path: 'Assets/Scripts/PlayerHealth.cs', type: 'code' },
        { path: 'Assets/Scenes/ForestLevel.unity', type: 'scene' }
      ]).projectType
    ).toBe('Unity');

    expect(detectSignals([{ path: 'project.godot' }, { path: 'scripts/player/Player.gd', type: 'code' }]).projectType).toBe('Godot');

    expect(
      detectSignals([{ path: 'package.json', type: 'json' }], [{ path: 'package.json', content: '{"dependencies":{"phaser":"^3.80.0"}}' }])
        .projectType
    ).toBe('Phaser.js');

    expect(detectSignals([{ path: 'main.py', type: 'code' }]).projectType).toBe('Python');
    expect(detectSignals([{ path: 'weird.xyz' }]).projectType).toBe('Generic');
  });

  it('plans the continuation from the real paths when there is no AI provider', () => {
    const digest = buildWorkspaceDigest(reactFiles, reactContents);
    const plan = buildLocalImportProject({
      signals: digest.signals,
      files: reactFiles,
      isRu: true,
      folderName: 'team-task-board'
    });

    expect(plan.projectName).toBe('team-task-board');
    expect(plan.projectType).toBe('React');
    expect(plan.phases).toHaveLength(3);

    // Every task points at a file that really exists in the folder — no invented placeholders.
    const relevantFiles = plan.phases.flatMap((phase) => phase.tasks.flatMap((task) => task.relevantFiles));
    expect(relevantFiles.length).toBeGreaterThan(0);
    expect(relevantFiles.every((path) => reactFiles.some((file) => file.path === path))).toBe(true);
    expect(plan.phases[0].tasks[0].relevantFiles).toContain('src/App.tsx');
    expect(plan.phases[0].tasks[1].relevantFiles).toContain('package.json');

    // The first task of the first phase is the one the app marks as ready.
    expect(plan.architecture.coreEntities.length).toBeGreaterThan(0);
    expect(plan.tagline.length).toBeGreaterThan(10);
  });

  it('drops task files the folder does not have and keeps the real ones', () => {
    const plan = {
      projectName: 'team-task-board',
      architecture: { coreEntities: ['src/App.tsx', 'src/does-not-exist.ts'] },
      phases: [
        {
          tasks: [
            // A real path wearing Windows slashes must survive and come back normalised.
            { title: 'Build', relevantFiles: ['src\\App.tsx', 'vite.config.ts'] },
            // Nothing real at all — the task falls back to the files that describe the project.
            { title: 'CI', relevantFiles: ['.github/workflows/ci.yml'] },
            { title: 'Docs', relevantFiles: [] }
          ]
        }
      ]
    };

    const aligned = alignPlanFilesToWorkspace(plan, reactFiles);

    expect(aligned.phases[0].tasks[0].relevantFiles).toEqual(['src/App.tsx']);
    expect(aligned.phases[0].tasks[1].relevantFiles.length).toBeGreaterThan(0);
    expect(
      aligned.phases[0].tasks[1].relevantFiles.every((path) => reactFiles.some((file) => file.path === path))
    ).toBe(true);
    expect(aligned.phases[0].tasks[2].relevantFiles.length).toBeGreaterThan(0);
    expect(aligned.architecture.coreEntities).toEqual(['src/App.tsx']);
  });

  it('treats a plan with no tasks as unusable', () => {
    // An imported project with nothing to do stalls on the first screen of the flow.
    expect(planHasTasks(null)).toBe(false);
    expect(planHasTasks({})).toBe(false);
    expect(planHasTasks({ phases: [] })).toBe(false);
    expect(planHasTasks({ phases: [{ tasks: [] }, {}] })).toBe(false);
    expect(planHasTasks({ phases: [{ tasks: [{ title: 'Build' }] }] })).toBe(true);
  });

  it('keeps the requested project name when one was typed', () => {
    const digest = buildWorkspaceDigest(reactFiles, reactContents);
    const plan = buildLocalImportProject({
      signals: digest.signals,
      files: reactFiles,
      isRu: true,
      projectName: 'Мой проект',
      folderName: 'team-task-board'
    });

    expect(plan.projectName).toBe('Мой проект');
  });
});
