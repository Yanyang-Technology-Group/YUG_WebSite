import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/auth.mjs';
import { createPortalServer } from '../server.mjs';
const rootDir = fileURLToPath(new URL('../', import.meta.url));
const owner = { username: 'owner_admin', password: 'owner-password-2026' };
const editor = { username: 'ordinary_admin', password: 'editor-password-2026' };
const article = { title: '需要审核的联合政府通知', category: '通知公告', date: '2026-10-10', summary: '审批测试', body: ['正文第一段。'], source: '办公室', status: 'published' };

async function installation(t, legacy) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-permissions-'));
  if (legacy) await writeFile(path.join(dataDir, 'admin.json'), JSON.stringify(legacy));
  let server, base;
  async function start() { server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment') }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function call(route, { method = 'GET', body, actor } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json(), response };
  }
  async function login(credentials, setup = false) { const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials }); assert.ok([200, 201].includes(result.status), JSON.stringify(result.value)); return { ...result.value, cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken }; }
  async function provision() { const superadmin = await login(owner, true); const result = await call('/api/admin/users', { method: 'POST', actor: superadmin, body: editor }); assert.equal(result.status, 201, JSON.stringify(result.value)); return { superadmin, admin: await login(editor), user: result.value.user }; }
  return { call, login, provision, dataDir, restart: async () => { await stop(); await start(); }, get base() { return base; } };
}

test('migrates the existing credential to a durable superadmin without changing its password', async t => {
  const legacy = await hashPassword(owner.username, owner.password);
  const site = await installation(t, legacy);
  const actor = await site.login(owner);
  assert.equal(actor.role, 'superadmin');
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'admin.json'), 'utf8'));
  assert.equal(stored.version, 2); assert.equal(stored.users[0].passwordHash, legacy.passwordHash); assert.equal(stored.users[0].salt, legacy.salt);
  await site.restart(); assert.equal((await site.login(owner)).userId, actor.userId);
});

test('ordinary administrators cannot change existing content, settings, accounts, backups or deployment', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const id = (await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: article })).value.article.id;
  for (const [route, method, body] of [
    [`/api/admin/articles/${id}`, 'PUT', article], ['/api/admin/site-content', 'GET'], ['/api/admin/site-content', 'PUT', { version: 1, values: {} }], ['/api/admin/users', 'GET'], ['/api/admin/users', 'POST', { ...owner, role: 'superadmin' }], ['/api/admin/export', 'GET'], ['/api/admin/import', 'POST', { version: 1, articles: [] }], ['/api/admin/deployment', 'GET'], ['/api/admin/deployment?platform=windows-x64', 'GET'], ['/api/admin/deployment?platform=linux-x64', 'GET']
  ]) assert.equal((await site.call(route, { method, body, actor: admin })).status, 403, route);
  assert.equal((await site.call('/api/admin/session', { actor: admin })).value.role, 'admin');
});

test('publishing and deleting require approval and keep rejected submissions off the portal', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const submit = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: { ...article, role: 'superadmin' } });
  assert.equal(submit.status, 202); const requestId = submit.value.request.id; const id = submit.value.request.article.id;
  assert.equal((await site.call('/api/articles')).value.articles.some(a => a.id === id), false);
  assert.equal((await site.call(`/api/admin/requests/${requestId}/review`, { method: 'POST', actor: admin, body: { decision: 'approve' } })).status, 403);
  assert.equal((await site.call(`/api/admin/requests/${requestId}/review`, { method: 'POST', actor: superadmin, body: { decision: 'approve', note: '审核通过' } })).status, 200);
  assert.equal((await site.call('/api/articles')).value.articles.some(a => a.id === id), true);
  const rejected = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: { ...article, title: '被驳回的申请文章' } });
  assert.equal((await site.call(`/api/admin/requests/${rejected.value.request.id}/review`, { method: 'POST', actor: superadmin, body: { decision: 'reject', note: '请核实正文' } })).status, 200);
  assert.equal((await site.call('/api/articles')).value.articles.some(a => a.title === '被驳回的申请文章'), false);
  const deletion = await site.call(`/api/admin/articles/${id}`, { method: 'DELETE', actor: admin, body: {} }); assert.equal(deletion.status, 202);
  assert.equal((await site.call('/api/articles')).value.articles.some(a => a.id === id), true);
  assert.equal((await site.call(`/api/admin/requests/${deletion.value.request.id}/review`, { method: 'POST', actor: superadmin, body: { decision: 'approve' } })).status, 200);
  assert.equal((await site.call('/api/articles')).value.articles.some(a => a.id === id), false);
  await site.restart(); const again = await site.login(editor);
  const requests = (await site.call('/api/admin/requests', { actor: again })).value.requests;
  assert.equal(requests.length, 3); assert.equal(requests.filter(r => r.status === 'approved').length, 2); assert.equal(requests.find(r => r.status === 'rejected').note, '请核实正文');
});

test('approval is committed only once and deletion refuses a changed target snapshot', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  const route = `/api/admin/requests/${submitted.value.request.id}/review`;
  const results = await Promise.all([1, 2].map(() => site.call(route, { method: 'POST', actor: superadmin, body: { decision: 'approve' } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const id = submitted.value.request.article.id;
  assert.equal((await site.call('/api/articles')).value.articles.filter(a => a.id === id).length, 1);
  const deletion = await site.call(`/api/admin/articles/${id}`, { method: 'DELETE', actor: admin, body: {} });
  await site.call(`/api/admin/articles/${id}`, { method: 'PUT', actor: superadmin, body: { ...article, body: ['超级管理员修改后的正文。'] } });
  assert.equal((await site.call(`/api/admin/requests/${deletion.value.request.id}/review`, { method: 'POST', actor: superadmin, body: { decision: 'approve' } })).status, 409);
  assert.equal((await site.call('/api/articles')).value.articles.find(a => a.id === id).body[0], '超级管理员修改后的正文。');
});

test('accounts remain private, duplicate usernames are rejected and disabled sessions stop immediately', async t => {
  const site = await installation(t); const { superadmin, admin, user } = await site.provision();
  assert.equal((await site.call('/api/admin/users', { method: 'POST', actor: superadmin, body: { ...editor, username: editor.username.toUpperCase() } })).status, 409);
  const users = (await site.call('/api/admin/users', { actor: superadmin })).value.users;
  assert.equal(users.length, 2); assert.equal(users.some(u => 'passwordHash' in u || 'salt' in u), false);
  assert.equal((await site.call(`/api/admin/users/${superadmin.userId}`, { method: 'DELETE', actor: superadmin, body: {} })).status, 409);
  assert.equal((await site.call(`/api/admin/users/${user.id}`, { method: 'PUT', actor: superadmin, body: { disabled: true } })).status, 200);
  assert.equal((await site.call('/api/admin/articles', { actor: admin })).status, 401);
  assert.equal((await site.call('/api/admin/session', { actor: admin })).value.authenticated, false);
  assert.equal((await site.call('/api/admin/login', { method: 'POST', body: editor })).status, 401);
});

test('password changes revoke only the same account and each administrator sees only their requests', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision(); const second = await site.login(editor);
  await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  const otherCredentials = { username: 'another_admin', password: 'another-password-2026' };
  await site.call('/api/admin/users', { method: 'POST', actor: superadmin, body: otherCredentials }); const other = await site.login(otherCredentials);
  assert.equal((await site.call('/api/admin/requests', { actor: other })).value.requests.length, 0);
  assert.equal((await site.call('/api/admin/password', { method: 'PUT', actor: second, body: { currentPassword: editor.password, newPassword: 'changed-password-2026' } })).status, 200);
  assert.equal((await site.call('/api/admin/articles', { actor: admin })).status, 401);
  assert.equal((await site.call('/api/admin/articles', { actor: superadmin })).status, 200);
  assert.equal((await site.call('/api/admin/articles', { actor: other })).status, 200);
});

test('a deleted account cannot finish a write that was waiting for its request body', async t => {
  const site = await installation(t); const { superadmin, admin, user } = await site.provision();
  const delayed = http.request(site.base + '/api/admin/articles', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site.base, Cookie: admin.cookie, 'X-CSRF-Token': admin.token, Expect: '100-continue' } });
  const responsePromise = once(delayed, 'response'); delayed.flushHeaders(); await once(delayed, 'continue');
  assert.equal((await site.call(`/api/admin/users/${user.id}`, { method: 'DELETE', actor: superadmin, body: {} })).status, 200);
  delayed.end(JSON.stringify(article)); const [response] = await responsePromise; response.resume(); await once(response, 'end');
  assert.equal(response.statusCode, 401);
  assert.equal((await site.call('/api/admin/requests', { actor: superadmin })).value.requests.length, 0);
});

test('persisted empty or malformed accounts refuse startup instead of reopening initial setup', async t => {
  const site = await installation(t);
  for (const document of [{ version: 2, users: [] }, { version: 3, users: [] }, { username: 'corrupt_admin' }]) {
    await writeFile(path.join(site.dataDir, 'admin.json'), JSON.stringify(document));
    await assert.rejects(createPortalServer({ rootDir, dataDir: site.dataDir, deploymentDir: path.join(site.dataDir, 'temporary-deployment') }), /管理员数据/);
  }
});
