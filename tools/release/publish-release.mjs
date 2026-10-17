#!/usr/bin/env node
/**
 * Publishes the built portable .exe as a GitHub release, with the `version.json` the app's updater
 * reads.
 *
 * The app does not talk to the GitHub API: it asks one folder — `…/releases/latest/download` — for
 * two files, `version.json` and the .exe it names. That keeps the update free (no server of your
 * own), cache-safe (the `latest` folder always points at the newest release), and private about
 * nothing: the release is public, and the app needs no token to read it.
 *
 * The manifest is written here rather than by hand, because it carries the SHA-256 of the file that
 * is being uploaded: a hash typed by a person is a hash that will one day be wrong.
 *
 * The files are uploaded through the REST API, not through `gh`, and then read back from the public
 * feed. A publisher that says "готово" while the feed answers 404 has not published anything — the
 * release is only done when the same two URLs the app asks for answer with what was meant to be
 * there. Every check that fails is a failed run with the reason, never a green one with a silent
 * hole in it.
 *
 * Usage:
 *   npm run release -- --notes "что изменилось"
 *   EPC_GITHUB_REPO=owner/repo npm run release
 *   npm run release -- --dry-run          (writes version.json next to the .exe and stops)
 *
 * Needs a token with `contents: write`: `GITHUB_TOKEN`/`GH_TOKEN` in the environment (the release
 * workflow passes one), or a signed-in GitHub CLI, whose token is taken from `gh auth token`.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const EXE_NAME = 'Easy Project Compiler.exe';
/**
 * The name the release actually keeps.
 *
 * A release asset does not keep the spaces in the name it is uploaded with — GitHub stores
 * `Easy Project Compiler.exe` as `Easy.Project.Compiler.exe` — so a manifest naming the spaced file
 * points at a URL that answers 404. The name is chosen with dots rather than letting the host decide,
 * because the manifest and the asset must agree by construction, not by a guess about the host. The
 * app still calls the file it downloads whatever its own `EXE_NAME` says: the swap looks for that.
 */
const ASSET_NAME = 'Easy.Project.Compiler.exe';
const MANIFEST_NAME = 'version.json';
const folderName = 'Приложение-для-тестеров';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

function desktopDir() {
  const candidates = [path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')];
  return candidates.find((dir) => fs.existsSync(dir)) ?? root;
}

const argValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const notes = argValue('notes') || '';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!version || version === '0.0.0') {
  console.error('Нет версии в package.json: релиз должен иметь номер, иначе обновление не случится.');
  process.exit(1);
}

const exePath = path.resolve(
  argValue('exe') ||
    path.join(process.env.EPC_EXE_DIR ? path.resolve(process.env.EPC_EXE_DIR) : desktopDir(), folderName, EXE_NAME)
);
if (!fs.existsSync(exePath)) {
  console.error(`Не нашёл собранный файл: ${exePath}\nСначала: npm run build:desktop`);
  process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
const publishDir = path.join(root, 'build', 'release');
fs.mkdirSync(publishDir, { recursive: true });

const manifest = {
  version,
  file: ASSET_NAME,
  sha256,
  ...(notes ? { notes } : {})
};
const manifestPath = path.join(publishDir, MANIFEST_NAME);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/* A copy with the stable name the manifest promises: the release asset and the file the updater
   downloads must be the same name, or the swap looks for a file that was never written. */
const stagedExe = path.join(publishDir, ASSET_NAME);
fs.copyFileSync(exePath, stagedExe);

const exeSize = fs.statSync(stagedExe).size;
const megabytes = (exeSize / 1024 / 1024).toFixed(1);
console.log(`· версия ${version}`);
console.log(`· файл ${stagedExe} (${megabytes} MB)`);
console.log(`· SHA-256 ${sha256}`);
console.log(`· манифест ${manifestPath}`);

if (dryRun) {
  console.log('\n--dry-run: файлы готовы, публикация пропущена.');
  process.exit(0);
}

/** `owner/repo`, from the environment first (Actions sets it), then from the checkout's remote. */
function repoSlug() {
  const explicit = (process.env.EPC_GITHUB_REPO || process.env.GITHUB_REPOSITORY || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(explicit)) return explicit;
  try {
    const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    /* no git, no remote — the message below says what to set */
  }
  return null;
}

function token() {
  const fromEnv = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromCli = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (fromCli) return fromCli;
  } catch {
    /* not signed in — the message below says what to do */
  }
  return null;
}

const slug = repoSlug();
const auth = token();
if (!slug || !auth) {
  console.error('\nНе с чем публиковать:');
  if (!slug) console.error('  · репозиторий не найден — задайте EPC_GITHUB_REPO=owner/repo');
  if (!auth) console.error('  · нет токена — задайте GITHUB_TOKEN (contents: write) или войдите: gh auth login');
  console.error(`\nФайлы уже готовы, их можно загрузить вручную:\n  ${stagedExe}\n  ${manifestPath}`);
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${auth}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'easy-project-compiler-release'
};

class PublishError extends Error {}

async function send(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: response.status, ok: response.ok, text, json };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new PublishError(`сеть не отвечает на ${url}: ${lastError?.message || lastError}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The repository as GitHub spells it today.
 *
 * A renamed repository still answers under its old name with a redirect, and a POST that is
 * redirected loses its body — so every write below uses the canonical name this lookup returns.
 */
async function canonicalRepo(name) {
  const response = await send(`${API}/repos/${name}`, { method: 'GET' });
  if (response.status === 404) throw new PublishError(`репозиторий ${name} не найден или токен не видит его`);
  if (!response.ok) throw new PublishError(`репозиторий ${name}: HTTP ${response.status} ${response.text.slice(0, 200)}`);
  return response.json.full_name;
}

async function findRelease(repo, tag) {
  const response = await send(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { method: 'GET' });
  if (response.status === 404) {
    /* The by-tag lookup does not see drafts — GitHub answers 404 for a release that exists but has
       not been published — and a draft with this tag is exactly the case that must not turn into a
       second release. The list is the only place a draft shows up. */
    const list = await send(`${API}/repos/${repo}/releases?per_page=100`, { method: 'GET' });
    if (!list.ok) throw new PublishError(`не прочитать список релизов: HTTP ${list.status} ${list.text.slice(0, 200)}`);
    const matches = (list.json || []).filter((release) => release.tag_name === tag);
    return matches.find((release) => !release.draft) ?? matches[0] ?? null;
  }
  if (!response.ok) throw new PublishError(`не прочитать релиз ${tag}: HTTP ${response.status} ${response.text.slice(0, 200)}`);
  return response.json;
}

async function ensureRelease(repo, tag) {
  const existing = await findRelease(repo, tag);
  if (existing) {
    /* An old release is not automatically the one the app reads: the feed asks for `latest`, so the
       file being replaced has to be the newest one, or the update lands in a folder nobody asks. A
       draft is written to as happily as a published release and stays invisible to everyone — that
       is a release that exists for the person uploading and for nobody else — so it is published
       here, deliberately, rather than left as a green run with no feed behind it. */
    const marked = await send(`${API}/repos/${repo}/releases/${existing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Easy Project Compiler ${version}`,
        body: notes || `Сборка ${version}`,
        draft: false,
        prerelease: false,
        make_latest: 'true'
      })
    });
    if (!marked.ok) throw new PublishError(`не пометить ${tag} последним: HTTP ${marked.status} ${marked.text.slice(0, 200)}`);
    return { release: marked.json, created: false };
  }
  const created = await send(`${API}/repos/${repo}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `Easy Project Compiler ${version}`,
      body: notes || `Сборка ${version}`,
      draft: false,
      prerelease: false,
      make_latest: 'true'
    })
  });
  if (!created.ok) throw new PublishError(`не создать релиз ${tag}: HTTP ${created.status} ${created.text.slice(0, 300)}`);
  return { release: created.json, created: true };
}

async function dropAsset(repo, releaseId, name) {
  const response = await send(`${API}/repos/${repo}/releases/${releaseId}/assets?per_page=100`, { method: 'GET' });
  if (!response.ok) throw new PublishError(`не прочитать файлы релиза: HTTP ${response.status}`);
  const stale = (response.json || []).filter((asset) => asset.name === name);
  for (const asset of stale) {
    const removed = await send(`${API}/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' });
    if (!removed.ok && removed.status !== 404) {
      throw new PublishError(`не убрать старый ${name}: HTTP ${removed.status} ${removed.text.slice(0, 200)}`);
    }
  }
}

async function uploadAsset(repo, releaseId, filePath, name) {
  const size = fs.statSync(filePath).size;
  await dropAsset(repo, releaseId, name);
  const body = typeof fs.openAsBlob === 'function' ? await fs.openAsBlob(filePath) : fs.readFileSync(filePath);
  const response = await send(
    `${UPLOADS}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body
    },
    2
  );
  if (!response.ok) {
    throw new PublishError(`не загрузить ${name}: HTTP ${response.status} ${response.text.slice(0, 300)}`);
  }
  const uploaded = response.json;
  if (!uploaded || uploaded.name !== name) {
    throw new PublishError(`GitHub сохранил файл как «${uploaded?.name ?? '?'}», а манифест обещает «${name}»`);
  }
  /* The digest GitHub itself computed for the stored file: the one answer about the bytes that does
     not depend on this machine, its disk, or the read that produced them. */
  if (uploaded.digest) {
    const local = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (uploaded.digest !== `sha256:${local}`) {
      throw new PublishError(`${name}: GitHub хранит ${uploaded.digest}, а собран ${local}`);
    }
  }
  return uploaded;
}

/**
 * The two URLs the app itself asks for — nothing else counts as published.
 *
 * A release is not readable the moment its files are uploaded: the `latest` folder and the file
 * itself can answer 404 for a little while, so each check is given a few tries before it is called a
 * failure. What is never retried away is a wrong answer: a manifest without the hash, or a file whose
 * length is not the one that was uploaded, is a broken release, not a slow one.
 */
async function verify(repo, tag, attempts = 12, delay = 5000) {
  const problems = [];
  const files = [
    { name: ASSET_NAME, size: exeSize },
    { name: MANIFEST_NAME, size: fs.statSync(manifestPath).size }
  ];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    problems.length = 0;

    const listing = await findRelease(repo, tag);
    if (!listing) {
      problems.push(`релиз ${tag} не читается`);
    } else {
      for (const file of files) {
        const asset = (listing.assets || []).find((candidate) => candidate.name === file.name);
        if (!asset) problems.push(`в релизе нет ${file.name}`);
        else if (asset.size !== file.size) problems.push(`${file.name}: в релизе ${asset.size} байт, а загружали ${file.size}`);
        else if (asset.state !== 'uploaded') problems.push(`${file.name}: состояние «${asset.state}»`);
      }
      if (!listing.assets?.some((asset) => asset.name === MANIFEST_NAME)) {
        problems.push(`${MANIFEST_NAME} не прикреплён — обновление не найдёт версию`);
      }
    }

    const feed = `https://github.com/${repo}/releases/latest/download`;
    const manifestAnswer = await fetch(`${feed}/${MANIFEST_NAME}?t=${Date.now()}`, { redirect: 'follow' }).catch((error) => ({ ok: false, status: 0, text: () => String(error) }));
    if (!manifestAnswer.ok) {
      problems.push(`${feed}/${MANIFEST_NAME} отвечает HTTP ${manifestAnswer.status}`);
    } else {
      let published;
      try {
        published = JSON.parse(await manifestAnswer.text());
      } catch {
        published = null;
      }
      if (!published) problems.push(`${MANIFEST_NAME} по адресу релиза не разбирается`);
      else if (published.version !== manifest.version || published.sha256 !== manifest.sha256 || published.file !== manifest.file) {
        problems.push(`${MANIFEST_NAME} по адресу релиза не тот, что собран: ${JSON.stringify(published).slice(0, 160)}`);
      }
    }

    const fileAnswer = await fetch(`${feed}/${encodeURIComponent(ASSET_NAME)}`, { method: 'HEAD', redirect: 'follow' }).catch((error) => ({ ok: false, status: 0, headers: new Headers(), error }));
    if (!fileAnswer.ok) {
      problems.push(`${feed}/${encodeURIComponent(ASSET_NAME)} отвечает HTTP ${fileAnswer.status}`);
    } else {
      const length = Number(fileAnswer.headers.get('content-length'));
      if (Number.isFinite(length) && length > 0 && length !== exeSize) {
        problems.push(`${ASSET_NAME}: по ссылке ${length} байт, а загружали ${exeSize}`);
      }
    }

    if (problems.length === 0) return { ok: true, attempts: attempt, feed };
    if (attempt < attempts) await sleep(delay);
  }
  return { ok: false, problems: [...new Set(problems)] };
}

try {
  const repo = await canonicalRepo(slug);
  const tag = `v${version}`;
  const { release, created } = await ensureRelease(repo, tag);
  console.log(`· репозиторий ${repo}`);
  console.log(created ? `· релиз ${tag} создан` : `· релиз ${tag} уже есть — обновляю файлы`);

  /* The manifest goes up last: a feed that answers with a version is a feed whose file is already
     there, so a download can never start before the thing it downloads exists. */
  const exeAsset = await uploadAsset(repo, release.id, stagedExe, ASSET_NAME);
  console.log(`· загружен ${exeAsset.name} (${(exeAsset.size / 1024 / 1024).toFixed(1)} MB)` +
    (exeAsset.digest ? ', SHA-256 совпал' : ''));
  const manifestAsset = await uploadAsset(repo, release.id, manifestPath, MANIFEST_NAME);
  console.log(`· загружен ${manifestAsset.name} (${manifestAsset.size} байт)`);

  const published = await verify(repo, tag);
  if (!published.ok) {
    console.error('\nРелиз создан, но приложение его не увидит:');
    for (const problem of published.problems) console.error(`  · ${problem}`);
    process.exit(1);
  }
  const tries = published.attempts;
  const plural = tries % 10 === 1 && tries % 100 !== 11 ? 'проверка' : [2, 3, 4].includes(tries % 10) && ![12, 13, 14].includes(tries % 100) ? 'проверки' : 'проверок';
  console.log(`\nГотово: ${tag} опубликован и проверен (${tries} ${plural}).`);
  console.log(`Лента: ${published.feed}/${MANIFEST_NAME}`);
  console.log('Друзьям обновление придёт само — приложение спросит ленту при следующем запуске.');
} catch (error) {
  console.error(`\nПубликация не удалась: ${error instanceof PublishError ? error.message : (error.stack || error.message || String(error))}`);
  console.error(`Файлы остались здесь:\n  ${stagedExe}\n  ${manifestPath}`);
  process.exit(1);
}
