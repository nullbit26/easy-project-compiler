import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import {
  GitError,
  commitGitChanges,
  createGitBranch,
  getGitBranchDiff,
  getGitBranches,
  getGitDiff,
  getGitStatus,
  gitAvailable
} from '../../server/services/gitService';

/**
 * The Git service runs the real Git on a real (temporary) repository: a mocked Git would prove
 * nothing about the two things that actually matter here — that only the selected files are
 * committed, and that a folder without a repository is a normal answer rather than a crash.
 */

let sandbox: string;
let projectRoot: string;

/**
 * Every test here spawns the real Git several times over, and a spawned process costs whatever the
 * machine is doing at that moment. The default five seconds is a fine budget for a test that only
 * runs in-memory code and a hopeless one for a test that starts six processes: it made the suite
 * fail on a loaded desktop and pass on an idle one, which is a test reporting on the machine rather
 * than on the Git service. The budget below is still a failure detector — a hung Git will hit it —
 * it just is not a stopwatch on process startup.
 */
const GIT_TEST_TIMEOUT_MS = 20000;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-git-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  // Keep Git inside the temp directory: it must never walk up into a repository that happens
  // to contain the system temp folder.
  process.env.GIT_CEILING_DIRECTORIES = os.tmpdir();
});

function git(args: string[], cwd: string = projectRoot) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
}

function write(relativePath: string, content: string): void {
  const target = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  git(['init', '-q', '.']);
  git(['config', 'user.email', 'tester@example.com']);
  git(['config', 'user.name', 'Tester']);
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

/** The branch the folder is on, which works even before the repository has its first commit. */
function readBranchName(): string {
  return git(['symbolic-ref', '--short', 'HEAD']).stdout.trim();
}

describe.skipIf(!gitAvailable())('Git in the connected folder', { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it('1. reports the branch, the changed files and the state of each one', () => {
    write('a.txt', 'one\n');
    git(['add', 'a.txt']);
    git(['commit', '-q', '-m', 'first']);

    write('a.txt', 'one\ntwo\n');
    write('new.txt', 'fresh\n');
    write('.env', 'TOKEN=abc\n');

    const status = getGitStatus(projectRoot);
    expect(status.available).toBe(true);
    expect(status.isRepo).toBe(true);
    expect(status.clean).toBe(false);
    expect(status.identityMissing).toBe(false);
    expect(status.branch).toBeTruthy();

    const byPathPath = new Map(status.files.map((file) => [file.path, file]));
    expect(byPathPath.get('a.txt')?.state).toBe('modified');
    expect(byPathPath.get('new.txt')?.state).toBe('untracked');
    expect(byPathPath.get('new.txt')?.untracked).toBe(true);
    // A file that looks like a secret is listed, but flagged so its contents are never shown.
    expect(byPathPath.get('.env')?.sensitive).toBe(true);
  });

  it('2. shows the diff of a changed file, and of a brand new file', () => {
    write('a.txt', 'one\n');
    write('new.txt', 'first\nsecond\n');
    // Both files are untracked here, so the panel has to describe them without a Git diff.
    const created = getGitDiff(projectRoot, 'new.txt');
    expect(created.note).toBeNull();
    expect(created.diff).toContain('+++ b/new.txt');
    expect(created.diff).toContain('+first');

    git(['add', 'a.txt', 'new.txt']);
    git(['commit', '-q', '-m', 'first']);
    write('a.txt', 'one\ntwo\n');

    const changed = getGitDiff(projectRoot, 'a.txt');
    expect(changed.diff).toContain('+two');
    expect(changed.binary).toBe(false);
  });

  it('3. never prints the contents of a file that looks like a secret', () => {
    write('.env', 'TOKEN=abcdef\n');
    const diff = getGitDiff(projectRoot, '.env');
    expect(diff.note).toBe('sensitive');
    expect(diff.diff).toBe('');
  });

  it('4. commits exactly the selected files and leaves the others alone', () => {
    write('a.txt', 'one\n');
    write('new.txt', 'first\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);

    write('a.txt', 'one\ntwo\n');
    write('new.txt', 'first\nsecond\n');

    const commit = commitGitChanges(projectRoot, { files: ['a.txt'], message: 'Обновить a.txt' });
    expect(commit.hash).toMatch(/^[0-9a-f]{7,}$/i);
    expect(commit.subject).toBe('Обновить a.txt');
    expect(commit.committed).toEqual(['a.txt']);
    expect(commit.remaining).toContain('new.txt');

    const filesInCommit = git(['show', '--name-only', '--format=', 'HEAD']).stdout.trim().split('\n');
    expect(filesInCommit).toEqual(['a.txt']);
  });

  it('5. leaves changes the user staged in another file staged', () => {
    write('a.txt', 'one\n');
    write('b.txt', 'bee\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);

    write('b.txt', 'bee\nstaged\n');
    git(['add', 'b.txt']);
    write('a.txt', 'one\ntwo\n');

    commitGitChanges(projectRoot, { files: ['a.txt'], message: 'Update a.txt' });

    const staged = git(['diff', '--cached', '--name-only']).stdout.trim().split('\n');
    expect(staged).toContain('b.txt');
    const stagedContent = git(['show', ':b.txt']).stdout;
    expect(stagedContent).toContain('staged');
  });

  it('6. refuses an empty selection, an unknown path and an empty description', () => {
    write('a.txt', 'one\n');

    expect(() => commitGitChanges(projectRoot, { files: [], message: 'x' })).toThrow(GitError);
    try {
      commitGitChanges(projectRoot, { files: [], message: 'x' });
    } catch (err: any) {
      expect(err.code).toBe('nothing_selected');
    }

    try {
      commitGitChanges(projectRoot, { files: ['не-существует.txt'], message: 'x' });
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.code).toBe('unknown_path');
    }

    try {
      commitGitChanges(projectRoot, { files: ['a.txt'], message: '   ' });
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.code).toBe('nothing_selected');
    }
  });

  it('7. answers "not a repository" instead of failing when the folder is not under Git', () => {
    const plain = fs.mkdtempSync(path.join(sandbox, 'plain-'));
    try {
      const status = getGitStatus(plain);
      expect(status.available).toBe(true);
      expect(status.isRepo).toBe(false);
      expect(status.message).toBe('not_a_repo');
      expect(status.files).toEqual([]);
      expect(() => commitGitChanges(plain, { files: ['a.txt'], message: 'x' })).toThrow(GitError);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('8b. starts a branch for the work, moving no commit and carrying the open files', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);
    const firstCommit = git(['rev-parse', '--short', 'HEAD']).stdout.trim();
    // A file is still unsaved when the branch starts: it has to come along, and be reported.
    write('a.txt', 'one\ntwo\n');

    const before = readBranchName();
    const created = createGitBranch(projectRoot, { name: 'ai/новая-кнопка' });

    expect(created.branch).toBe('ai/новая-кнопка');
    expect(created.previous).toBe(before);
    expect(created.fromCommit).toBe(firstCommit);
    expect(created.carriedChanges).toBe(1);
    expect(readBranchName()).toBe('ai/новая-кнопка');
    // The commit the branch started from is untouched: nothing that was saved can be lost.
    expect(git(['rev-parse', '--short', 'HEAD']).stdout.trim()).toBe(firstCommit);

    // ...and the next version is saved on the new branch.
    commitGitChanges(projectRoot, { files: ['a.txt'], message: 'Обновить a.txt' });
    expect(git(['branch', '--contains', 'HEAD']).stdout).toContain('ai/новая-кнопка');
  }, 20_000);

  it('8c. refuses a name Git would not accept, and a branch that already exists', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);

    createGitBranch(projectRoot, { name: 'work' });

    const refusals: Array<[unknown, string]> = [
      ['work', 'branch_exists'],
      ['', 'invalid_branch'],
      ['   ', 'invalid_branch'],
      ['-b', 'invalid_branch'],
      ['--force', 'invalid_branch'],
      ['two words', 'invalid_branch'],
      ['a..b', 'invalid_branch'],
      ['x.lock', 'invalid_branch'],
      ['a\0b', 'invalid_branch'],
      ['x@{y}', 'invalid_branch']
    ];
    for (const [name, code] of refusals) {
      try {
        createGitBranch(projectRoot, { name });
        throw new Error(`"${String(name)}" should have been refused`);
      } catch (err: any) {
        expect({ name, code: err.code }).toEqual({ name, code });
      }
    }

    // A refused name leaves the repository exactly where it was.
    expect(readBranchName()).toBe('work');
  }, 20_000);

  it('8d. lists every branch, and names the one this work grew out of', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);
    const main = readBranchName();
    createGitBranch(projectRoot, { name: 'feature' });

    const result = getGitBranches(projectRoot);

    expect(result.available).toBe(true);
    expect(result.isRepo).toBe(true);
    expect(result.current).toBe('feature');
    expect(result.operationInProgress).toBeNull();
    expect(result.branches.map((branch) => branch.name).sort()).toEqual([main, 'feature'].sort());
    expect(result.branches.find((branch) => branch.current)?.name).toBe('feature');
    expect(result.branches.find((branch) => branch.name === main)?.current).toBe(false);
    // A branch that only exists on this computer has nothing to be ahead of.
    expect(result.branches.every((branch) => branch.ahead === null && branch.behind === null)).toBe(true);
    expect(result.suggestedBase).toBe(main);
  }, 20_000);

  it('8e. counts the versions an upstream has and the branch has not, without fetching', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);

    const branch = readBranchName();
    const remote = path.join(sandbox, 'origin.git');
    // A repository in a folder next to this one: a "remote" with no network anywhere near it.
    fs.mkdirSync(remote, { recursive: true });
    expect(git(['init', '-q', '--bare', '.'], remote).status).toBe(0);
    expect(git(['remote', 'add', 'origin', remote]).status).toBe(0);
    expect(git(['push', '-q', '-u', 'origin', branch]).status).toBe(0);

    const tracking = getGitStatus(projectRoot);
    expect(tracking.upstream).toBe(`origin/${branch}`);
    expect(tracking.ahead).toBe(0);
    expect(tracking.behind).toBe(0);

    // A version saved here and never sent anywhere.
    write('a.txt', 'one\ntwo\n');
    commitGitChanges(projectRoot, { files: ['a.txt'], message: 'local only' });
    expect(getGitStatus(projectRoot).ahead).toBe(1);

    // A version the upstream has and this folder has not — as far as this computer knows.
    const other = path.join(sandbox, 'other-clone');
    git(['clone', '-q', remote, other]);
    git(['config', 'user.email', 'tester@example.com'], other);
    git(['config', 'user.name', 'Tester'], other);
    fs.writeFileSync(path.join(other, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');
    git(['add', '-A'], other);
    git(['commit', '-q', '-m', 'from the other copy'], other);
    git(['push', '-q', 'origin', branch], other);

    // Nothing has been fetched here yet, so the app still believes it is in step…
    expect(getGitStatus(projectRoot).behind).toBe(0);
    // …and once the fetch happens, the same numbers say one version is waiting out there.
    git(['fetch', '-q', 'origin']);
    const afterFetch = getGitStatus(projectRoot);
    expect(afterFetch.ahead).toBe(1);
    expect(afterFetch.behind).toBe(1);
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }, 20_000);

  it('8f. compares two branches, and knows when they are the same version', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);
    const main = readBranchName();
    createGitBranch(projectRoot, { name: 'feature' });

    const same = getGitBranchDiff(projectRoot, main);
    expect(same.same).toBe(true);
    expect(same.files).toEqual([]);
    expect(same.patch.trim()).toBe('');

    write('a.txt', 'one\ntwo\n');
    write('new.txt', 'fresh\n');
    commitGitChanges(projectRoot, { files: ['a.txt', 'new.txt'], message: 'work on the branch' });

    const diff = getGitBranchDiff(projectRoot, main);
    expect(diff.base).toBe(main);
    expect(diff.head).toBe('feature');
    expect(diff.same).toBe(false);
    expect(diff.files.map((file) => file.path).sort()).toEqual(['a.txt', 'new.txt']);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
    expect(diff.patch).toContain('+two');
    expect(diff.patch).toContain('+fresh');
    // Nothing was checked out to answer that question.
    expect(readBranchName()).toBe('feature');

    try {
      getGitBranchDiff(projectRoot, 'не-такая-ветка');
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.code).toBe('unknown_branch');
    }
  }, 20_000);

  it('8g. will not start a branch in the middle of a merge', () => {
    write('a.txt', 'one\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'first']);
    const main = readBranchName();

    createGitBranch(projectRoot, { name: 'side' });
    write('a.txt', 'from the side\n');
    git(['commit', '-q', '-am', 'side change']);
    git(['checkout', '-q', main]);
    write('a.txt', 'from main\n');
    git(['commit', '-q', '-am', 'main change']);
    git(['merge', 'side']);

    expect(getGitBranches(projectRoot).operationInProgress).toBe('merge');
    try {
      createGitBranch(projectRoot, { name: 'during-merge' });
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.code).toBe('branch_failed');
    }
  }, 20_000);

  it('8. spots a Git that has no name and email configured', () => {
    // A repository whose identity never gets set: the check has to come from Git itself, not
    // from the repository the other tests configured.
    const anonymous = fs.mkdtempSync(path.join(sandbox, 'anonymous-'));
    const isolated = {
      global: path.join(sandbox, 'missing-global'),
      system: path.join(sandbox, 'missing-system'),
      home: path.join(sandbox, 'empty-home')
    };
    fs.mkdirSync(isolated.home, { recursive: true });
    const saved = {
      global: process.env.GIT_CONFIG_GLOBAL,
      system: process.env.GIT_CONFIG_SYSTEM,
      home: process.env.HOME,
      profile: process.env.USERPROFILE
    };

    try {
      git(['init', '-q', '.'], anonymous);
      fs.writeFileSync(path.join(anonymous, 'a.txt'), 'one\n', 'utf8');

      // Hiding the machine's own Git configuration is what a fresh computer looks like.
      process.env.GIT_CONFIG_GLOBAL = isolated.global;
      process.env.GIT_CONFIG_SYSTEM = isolated.system;
      process.env.HOME = isolated.home;
      process.env.USERPROFILE = isolated.home;

      const status = getGitStatus(anonymous);
      expect(status.isRepo).toBe(true);
      expect(status.identityMissing).toBe(true);

      try {
        commitGitChanges(anonymous, { files: ['a.txt'], message: 'x' });
        throw new Error('should have refused');
      } catch (err: any) {
        expect(err.code).toBe('identity_missing');
      }
    } finally {
      fs.rmSync(anonymous, { recursive: true, force: true });
      if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved.global;
      if (saved.system === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = saved.system;
      if (saved.home === undefined) delete process.env.HOME;
      else process.env.HOME = saved.home;
      if (saved.profile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = saved.profile;
    }
  });
});
