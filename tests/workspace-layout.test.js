import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPortalServer } from '../server.mjs';

test('serves the public directory at existing URLs while keeping workspace files private', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'portal-layout-'));
  let server;
  t.after(async () => {
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(rootDir, { recursive: true, force: true });
  });
  for (const directory of ['public/assets', 'data', 'docs', 'artifacts']) await mkdir(path.join(rootDir, directory), { recursive: true });
  await writeFile(path.join(rootDir, 'data/articles.json'), JSON.stringify({ version: 1, articles: [] }));
  await writeFile(path.join(rootDir, 'public/index.html'), '<h1>public home</h1>');
  await writeFile(path.join(rootDir, 'public/admin.html'), '<h1>public admin</h1>');
  await writeFile(path.join(rootDir, 'public/app.js'), 'export const publicApp = true;');
  await writeFile(path.join(rootDir, 'public/assets/city.svg'), '<svg>public city</svg>');
  await writeFile(path.join(rootDir, 'index.html'), 'obsolete root file');
  await writeFile(path.join(rootDir, 'docs/private.txt'), 'workspace-only');
  await writeFile(path.join(rootDir, 'artifacts/report.txt'), 'workspace-only');
  server = await createPortalServer({ rootDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, expected] of [['/', 'public home'], ['/index.html', 'public home'], ['/admin', 'public admin'], ['/admin/', 'public admin'], ['/app.js', 'publicApp'], ['/assets/city.svg', 'public city']]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).includes(expected), `${route} must use public/`);
  }
  for (const route of ['/public/index.html', '/data/articles.json', '/docs/private.txt', '/artifacts/report.txt', '/assets/%2e%2e%2f%2e%2e%2fserver.mjs']) assert.equal((await fetch(base + route)).status, 404, route);
});
