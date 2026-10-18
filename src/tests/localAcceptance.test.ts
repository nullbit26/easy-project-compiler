import { describe, it, expect } from 'vitest';

import { hasTestRunner, localAcceptance, verificationCommands } from '../../server/utils/localAcceptance';

/**
 * The prompt written without a model is the one most users read: it is what the app falls back to
 * when the provider is slow or no key is configured. It used to carry the same three sentences under
 * every task in every project, plus a `tests` entry that named no command at all — the fixed content
 * a beginner cannot tell apart from a compiled prompt.
 */

const base = {
  isRu: true,
  taskTitle: 'Добавить удаление записи',
  files: ['src/components/NoteList.tsx', 'src/App.tsx'],
  commands: ['dev', 'build', 'lint', 'test'],
  folderConnected: true
};

describe('What the local engine promises', () => {
  it('1. names the task it was compiled for, not a generic "the feature works"', () => {
    const { criteria } = localAcceptance(base);

    expect(criteria[0]).toContain('Добавить удаление записи');
    expect(criteria.join(' ')).not.toContain('Запрошенный функционал работает корректно');
  });

  it('2. names the real files instead of an abstract "code compiles"', () => {
    const { criteria } = localAcceptance(base);

    expect(criteria[1]).toContain('src/components/NoteList.tsx');
  });

  it('3. lists the scripts the folder really declares, in the form the app runs them', () => {
    const { tests } = localAcceptance(base);

    expect(tests).toContain('npm run build');
    expect(tests).toContain('npm run test');
    expect(tests).not.toContain('npm run dev');
    expect(tests.join(' ')).not.toContain('Запустить проверку измененных модулей');
  });

  it('4. drops the criteria that depend on a folder when no folder is connected', () => {
    const { criteria, confidence } = localAcceptance({
      ...base,
      files: [],
      commands: null,
      folderConnected: false
    });

    expect(criteria[1]).toContain('папка не подключена');
    expect(criteria[2]).toContain('вручную');
    expect(confidence).toBeLessThan(localAcceptance(base).confidence);
  });

  it('5. says the checks are manual when the project declares none, instead of inventing one', () => {
    const { tests, criteria } = localAcceptance({ ...base, commands: ['dev', 'start'] });

    expect(tests).toHaveLength(1);
    expect(tests[0]).toContain('Проверить вручную');
    expect(criteria[2]).toContain('нет объявленных команд проверки');
  });

  it('6. warns about what is actually missing, and about nothing else', () => {
    const connected = localAcceptance(base);
    expect(connected.warnings).toEqual([]);

    const empty = localAcceptance({ ...base, files: [], commands: null, folderConnected: false });
    expect(empty.warnings.join(' ')).toContain('Папка проекта не подключена');
    expect(empty.warnings.join(' ')).toContain('нет ни одного файла');
  });

  it('7. never claims more confidence than its facts support', () => {
    const fullest = localAcceptance(base);
    const empty = localAcceptance({
      isRu: false,
      taskTitle: 'Add deletion',
      files: [],
      commands: null,
      folderConnected: false
    });

    expect(fullest.confidence).toBeLessThanOrEqual(85);
    expect(empty.confidence).toBeLessThan(fullest.confidence);
  });

  it('8. speaks English when the project does', () => {
    const { criteria, tests } = localAcceptance({ ...base, isRu: false, taskTitle: 'Add deletion' });

    expect(criteria[0]).toContain('Add deletion');
    expect(criteria[0]).not.toMatch(/[А-Яа-я]/);
    expect(tests).toContain('npm run test');
  });
});

describe('What the project can actually run', () => {
  it('9. keeps only the scripts that say whether the code still works', () => {
    expect(verificationCommands(['dev', 'start', 'preview'])).toEqual([]);
    expect(verificationCommands(['typecheck', 'build:prod', 'test:unit'])).toEqual([
      'npm run typecheck',
      'npm run build:prod',
      'npm run test:unit'
    ]);
  });

  it('10. admits it does not know when no package.json was read', () => {
    expect(hasTestRunner(null)).toBeNull();
    expect(hasTestRunner([])).toBe(false);
    expect(hasTestRunner(['dev', 'build'])).toBe(false);
    expect(hasTestRunner(['dev', 'test'])).toBe(true);
  });
});
