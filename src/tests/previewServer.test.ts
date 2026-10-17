// @vitest-environment node
// The preview origin is a real HTTP server on a real folder: it cannot be tested under jsdom.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import { buildPreviewPlan } from '../../server/services/previewBuilder';
import { servePreviewPlan, stopPreviewServer } from '../../server/services/previewServer';

/**
 * The preview origin is what makes a project look like itself: the browser requests the folder's own
 * files, with real URLs, real content types and real byte ranges. These tests hold the guarantees
 * that were previously impossible in an inline document — plus the ones that keep a local server from
 * becoming a hole in the machine it runs on.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-serve-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(async () => {
  await stopPreviewServer();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await stopPreviewServer();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Buffer): void {
  const absolute = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

interface Fetched {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(url: string, options: { headers?: Record<string, string>; method?: string } = {}): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function serveCurrent(entry?: string) {
  const plan = await buildPreviewPlan(entry);
  const served = await servePreviewPlan(plan);
  return { plan, served };
}

describe('The preview origin', () => {
  it('1. serves the project’s own files with their real content types', async () => {
    write(
      'index.html',
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="./site.css"></head><body><script type="module" src="./app.js"></script></body></html>'
    );
    write('site.css', '#box { animation: spin 1s linear infinite; }');
    write('app.js', 'const canvas = document.createElement("canvas"); export default canvas;\n');
    write('picture.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    write('data.json', '{"ok":true}');
    // The smallest valid module: streaming instantiation checks the content type, not the payload.
    write('tiny.wasm', Buffer.from('0061736d01000000', 'hex'));

    const { served } = await serveCurrent();

    const page = await request(served.url);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const html = page.body.toString('utf8');
    // The page is the author's own, with one bridge script added in front of it.
    expect(page.body.toString('utf8')).toMatch(/^[\s\S]*<html[\s\S]*<head[^>]*>\s*<script src="\/__epc__\/bridge\.js"><\/script>/);
    expect(html).toContain('href="./site.css"');
    expect(html).toContain('src="./app.js"');

    const css = await request(`${served.origin}/site.css`);
    expect(css.headers['content-type']).toContain('text/css');
    // The stylesheet arrives as the author wrote it, animation included.
    expect(css.body.toString('utf8')).toContain('animation: spin 1s linear infinite');
    expect((await request(`${served.origin}/app.js`)).headers['content-type']).toContain('text/javascript');
    expect((await request(`${served.origin}/picture.svg`)).headers['content-type']).toContain('image/svg+xml');
    expect((await request(`${served.origin}/data.json`)).headers['content-type']).toContain('application/json');
    // `application/wasm` is what streaming compilation refuses to work without.
    expect((await request(`${served.origin}/tiny.wasm`)).headers['content-type']).toBe('application/wasm');
    expect(served.liveReload).toBe(true);
  });

  it('2. answers byte ranges, so video and audio can be streamed and seeked', async () => {
    const bytes = Buffer.alloc(2048, 7);
    write('index.html', '<!DOCTYPE html><html><body>clip</body></html>');
    write('clip.mp4', bytes);

    const { served } = await serveCurrent();

    const full = await request(`${served.origin}/clip.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.body.length).toBe(2048);

    const partial = await request(`${served.origin}/clip.mp4`, { headers: { Range: 'bytes=512-1023' } });
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 512-1023/2048');
    expect(partial.body.length).toBe(512);
  });

  it('3. refuses anything but this machine, this folder and files that are not secrets', async () => {
    write('index.html', '<!DOCTYPE html><html><body>ok</body></html>');
    write('.env', 'SECRET_TOKEN=abcdef\n');
    write('notes.txt', 'plain file\n');
    const outside = path.join(sandbox, 'outside.txt');
    fs.writeFileSync(outside, 'not part of the project\n');

    const { served } = await serveCurrent();

    // A public name that resolves to loopback cannot forge the Host header.
    const rebind = await request(`${served.origin}/`, { headers: { Host: 'evil.example.com' } });
    expect(rebind.status).toBe(403);

    expect((await request(`${served.origin}/.env`)).status).toBe(404);
    expect((await request(`${served.origin}/../outside.txt`)).status).toBe(404);
    expect((await request(`${served.origin}/notes.txt`)).status).toBe(200);

    // The preview is a viewer: nothing can be written through it.
    const write8 = await request(`${served.origin}/notes.txt`, { method: 'POST' });
    expect(write8.status).toBe(405);
  });

  it('4. asks for cross-origin isolation only when the project needs it', async () => {
    write(
      'index.html',
      '<!DOCTYPE html><html><body><script src="./threads.js"></script></body></html>'
    );
    write('threads.js', 'const buffer = new SharedArrayBuffer(64); console.log(buffer.byteLength);\n');

    const { plan, served } = await serveCurrent();

    expect(plan.isolation).toBe(true);
    const page = await request(served.url);
    expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
    // `credentialless` keeps a CDN library working where `require-corp` would silently drop it.
    expect(page.headers['cross-origin-embedder-policy']).toBe('credentialless');
    expect(page.headers['permissions-policy']).toContain('cross-origin-isolated');
    // The assets are on the same isolated origin, so they stay loadable from inside the document.
    expect((await request(`${served.origin}/threads.js`)).status).toBe(200);

    // A plain page pays nothing for it: no isolation headers, no broken third-party assets.
    write('threads.js', 'console.log("no shared memory here");\n');
    const plain = await serveCurrent();
    expect(plain.plan.isolation).toBe(false);
    expect((await request(plain.served.url)).headers['cross-origin-embedder-policy']).toBeUndefined();
  });

  it('5. serves a bundled entry as real URLs, and reloads the page when the folder changes', async () => {
    write('src/main.js', 'import { greet } from "./greet.js";\ndocument.title = greet("мир");\n');
    write('src/greet.js', 'export const greet = (who) => `Привет, ${who}`;\n');

    const { plan, served } = await serveCurrent('src/main.js');

    expect(plan.kind).toBe('bundle');
    const page = await request(served.url);
    const html = page.body.toString('utf8');
    // The build is referenced, not inlined: the browser streams it as a module.
    expect(html).toContain('/__epc__/artifact/');
    expect(html).toContain('type="module"');
    expect(html).not.toContain('Привет, мир');

    const bundleName = html.match(/\/__epc__\/artifact\/([^"]+\.js)/)?.[1] || '';
    const bundle = await request(`${served.origin}/__epc__/artifact/${bundleName}`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers['content-type']).toContain('text/javascript');
    expect(bundle.body.toString('utf8')).toContain('Привет,');
    // Something that was never asked for is not a file of this build.
    expect((await request(`${served.origin}/__epc__/artifact/unknown.js`)).status).toBe(404);

    // Live reload: a change in the folder reaches the page over the event stream.
    const reloaded = new Promise<string>((resolve, reject) => {
      const req = http.get(`${served.origin}/__epc__/stream`, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (chunk.includes('reload')) {
            res.destroy();
            resolve('reload');
          }
        });
      });
      req.on('error', reject);
      setTimeout(() => {
        req.destroy();
        resolve('no event');
      }, 6_000);
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    write('src/greet.js', 'export const greet = (who) => `Привет ещё раз, ${who}`;\n');
    expect(await reloaded).toBe('reload');
  });

  it('6. keeps answering a second build on the same address instead of moving the page', async () => {
    write('index.html', '<!DOCTYPE html><html><body>первая</body></html>');
    const first = await serveCurrent();

    write('index.html', '<!DOCTYPE html><html><body>вторая</body></html>');
    const second = await serveCurrent();

    expect(second.served.origin).toBe(first.served.origin);
    expect(second.served.reused).toBe(true);
    expect((await request(second.served.url)).body.toString('utf8')).toContain('вторая');
  });
});
