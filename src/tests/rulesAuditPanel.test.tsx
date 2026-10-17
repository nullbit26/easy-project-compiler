import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

/**
 * A rules file is written once and then the project moves on. The panel is the only place that says
 * out loud that the file it shows still describes the folder — so its promises are tested here:
 * every finding comes from the real folder or from the document itself, what cannot be compared is
 * said instead of implied, and a fix is kept on the project rather than living until the next reload.
 */

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    describeImplementedApi: vi.fn(),
    fetchWorkspaceApi: vi.fn(),
    readWorkspaceFileApi: vi.fn(),
    applyFileChangesApi: vi.fn(),
    undoFileChangesApi: vi.fn()
  };
});

import { ProjectMap } from '../components/ProjectMap';
import {
  applyFileChangesApi,
  describeImplementedApi,
  fetchWorkspaceApi,
  readWorkspaceFileApi,
  undoFileChangesApi
} from '../services/api';
import type { WorkspaceState } from '../services/api';
import type { ProjectState } from '../types';
import type { RulesCheckStamp } from '../utils/rulesCheckStamp';

const workspaceMock = fetchWorkspaceApi as unknown as ReturnType<typeof vi.fn>;
const readMock = readWorkspaceFileApi as unknown as ReturnType<typeof vi.fn>;
const applyMock = applyFileChangesApi as unknown as ReturnType<typeof vi.fn>;
const undoMock = undoFileChangesApi as unknown as ReturnType<typeof vi.fn>;
const describeMock = describeImplementedApi as unknown as ReturnType<typeof vi.fn>;

const FOLDER = 'C:\\projects\\island-survival';

/** A folder that has a package.json with two scripts and one source file. */
function folder(extra: string[] = []): WorkspaceState {
  return {
    root: FOLDER,
    files: ['src/main.js', 'package.json', ...extra].map((path) => ({
      path,
      name: path.split('/').pop() || path,
      dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      type: 'code' as const,
      sizeBytes: 40,
      isText: true
    })),
    backups: [],
    timeline: [],
    checkpoints: []
  };
}

const MANIFEST = JSON.stringify({ scripts: { test: 'vitest', build: 'tsc -b' } });

function projectFixture(rules: Partial<ProjectState['rulesFilesContent']> = {}): ProjectState {
  return {
    id: 'p_audit',
    name: 'Island Survival',
    projectType: 'Unity',
    engineOrFramework: 'Unity 6 (URP)',
    language: 'C#',
    selectedAgent: 'Cursor',
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Wire `Assets/Gone.cs` up\n- Keep `src/main.js` small\n',
      claudeMd: '# CLAUDE.md — указатель\n\n@AGENTS.md\n',
      cursorRules: '---\ndescription: Project rules\nalwaysApply: true\n---\n\n# Rules\n\n- Держать сетку чистой\n',
      ...rules
    },
    projectMap: { files: [] }
  } as unknown as ProjectState;
}

const auditBox = () => screen.findByTestId('rules-audit');

function renderMap(
  rules: Partial<ProjectState['rulesFilesContent']> = {},
  props: {
    onUpdateRulesContent?: (content: ProjectState['rulesFilesContent']) => void;
    onRecordRulesCheck?: (stamp: RulesCheckStamp) => void;
    lastRulesCheck?: RulesCheckStamp;
  } = {}
) {
  const { lastRulesCheck, ...rest } = props;
  const project = { ...projectFixture(rules), ...(lastRulesCheck ? { lastRulesCheck } : {}) } as ProjectState;
  return render(<ProjectMap project={project} {...rest} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceMock.mockResolvedValue(folder());
  readMock.mockImplementation((path: string) =>
    path === 'package.json'
      ? Promise.resolve({ path, content: MANIFEST, truncated: false, sizeBytes: MANIFEST.length })
      : Promise.reject(new Error('not found'))
  );
  applyMock.mockResolvedValue({ backupId: 'b', root: FOLDER, results: [], applied: 0, failed: 0, backups: [] });
  undoMock.mockResolvedValue({ backupId: 'b', root: FOLDER, results: [], applied: 0, failed: 0, backups: [] });
  describeMock.mockResolvedValue({});
});

describe('The rules check against the real folder', () => {
  it('1. reports a rule line whose file the folder no longer has', async () => {
    renderMap();
    const audit = await auditBox();

    await waitFor(() => expect(within(audit).getByText('Файла нет в папке')).toBeTruthy());
    expect(audit.textContent).toContain('Assets/Gone.cs');
    expect(audit.textContent).toContain('AGENTS.md:3');
    expect(screen.getByTestId('rules-audit-problems').textContent).toContain('1');
  });

  it('2. reports a script package.json does not declare', async () => {
    renderMap({
      agentsMd: '# AGENTS.md\n\n- Run `npm run lint` before a commit\n'
    });

    const audit = await auditBox();
    await waitFor(() => expect(within(audit).getByText('Команды нет в package.json')).toBeTruthy());
    expect(audit.textContent).toContain('npm run lint');
  });

  it('3. accepts rules that describe the folder as it is', async () => {
    renderMap({
      agentsMd: '# AGENTS.md\n\n- Keep `src/main.js` small\n- Run `npm run test` before a commit\n'
    });

    const audit = await auditBox();
    await waitFor(() => expect(audit.textContent).toContain('Расхождений нет'));
    expect(screen.getByTestId('rules-audit-problems').textContent).toContain('0');
    expect(within(audit).queryByText('Починить безопасное')).toBeNull();
  });

  it('4. says what it could not check when no folder is connected', async () => {
    workspaceMock.mockResolvedValue({ root: null, files: [], backups: [] });

    const audit = await (async () => {
      renderMap();
      return auditBox();
    })();

    await waitFor(() => expect(audit.textContent).toContain('Папка не подключена'));
    // Not a single finding about a folder the app cannot see.
    expect(within(audit).queryByText('Файла нет в папке')).toBeNull();
    // Nothing was connected, so there was no package.json to read either.
    expect(readMock).not.toHaveBeenCalledWith('package.json');
  });

  it('5. re-reads the folder when asked, and the finding goes away with the real file', async () => {
    renderMap();
    const audit = await auditBox();
    await waitFor(() => expect(within(audit).getByText('Файла нет в папке')).toBeTruthy());

    // The file is created in the folder in the meantime.
    workspaceMock.mockResolvedValue(folder(['Assets/Gone.cs']));
    fireEvent.click(within(audit).getByText('Проверить снова'));

    await waitFor(() => expect(audit.textContent).toContain('Расхождений нет'));
  });
});

describe('When the rules were last compared with the folder', () => {
  it('14. shows the date the rules were last checked, with what that check found', async () => {
    renderMap({}, { lastRulesCheck: { at: '2026-10-16T11:32:00.000Z', problems: 2, notes: 1, compared: { files: true, commands: true } } });

    const audit = await auditBox();
    const line = within(audit).getByTestId('rules-last-check');
    expect(line.textContent).toContain('Последняя сверка');
    expect(line.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
    expect(line.textContent).toContain('2');
  });

  it('15. admits a project nobody has checked yet instead of dating a comparison that never ran', async () => {
    renderMap();

    const audit = await auditBox();
    const line = within(audit).getByTestId('rules-last-check');
    expect(line.textContent).toContain('ещё не сверяли');
    expect(line.textContent).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it('16. records the comparison the button just made, against the folder it just read', async () => {
    const onRecordRulesCheck = vi.fn();
    renderMap({}, { onRecordRulesCheck });

    const audit = await auditBox();
    await waitFor(() => expect(within(audit).getByText('Файла нет в папке')).toBeTruthy());
    // Redrawing the panel is not a new check: the date only moves when somebody asks for one.
    expect(onRecordRulesCheck).not.toHaveBeenCalled();

    fireEvent.click(within(audit).getByText('Проверить снова'));

    await waitFor(() => expect(onRecordRulesCheck).toHaveBeenCalledTimes(1));
    const stamp = onRecordRulesCheck.mock.calls[0][0] as RulesCheckStamp;
    expect(stamp.problems).toBe(1);
    expect(stamp.compared.files).toBe(true);
    expect(Number.isNaN(new Date(stamp.at).getTime())).toBe(false);
  });

  it('17. records the check made by a fix, because the corrected rules are a new comparison', async () => {
    const onRecordRulesCheck = vi.fn();
    renderMap({}, { onRecordRulesCheck });

    const audit = await auditBox();
    fireEvent.click(await within(audit).findByText(/Починить безопасное/));

    await waitFor(() => expect(onRecordRulesCheck).toHaveBeenCalledTimes(1));
    const stamp = onRecordRulesCheck.mock.calls[0][0] as RulesCheckStamp;
    // The dead line is gone from the documents, so it is gone from the finding count as well.
    expect(stamp.problems).toBe(0);
  });
});

describe('Fixing what is safe to fix', () => {
  it('6. drops the dead line, keeps the rest, and saves the corrected rules on the project', async () => {
    const onUpdateRulesContent = vi.fn();
    renderMap({}, { onUpdateRulesContent });

    const audit = await auditBox();
    fireEvent.click(await within(audit).findByText(/Починить безопасное/));

    await waitFor(() => expect(onUpdateRulesContent).toHaveBeenCalledTimes(1));
    const saved = onUpdateRulesContent.mock.calls[0][0];
    expect(saved.agentsMd).not.toContain('Assets/Gone.cs');
    expect(saved.agentsMd).toContain('src/main.js');
    expect(saved.cursorRules).toContain('alwaysApply: true');

    // What the panel shows is now the corrected document, which is what the write would put on disk.
    const shown = (screen.getByTestId('rules-text') as HTMLTextAreaElement).value;
    expect(shown).not.toContain('Assets/Gone.cs');
    expect(shown).toContain('src/main.js');

    const outcome = screen.getByTestId('rules-audit-fix-outcome');
    expect(outcome.textContent).toContain('1');
    expect(outcome.textContent).toContain('мёртвых ссылок убрано');
    // And the check is clean after the fix, so the button is gone.
    await waitFor(() => expect(screen.queryByText(/Починить безопасное/)).toBeNull());
  });

  it('7. drops a repeated line while keeping the first one', async () => {
    const repeated = '- Always verify file paths against the real folder before writing code';
    const onUpdateRulesContent = vi.fn();
    renderMap({ agentsMd: ['# AGENTS.md', '', repeated, '- Keep the loop tight', repeated].join('\n') }, { onUpdateRulesContent });

    const audit = await auditBox();
    await waitFor(() => expect(within(audit).getByText('Строка повторяется в этом же файле')).toBeTruthy());
    fireEvent.click(await within(audit).findByText(/Починить безопасное/));

    await waitFor(() => expect(onUpdateRulesContent).toHaveBeenCalledTimes(1));
    const saved = onUpdateRulesContent.mock.calls[0][0];
    expect(saved.agentsMd.match(/Always verify file paths/g)).toHaveLength(1);
    expect(saved.agentsMd).toContain('Keep the loop tight');
  });

  it('8. never decides a contradiction for the author', async () => {
    const onUpdateRulesContent = vi.fn();
    renderMap(
      { agentsMd: '# AGENTS.md\n\n- Использовать get_node() в скриптах\n- Никогда не использовать get_node() в скриптах\n' },
      { onUpdateRulesContent }
    );

    const audit = await auditBox();
    expect(await within(audit).findByText(/^Противоречие/)).toBeTruthy();
    expect(audit.textContent).toContain('Никогда не использовать get_node()');

    // Nothing here is a safe fix, so the button never appears and nothing is overwritten.
    expect(within(audit).queryByText(/Починить безопасное/)).toBeNull();
    expect(onUpdateRulesContent).not.toHaveBeenCalled();
  });

  it('9. hands the corrected rules to the folder write as well', async () => {
    renderMap();
    const audit = await auditBox();
    fireEvent.click(await within(audit).findByText(/Починить безопасное/));
    await waitFor(() => expect(screen.getByTestId('rules-audit-fix-outcome')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Записать в папку/ }));
    const confirm = await screen.findByTestId('rules-write-confirm');
    fireEvent.click(within(confirm).getByText('Записать файлы'));

    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    const changes = applyMock.mock.calls[0][0];
    const agents = changes.find((change: { path: string }) => change.path === 'AGENTS.md');
    expect(agents.content).not.toContain('Assets/Gone.cs');
    expect(agents.content).toContain('src/main.js');
  });
});
