import { describe, it, expect } from 'vitest';
import { starterFileContent, suggestedStarterPath } from '../utils/starterFile';

/**
 * The first file of an empty project.
 *
 * The helper refuses to build a prompt for a folder with no files (the agent would answer "send me
 * the project files", and the loop would review nothing for several attempts), so the file it
 * offers instead has to be right for the stack and readable once created.
 */
describe('suggestedStarterPath', () => {
  it('follows the engine when the project was created with one', () => {
    expect(suggestedStarterPath({ projectType: 'Unity', engineOrFramework: 'Unity 6' })).toBe('Assets/Scripts/Main.cs');
    expect(suggestedStarterPath({ projectType: 'Godot', engineOrFramework: 'Godot 4' })).toBe('scripts/main.gd');
    expect(suggestedStarterPath({ projectType: 'Flutter', engineOrFramework: 'Flutter 3' })).toBe('lib/main.dart');
    expect(suggestedStarterPath({ projectType: 'Unreal Engine' })).toBe('Source/Main.cpp');
  });

  it('picks the file a React project actually renders', () => {
    expect(suggestedStarterPath({ projectType: 'React', engineOrFramework: 'React 19 + Vite', language: 'TypeScript' })).toBe(
      'src/App.tsx'
    );
    expect(
      suggestedStarterPath({ projectType: 'React', engineOrFramework: 'React 18 + Vite', language: 'JavaScript' })
    ).toBe('src/App.jsx');
    expect(suggestedStarterPath({ projectType: 'Next.js', engineOrFramework: 'Next.js 15', language: 'TypeScript' })).toBe(
      'src/app/page.tsx'
    );
  });

  it('falls back to one script in src for a browser project', () => {
    expect(suggestedStarterPath({ projectType: 'Phaser.js', engineOrFramework: 'Phaser 3' })).toBe('src/main.js');
    expect(suggestedStarterPath({ projectType: 'Generic', engineOrFramework: 'Vanilla JavaScript' })).toBe('src/main.js');
    expect(suggestedStarterPath({ projectType: 'Python', engineOrFramework: 'Python 3' })).toBe('main.py');
  });

  it('still names a file for a project that says nothing about itself', () => {
    expect(suggestedStarterPath(null)).toBe('src/main.js');
    expect(suggestedStarterPath({})).toBe('src/main.js');
  });
});

describe('starterFileContent', () => {
  it('carries the task in a comment the file type understands', () => {
    expect(starterFileContent('src/App.tsx', 'Кнопка сохранения')).toBe('// Кнопка сохранения\n');
    expect(starterFileContent('main.py', 'Кнопка сохранения')).toBe('# Кнопка сохранения\n');
    expect(starterFileContent('README.md', 'Кнопка сохранения')).toBe('# Кнопка сохранения\n');
    expect(starterFileContent('index.html', 'Кнопка сохранения')).toBe('<!-- Кнопка сохранения -->\n');
    expect(starterFileContent('styles.css', 'Кнопка сохранения')).toBe('/* Кнопка сохранения */\n');
    expect(JSON.parse(starterFileContent('data.json', 'Кнопка сохранения'))).toEqual({ todo: 'Кнопка сохранения' });
  });

  it('says something even when the task has no title yet', () => {
    expect(starterFileContent('src/App.tsx', '   ', true)).toBe('// Здесь появится код задачи\n');
    expect(starterFileContent('src/App.tsx', '', false)).toBe('// The task code goes here\n');
  });
});
