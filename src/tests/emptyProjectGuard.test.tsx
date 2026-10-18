import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SimpleFlow } from '../components/SimpleFlow';
import { LanguageProvider } from '../context/LanguageContext';
import type { ProjectState } from '../types';
import type { WorkspaceFileEntry } from '../services/api';

/**
 * A prompt for a folder that holds no files is the loop's dead end.
 *
 * The agent is asked to change code that does not exist, answers "send me the project files", and
 * the reviewer can only report that nothing was done — four attempts of exactly that is what the
 * screenshots of the fourth attempt show. The helper now says so before the prompt is built and
 * offers the two ways out: a folder with code, or one file the agent can fill.
 */

const task = {
  id: 'task_guard',
  phaseId: 'p0',
  title: 'Сделать кнопку сохранения',
  goal: 'Кнопка сохраняет прогресс',
  status: 'ready',
  relevantFiles: ['src/App.tsx'],
  acceptanceCriteria: [{ id: 'ac1', description: 'Кнопка сохраняет', passed: false }],
  testRequirements: [],
  estimatedComplexity: 'Small (1 prompt)',
  dependencies: [],
  progressPercent: 0
};

function makeProject(): ProjectState {
  return {
    id: 'guard-demo',
    name: 'Пустая папка',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Beginner / Non-coder',
    interfaceMode: 'guided',
    nextBestAction: 'Выполнить первую задачу',
    brief: {
      id: 'b1',
      projectName: 'Пустая папка',
      tagline: 'Демо',
      targetAudience: 'Все',
      coreProblem: 'Ничего',
      coreValue: 'Ничего',
      mvpFeatures: ['Кнопка сохранения'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    projectMap: {
      projectName: 'Пустая папка',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: [],
      files: []
    },
    phases: [{ id: 'p0', phaseNumber: 1, title: 'Этап 1', purpose: 'Старт', deliverable: 'Работает', tasks: [task] }],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  } as unknown as ProjectState;
}

const compiledPrompt = {
  id: 'c1',
  taskId: 'task_guard',
  agent: 'DeepSeek / Web Chat',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  taskTitle: task.title,
  confidence: 90,
  includedFiles: [{ path: 'src/App.tsx', reason: 'Основной файл', tokensEstimate: 120 }],
  excludedFiles: [],
  missingContext: [],
  architectureWarnings: [],
  promptText: 'СОБРАННЫЙ ПРОМПТ ДЛЯ ПУСТОГО ПРОЕКТА',
  acceptanceCriteria: ['Кнопка работает'],
  tests: [],
  estimatedTokens: 200,
  nextBestAction: 'Вставить промпт',
  securityWarnings: [],
  contextMode: 'Balanced',
  createdAt: new Date().toISOString()
};

/** A folder the app has read, holding exactly the files the test has created so far. */
function mockApi() {
  let files: WorkspaceFileEntry[] = [];
  const workspace = () => ({ root: 'C:/empty-project', files, backups: [] });

  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/workspace')) return respond(workspace());
    if (url.includes('/api/files/scan')) return respond(workspace());
    if (url.includes('/api/files/file') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      files = [
        {
          path: body.path,
          name: body.path.split('/').pop() || body.path,
          dir: body.path.includes('/') ? body.path.slice(0, body.path.lastIndexOf('/')) : '',
          type: 'code',
          sizeBytes: body.content.length,
          isText: true
        }
      ];
      return respond({ path: body.path, action: 'create', status: 'created', sizeBytes: body.content.length });
    }
    if (url.includes('/api/prompt/compile')) return respond(compiledPrompt);
    return respond({});
  });

  return spy;
}

function calls(spy: any, part: string) {
  return spy.mock.calls.filter((call: any[]) => String(call[0] ?? '').includes(part));
}

function renderFlow() {
  return render(
    <LanguageProvider>
      <SimpleFlow project={makeProject()} onUpdateTaskStatus={() => {}} />
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  vi.restoreAllMocks();
});

describe('A project with no files cannot be turned into a prompt', () => {
  it('1. explains that the agent has nothing to change, and does not build the prompt', async () => {
    const spy = mockApi();
    renderFlow();

    // The folder was read and it is empty, so the helper says so before the task is even picked.
    expect(await screen.findByText('Пока нечего менять')).toBeInTheDocument();
    expect(screen.getByText(/агенту нечего менять/i)).toBeInTheDocument();

    const compile = screen.getByRole('button', { name: /Собрать промпт/ });
    expect(compile).toBeDisabled();

    // Pressing it changes nothing: the guard is on the action, not only on the look of the button.
    fireEvent.click(compile);
    await waitFor(() => expect(calls(spy, '/api/prompt/compile').length).toBe(0));
  }, 20000);

  it('2. offers the two ways out: the folder, and the one file the agent can fill', async () => {
    const spy = mockApi();
    renderFlow();

    await screen.findByText('Пока нечего менять');
    expect(screen.getByRole('button', { name: /Подключить папку/ })).toBeInTheDocument();

    // The name is suggested from the stack (React + TypeScript) and can be changed before writing.
    const nameField = screen.getByLabelText('Или создайте файл, в который агент будет писать:');
    expect(nameField).toHaveAttribute('placeholder', 'src/App.tsx');

    fireEvent.click(screen.getByRole('button', { name: /Создать файл/ }));

    await waitFor(() => expect(calls(spy, '/api/files/file').length).toBe(1));
    const [url, init] = calls(spy, '/api/files/file')[0];
    expect(String(url)).toContain('/api/files/file');
    expect(JSON.parse(String(init.body))).toEqual({
      path: 'src/App.tsx',
      // The file carries the task, so the agent opens something that says what is expected.
      content: '// Сделать кнопку сохранения\n'
    });

    // The folder is re-read, so the helper stops asking for a file that now exists…
    await waitFor(() => expect(screen.queryByText('Пока нечего менять')).toBeNull(), { timeout: 4000 });
    // …and the prompt can be built from that file.
    const compile = await screen.findByRole('button', { name: /Собрать промпт/ });
    await waitFor(() => expect(compile).toBeEnabled());
    fireEvent.click(compile);
    expect(await screen.findByText('СОБРАННЫЙ ПРОМПТ ДЛЯ ПУСТОГО ПРОЕКТА', {}, { timeout: 4000 })).toBeInTheDocument();
  }, 20000);

  it('3. keeps the prompt screen closed while there is nothing to put in it', async () => {
    mockApi();
    renderFlow();

    await screen.findByText('Пока нечего менять');
    // The prompt screen is only reachable through a prompt. Its copy and "I pasted it" buttons carry
    // the same guard, so a folder that loses its files cannot leave a prompt standing over nothing.
    expect(screen.getByRole('button', { name: /3.*Промпт/ })).toBeDisabled();
  }, 20000);
});
