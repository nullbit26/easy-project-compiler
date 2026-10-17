import { describe, it, expect } from 'vitest';
import { parseFileList, inferFileType } from '../utils/fileListParser';

describe('FileListParser - импорт структуры проекта из списка файлов', () => {
  it('1. Распознаёт Unity-дерево (Assets/ + .cs) и определяет C#', () => {
    const input = `
Assets/
│   ├── Scripts/
│   │   ├── PlayerHealth.cs
│   │   └── PlayerStats.cs
│   └── Prefabs/
│       └── Player.prefab
Packages/manifest.json
    `;
    const result = parseFileList(input);
    expect(result).not.toBeNull();
    expect(result!.paths).toContain('PlayerHealth.cs');
    expect(result!.paths).toContain('Packages/manifest.json');
    expect(result!.projectType).toBe('Unity');
    expect(result!.language).toBe('C#');
    expect(result!.engineOrFramework).toContain('Unity');
  });

  it('2. Распознаёт React-проект по .tsx и определяет TypeScript', () => {
    const input = 'src/App.tsx, src/main.tsx, src/index.css';
    const result = parseFileList(input);
    expect(result).not.toBeNull();
    expect(result!.paths).toHaveLength(3);
    expect(result!.paths).toContain('src/App.tsx');
    expect(result!.projectType).toBe('React');
    expect(result!.language).toBe('TypeScript');
  });

  it('3. Распознаёт Godot-проект по .gd и .tscn', () => {
    const result = parseFileList('scenes/player/Player.tscn\nscripts/player/Player.gd');
    expect(result).not.toBeNull();
    expect(result!.projectType).toBe('Godot');
    expect(result!.language).toBe('GDScript');
  });

  it('4. Дедуплицирует пути и отсеивает мусор (версии, домены)', () => {
    const input = `src/App.tsx\nsrc/App.tsx\nVersion 1.2.3\nexample.com\nКак дела?`;
    const result = parseFileList(input);
    expect(result).not.toBeNull();
    expect(result!.paths).toEqual(['src/App.tsx']);
  });

  it('5. Возвращает null для бессмысленного текста', () => {
    expect(parseFileList('привет, как дела')).toBeNull();
    expect(parseFileList('')).toBeNull();
    expect(parseFileList('   ')).toBeNull();
  });

  it('6. inferFileType корректно определяет тип файла', () => {
    expect(inferFileType('src/App.tsx')).toBe('code');
    expect(inferFileType('src/tests/smoke.test.tsx')).toBe('test');
    expect(inferFileType('Assets/Prefabs/Player.prefab')).toBe('prefab');
    expect(inferFileType('Assets/Scenes/Main.unity')).toBe('scene');
    expect(inferFileType('data/config.json')).toBe('json');
    expect(inferFileType('AGENTS.md')).toBe('rule');
    expect(inferFileType('assets/logo.png')).toBe('asset');
  });
});
