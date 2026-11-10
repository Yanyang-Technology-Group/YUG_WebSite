import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sample = { title: '测试政务信息发布', category: '通知公告', date: '2026-10-10', summary: '来自测试的新信息', body: ['正文第一段。', '正文第二段。'], source: '办公室', status: 'published' };
const account = { username: 'portal_admin', password: 'secure-password-123' };

test('exposes a server factory without starting a listener on import', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import assert from 'node:assert/strict'; const api = await import('./server.mjs'); assert.equal(typeof api.createPortalServer, 'function');"], { cwd: rootDir, encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

async function installation(t, { bindHost = '127.0.0.1', connectHost = '127.0.0.1' } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-test-'));
  const { createPortalServer } = await import('../server.mjs');
  let server;
  let base;
  let cookie = '';
  let token = '';
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'downloads') });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, bindHost, resolve); });
    base = `http://${connectHost}:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', body, headers = {}, auth = true } = {}) {
    const outgoing = { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(auth && cookie ? { Cookie: cookie } : {}), ...(auth && token ? { 'X-CSRF-Token': token } : {}), ...headers };
    const response = await fetch(base + route, { method, headers: outgoing, body: body === undefined ? undefined : JSON.stringify(body) });
    const content = response.headers.get('content-type') || '';
    const value = content.includes('application/json') ? await response.json() : /application\/(zip|gzip)/.test(content) ? Buffer.from(await response.arrayBuffer()) : await response.text();
    return { response, status: response.status, value };
  }
  async function setup() {
    const result = await request('/api/admin/setup', { method: 'POST', body: account });
    assert.equal(result.status, 201, JSON.stringify(result.value));
    cookie = result.response.headers.get('set-cookie').split(';')[0];
    token = result.value.csrfToken;
    return result;
  }
  function authenticate(result) {
    cookie = result.response.headers.get('set-cookie').split(';')[0];
    token = result.value.csrfToken;
  }
  return { request, setup, authenticate, dataDir, restart: async () => { await stop(); cookie = ''; token = ''; await start(); }, get base() { return base; }, get cookie() { return cookie; }, get token() { return token; } };
}

test('initializes 24 sample articles durably and protects private files', async t => {
  const site = await installation(t);
  const health = await site.request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.value.ok, true);
  const list = await site.request('/api/articles');
  assert.equal(list.value.articles.length, 24);
  assert.ok(list.value.articles.every(article => article.status === 'published' && article.isSample === true));
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  assert.equal(stored.articles.length, 24);
  for (const route of ['/data/articles.json', '/server.mjs', '/package.json', '/lib/store.mjs', '/tests/search.test.js', '/scripts/build.mjs', '/assets/../server.mjs', '/assets/%2e%2e%2fserver.mjs', '/assets/%5c..%5cserver.mjs']) {
    assert.equal((await site.request(route)).status, 404, route);
  }
  assert.equal((await site.request('/index.html')).status, 200);
});

test('sets up one administrator with a hashed password and requires authentication', async t => {
  const site = await installation(t);
  const session = await site.request('/api/admin/session');
  assert.equal(session.value.authenticated, false);
  assert.equal(session.value.setupRequired, true);
  assert.equal(session.value.setupAllowed, true);
  assert.equal((await site.request('/api/admin/articles')).status, 401);
  assert.equal((await site.request('/api/admin/setup', { method: 'POST', body: { username: 'ad', password: 'short' } })).status, 400);
  const result = await site.setup();
  const cookieHeader = result.response.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  assert.ok(result.value.csrfToken.length >= 32);
  assert.equal((await site.request('/api/admin/setup', { method: 'POST', body: account })).status, 409);
  const adminFile = await readFile(path.join(site.dataDir, 'admin.json'), 'utf8');
  assert.ok(!adminFile.includes(account.password));
  assert.equal((await site.request('/api/admin/session')).value.username, account.username);
  assert.equal((await site.request('/api/admin/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await site.request('/api/admin/articles')).status, 401);
  assert.equal((await site.request('/api/admin/login', { method: 'POST', body: { ...account, password: 'wrong-password' } })).status, 401);
  const login = await site.request('/api/admin/login', { method: 'POST', body: account });
  assert.equal(login.status, 200);
  site.authenticate(login);
  assert.equal((await site.request('/api/admin/articles')).status, 200);
});

test('publishes, edits, deletes and persists articles while keeping drafts private', async t => {
  const site = await installation(t);
  await site.setup();
  const created = await site.request('/api/admin/articles', { method: 'POST', body: sample });
  assert.equal(created.status, 201);
  const id = created.value.article.id;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(created.value.article.isSample, false);
  assert.equal((await site.request('/api/articles')).value.articles.filter(article => article.id === id).length, 1);
  const edited = await site.request(`/api/admin/articles/${id}`, { method: 'PUT', body: { ...sample, title: '修改后暂存文章', status: 'draft' } });
  assert.equal(edited.status, 200);
  assert.equal((await site.request('/api/articles')).value.articles.some(article => article.id === id), false);
  assert.equal((await site.request('/api/admin/articles')).value.articles.find(article => article.id === id).title, '修改后暂存文章');
  await site.restart();
  const login = await site.request('/api/admin/login', { method: 'POST', body: account });
  assert.equal(login.status, 200);
  site.authenticate(login);
  assert.equal((await site.request('/api/admin/articles')).value.articles.find(article => article.id === id).status, 'draft');
  assert.equal((await site.request(`/api/admin/articles/${id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await site.request('/api/admin/articles')).value.articles.some(article => article.id === id), false);
});

test('rejects forged writes, missing CSRF and invalid article fields without changing content', async t => {
  const site = await installation(t);
  await site.setup();
  const failures = [
    { headers: { Origin: 'https://attacker.invalid' }, status: 403 },
    { headers: { Origin: site.base.replace('http:', 'https:') }, status: 403 },
    { headers: { 'Sec-Fetch-Site': 'cross-site' }, status: 403 },
    { headers: { 'X-CSRF-Token': '' }, status: 403 },
    { headers: { 'Content-Type': 'text/plain' }, status: 415 },
    { body: { ...sample, date: '2026-02-30' }, status: 400 },
    { body: { ...sample, body: [] }, status: 400 },
    { body: { ...sample, category: '其他' }, status: 400 },
    { body: { ...sample, title: 'X' }, status: 400 },
    { body: { ...sample, status: 'scheduled' }, status: 400 }
  ];
  for (const failure of failures) {
    const result = await site.request('/api/admin/articles', { method: 'POST', body: failure.body || sample, headers: failure.headers });
    assert.equal(result.status, failure.status, JSON.stringify(result.value));
    assert.equal(typeof result.value.message, 'string');
  }
  assert.equal((await site.request('/api/admin/articles')).value.articles.length, 24);
});

test('rejects first administrator setup through a LAN address', async t => {
  const address = Object.values(os.networkInterfaces()).flat().find(entry => entry.family === 'IPv4' && !entry.internal)?.address;
  if (!address) { t.skip('No LAN interface is available.'); return; }
  const site = await installation(t, { bindHost: '0.0.0.0', connectHost: address });
  assert.equal((await site.request('/api/admin/session')).value.setupAllowed, false);
  assert.equal((await site.request('/api/admin/setup', { method: 'POST', body: account })).status, 403);
  await assert.rejects(readFile(path.join(site.dataDir, 'admin.json')), { code: 'ENOENT' });
});

test('requires login for both deployment formats, rejects invalid platforms and preserves the Windows default', async t => {
  const site = await installation(t);
  assert.equal((await site.request('/api/admin/deployment')).status, 401);
  assert.equal((await site.request('/api/admin/deployment?platform=linux-x64')).status, 401);
  await site.setup();
  for (const platform of ['linux-arm64', '../../outside', '']) {
    assert.equal((await site.request('/api/admin/deployment?platform=' + encodeURIComponent(platform))).status, 400);
  }
  const result = await site.request('/api/admin/deployment');
  assert.equal(result.status, 200);
  assert.equal(result.response.headers.get('content-type'), 'application/zip');
  assert.match(result.response.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(result.value.readUInt32LE(0), 0x04034b50);
  assert.ok(result.value.includes(Buffer.from('runtime/node.exe')));
  assert.ok(result.value.includes(Buffer.from('data/articles.json')));
  assert.equal(result.value.includes(Buffer.from('data/admin.json')), false);
  const linux = await site.request('/api/admin/deployment?platform=linux-x64');
  assert.equal(linux.status, 200);
  assert.equal(linux.response.headers.get('content-type'), 'application/gzip');
  assert.match(linux.response.headers.get('content-disposition'), /linux-x64\.tar\.gz/);
  assert.equal(linux.value.subarray(0, 2).toString('hex'), '1f8b');
  const tar = gunzipSync(linux.value);
  const filenames = [];
  for (let offset = 0; tar[offset];) {
    const field = (start, length) => tar.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const prefix = field(offset + 345, 155);
    filenames.push((prefix ? prefix + '/' : '') + field(offset, 100));
    const size = parseInt(field(offset + 124, 12), 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(filenames.includes('start.sh'));
  assert.ok(filenames.includes('data/articles.json'));
  for (const name of ['admin.json', 'feedback.json', 'requests.json', 'logs.json', 'server.pid']) {
    assert.equal(filenames.includes('data/' + name), false, name);
  }
  const logs = await site.request('/api/admin/logs?action=deployment.export');
  assert.ok(logs.value.logs.some(log => log.result === 'success' && log.target.id === 'linux-x64'));
});

test('exports article backups and validates the entire import before replacing data', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = await site.request('/api/admin/export');
  assert.equal(backup.status, 200);
  assert.equal(backup.value.version, 1);
  assert.equal(backup.value.articles.length, 24);
  assert.equal((await site.request('/api/admin/export', { auth: false })).status, 401);
  const invalid = { version: 1, articles: [backup.value.articles[0], { ...backup.value.articles[1], title: '' }] };
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: invalid })).status, 400);
  assert.equal((await site.request('/api/articles')).value.articles.length, 24);
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: { version: 1, articles: [backup.value.articles[0]] } })).status, 200);
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
  await site.restart();
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
});

test('serializes concurrent article creation without dropping writes', async t => {
  const site = await installation(t);
  await site.setup();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => site.request('/api/admin/articles', { method: 'POST', body: { ...sample, title: `并发发布测试第${i + 1}篇` } })));
  assert.ok(results.every(result => result.status === 201));
  assert.equal(new Set(results.map(result => result.value.article.id)).size, 8);
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  assert.equal(stored.articles.length, 32);
});

test('changes the password and invalidates other authenticated sessions', async t => {
  const site = await installation(t);
  await site.setup();
  const oldCookie = site.cookie;
  const second = await site.request('/api/admin/login', { method: 'POST', body: account });
  site.authenticate(second);
  assert.equal((await site.request('/api/admin/password', { method: 'PUT', body: { currentPassword: 'incorrect', newPassword: 'another-safe-password' } })).status, 401);
  assert.equal((await site.request('/api/admin/password', { method: 'PUT', body: { currentPassword: account.password, newPassword: 'another-safe-password' } })).status, 200);
  assert.equal((await site.request('/api/admin/session', { headers: { Cookie: oldCookie } })).value.authenticated, false);
  assert.equal((await site.request('/api/admin/session')).value.authenticated, true);
  await site.restart();
  assert.equal((await site.request('/api/admin/login', { method: 'POST', body: account })).status, 401);
  assert.equal((await site.request('/api/admin/login', { method: 'POST', body: { ...account, password: 'another-safe-password' } })).status, 200);
});

test('rate limits repeated failed login attempts', async t => {
  const site = await installation(t);
  await site.setup();
  let result;
  for (let i = 0; i < 7; i++) result = await site.request('/api/admin/login', { method: 'POST', body: { ...account, password: 'wrong-password' } });
  assert.equal(result.status, 429);
  assert.ok(Number(result.response.headers.get('retry-after')) > 0);
});

test('cannot log in with the old password after a concurrent password change', async t => {
  const site = await installation(t);
  await site.setup();
  const pending = http.request(site.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site.base, Expect: '100-continue' } });
  const responsePromise = once(pending, 'response');
  pending.flushHeaders();
  await once(pending, 'continue');
  assert.equal((await site.request('/api/admin/password', { method: 'PUT', body: { currentPassword: account.password, newPassword: 'new-safe-password-456' } })).status, 200);
  pending.end(JSON.stringify(account));
  const [response] = await responsePromise;
  response.resume();
  await once(response, 'end');
  assert.equal(response.statusCode, 401);
});

test('does not replace unreadable stored content with a fresh sample dataset', async t => {
  const site = await installation(t);
  await writeFile(path.join(site.dataDir, 'articles.json'), '{broken', 'utf8');
  const { createPortalServer } = await import('../server.mjs');
  await assert.rejects(createPortalServer({ rootDir, dataDir: site.dataDir, deploymentDir: path.join(site.dataDir, 'downloads') }), /文章数据/);
  assert.equal(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'), '{broken');
});

test('keeps a nearly full 64 MiB article dataset restorable and rejects oversized writes atomically', async t => {
  const site = await installation(t);
  await site.setup();
  const limit = 64 * 1024 * 1024;
  const fullBody = '政'.repeat(50000);
  const metadata = { isSample: false, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
  const articles = [{ ...sample, ...metadata, id: 'small-article', body: ['短正文'] }, ...Array.from({ length: 446 }, (_, i) => ({ ...sample, ...metadata, id: `large-article-${i}`, body: [fullBody] }))];
  const filler = { ...sample, ...metadata, id: 'capacity-filler', body: ['政'] };
  articles.push(filler);
  const remaining = limit - Buffer.byteLength(JSON.stringify({ version: 1, articles }, null, 2) + '\n');
  assert.ok(remaining > 1024 && remaining < 150000);
  filler.body = ['政'.repeat(1 + Math.floor((remaining - 1024) / 3))];
  const persistedBytes = Buffer.byteLength(JSON.stringify({ version: 1, articles }, null, 2) + '\n');
  assert.ok(persistedBytes <= limit && persistedBytes > limit - 1100);
  const accepted = await site.request('/api/admin/import', { method: 'POST', body: { version: 1, articles } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
  const before = await readFile(path.join(site.dataDir, 'articles.json'));
  assert.equal(before.length, persistedBytes);
  const largePost = { ...sample, body: [fullBody] };
  for (const [route, method, payload] of [
    ['/api/admin/articles', 'POST', largePost],
    ['/api/admin/articles/small-article', 'PUT', largePost],
    ['/api/admin/import', 'POST', { version: 1, articles: [...articles, { ...largePost, ...metadata, id: 'overflow-article' }] }]
  ]) {
    const rejected = await site.request(route, { method, body: payload });
    assert.equal(rejected.status, 413, JSON.stringify(rejected.value));
    assert.match(rejected.value.message, /64 MiB/);
    assert.equal((await readFile(path.join(site.dataDir, 'articles.json'))).equals(before), true);
  }
  const exported = await fetch(site.base + '/api/admin/export', { headers: { Cookie: site.cookie } });
  assert.equal(exported.status, 200);
  const backup = await exported.text();
  const contentSize = Buffer.byteLength(JSON.stringify(JSON.parse(backup).siteContent, null, 2));
  assert.ok(Buffer.byteLength(backup) > 20 * 1024 * 1024 && Buffer.byteLength(backup) <= limit + contentSize * 2 + 500);
  const restored = await fetch(site.base + '/api/admin/import', { method: 'POST', headers: { Cookie: site.cookie, 'X-CSRF-Token': site.token, 'Content-Type': 'application/json', Origin: site.base }, body: backup });
  assert.equal(restored.status, 200, await restored.text());
  const saved = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  assert.equal(saved.articles.length, 448);
  assert.equal(saved.articles.find(article => article.id === 'small-article').body[0], '短正文');
});

test('rejects the 10001st article without breaking restart or backup restoration', async t => {
  const site = await installation(t);
  await site.setup();
  const articles = Array.from({ length: 10000 }, (_, i) => ({ ...sample, id: `article-${i}`, body: ['短正文'] }));
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: { version: 1, articles } })).status, 200);
  const before = await readFile(path.join(site.dataDir, 'articles.json'));
  const overflow = await site.request('/api/admin/articles', { method: 'POST', body: sample });
  assert.equal(overflow.status, 413);
  assert.match(overflow.value.message, /10000/);
  assert.equal((await readFile(path.join(site.dataDir, 'articles.json'))).equals(before), true);
  await site.restart();
  assert.equal((await site.request('/api/articles')).value.articles.length, 10000);
  const login = await site.request('/api/admin/login', { method: 'POST', body: account });
  site.authenticate(login);
  const backup = await site.request('/api/admin/export');
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: backup.value })).status, 200);
});
