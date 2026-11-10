import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { createPortalServer } from '../server.mjs';
import { hashPassword, verifyPassword } from '../lib/auth.mjs';
import { makeUser, normalizeAccounts } from '../lib/accounts.mjs';
import { appendAudit, validateLogs } from '../lib/audit.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const owner = { username: 'senior_owner', password: 'owner-password-2026' };
const seniorCredentials = { username: 'senior_editor', password: 'senior-password-2026' };
const ordinaryCredentials = { username: 'ordinary_editor', password: 'ordinary-password-2026' };
const article = { title: '高级管理员发布通知', category: '通知公告', date: '2050-10-11', summary: '权限验证', body: ['完整通知正文。'], source: '办公室', status: 'published' };
const feedback = { type: 'suggestion', gameName: 'SeniorTestPlayer', qq: '7654321098', title: '使用意见', content: '希望网站增加更多便民信息。' };

async function installation(t, legacy) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-senior-admin-'));
  const deploymentDir = path.join(dataDir, 'temporary-deployment');
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  if (legacy) await writeFile(path.join(dataDir, 'admin.json'), JSON.stringify(legacy));
  let server, base;
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir, now: () => Date.parse('2050-10-11T04:00:00Z'), schedulerIntervalMs: 60000 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function call(route, { method = 'GET', body, actor } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, value, response };
  }
  async function login(credentials, setup = false) {
    const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials });
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.value));
    return { ...result.value, cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken };
  }
  async function provision() {
    const superadmin = await login(owner, true);
    assert.equal((await call('/api/admin/users', { method: 'POST', actor: superadmin, body: { ...seniorCredentials, role: 'senioradmin' } })).status, 201);
    assert.equal((await call('/api/admin/users', { method: 'POST', actor: superadmin, body: ordinaryCredentials })).status, 201);
    return { superadmin, senior: await login(seniorCredentials), admin: await login(ordinaryCredentials) };
  }
  async function delayed(route, actor, method = 'POST') {
    const request = http.request(base + route, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: actor.cookie, 'X-CSRF-Token': actor.token, Expect: '100-continue' } });
    t.after(() => request.destroy());
    const responsePromise = once(request, 'response');
    request.flushHeaders();
    await once(request, 'continue');
    return async value => {
      request.end(JSON.stringify(value));
      const [response] = await responsePromise;
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      return { status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString()) };
    };
  }
  return { call, login, provision, delayed, dataDir, deploymentDir, restart: async () => { await stop(); await start(); } };
}

test('senioradmin account persistence retains existing credential bytes and verifies its password', async () => {
  const senior = await makeUser(seniorCredentials, 'senioradmin');
  const superadmin = { ...await hashPassword(owner.username, owner.password), id: 'owner', role: 'superadmin', disabled: false, createdAt: '2026-10-10T00:00:00.000Z' };
  const stored = { version: 2, users: [superadmin, senior] };
  assert.deepEqual(normalizeAccounts(stored), stored);
  assert.equal(await verifyPassword(normalizeAccounts(stored).users[1], seniorCredentials.password), true);
  assert.throws(() => normalizeAccounts({ version: 2, users: [senior] }), error => error.status === 400);
});

test('senioradmin audit entries remain readable after serialization without recording secrets', () => {
  const logs = appendAudit([], { action: 'article.create', actor: { id: 'senior', username: 'senior_editor', role: 'senioradmin' }, target: { type: 'article', id: 'notice', title: article.title } }, Date.parse('2026-10-11T00:00:00Z'));
  const read = validateLogs(JSON.parse(JSON.stringify(logs)));
  assert.equal(read[0].actor.role, 'senioradmin');
  assert.equal(read[0].action, 'article.create');
});

test('senioradmin accounts and logs survive restart while legacy superadmin credentials stay unchanged', async t => {
  const legacy = await hashPassword(owner.username, owner.password);
  const site = await installation(t, legacy);
  const superadmin = await site.login(owner);
  assert.equal((await site.call('/api/admin/users', { method: 'POST', actor: superadmin, body: { ...seniorCredentials, role: 'senioradmin' } })).status, 201);
  const senior = await site.login(seniorCredentials);
  assert.equal(senior.role, 'senioradmin');
  assert.equal((await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: article })).status, 201);
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'admin.json'), 'utf8'));
  assert.equal(stored.users[0].salt, legacy.salt);
  assert.equal(stored.users[0].passwordHash, legacy.passwordHash);
  await site.restart();
  const again = await site.login(seniorCredentials);
  assert.equal(again.role, 'senioradmin');
  assert.equal((await site.call('/api/admin/logs?action=article.create', { actor: again })).value.logs[0].actor.role, 'senioradmin');
  assert.equal((await site.login(owner)).userId, superadmin.userId);
});

test('senioradmin manages drafts schedules published articles and every content approval', async t => {
  const site = await installation(t); const { senior, admin } = await site.provision();
  const published = await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: article });
  assert.equal(published.status, 201);
  const draft = await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: { ...article, title: '工作草稿', status: 'draft' } });
  assert.equal(draft.status, 201);
  const scheduled = await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: { ...article, title: '计划通知', status: 'scheduled', scheduledAt: '2050-10-11T05:00:00Z' } });
  assert.equal(scheduled.status, 201);
  assert.equal((await site.call('/api/admin/articles', { actor: senior })).value.articles.length, 3);
  assert.equal((await site.call('/api/admin/articles', { actor: admin })).value.articles.length, 1);
  assert.equal((await site.call(`/api/admin/articles/${draft.value.article.id}`, { method: 'PUT', actor: senior, body: { ...article, title: '草稿直接发布' } })).status, 200);
  assert.equal((await site.call(`/api/admin/articles/${scheduled.value.article.id}`, { method: 'DELETE', actor: senior, body: {} })).status, 200);
  const submit = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: { ...article, title: '待审批通知' } });
  assert.equal(submit.status, 202);
  assert.equal((await site.call('/api/admin/requests', { actor: senior })).value.requests.length, 1);
  assert.equal((await site.call(`/api/admin/requests/${submit.value.request.id}/review`, { method: 'POST', actor: senior, body: { decision: 'approve' } })).status, 200);
  const deletion = await site.call(`/api/admin/articles/${published.value.article.id}`, { method: 'DELETE', actor: admin, body: {} });
  assert.equal(deletion.status, 202);
  assert.equal((await site.call(`/api/admin/requests/${deletion.value.request.id}/review`, { method: 'POST', actor: senior, body: { decision: 'approve' } })).status, 200);
  const rejected = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: { ...article, title: '驳回通知' } });
  assert.equal((await site.call(`/api/admin/requests/${rejected.value.request.id}/review`, { method: 'POST', actor: senior, body: { decision: 'reject', note: '请完善正文' } })).status, 200);
  assert.deepEqual((await site.call('/api/articles')).value.articles.map(value => value.title).sort(), ['待审批通知', '草稿直接发布'].sort());
});

test('ordinary administrators keep publish delete review and whole-site restrictions', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  assert.equal(submitted.status, 202);
  assert.equal((await site.call('/api/articles')).value.articles.length, 0);
  const reviewRoute = `/api/admin/requests/${submitted.value.request.id}/review`;
  assert.equal((await site.call(reviewRoute, { method: 'POST', actor: admin, body: { decision: 'approve' } })).status, 403);
  assert.equal((await site.call(reviewRoute, { method: 'POST', actor: superadmin, body: { decision: 'approve' } })).status, 200);
  assert.equal((await site.call(`/api/admin/articles/${submitted.value.request.article.id}`, { method: 'DELETE', actor: admin, body: {} })).status, 202);
  assert.equal((await site.call('/api/articles')).value.articles.length, 1);
  for (const route of ['/api/admin/site-content', '/api/admin/logs', '/api/admin/users', '/api/admin/export', '/api/admin/deployment?platform=windows-x64', '/api/admin/deployment?platform=linux-x64']) {
    assert.equal((await site.call(route, { actor: admin })).status, 403, route);
  }
  assert.equal((await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: { ...article, status: 'draft' } })).status, 400);
});

test('senioradmin edits website feedback states and backups without exposing QQ in audit logs', async t => {
  const site = await installation(t); const { senior, admin } = await site.provision();
  const content = (await site.call('/api/admin/site-content', { actor: senior })).value.content;
  content.values['footer.contact'] = '高级管理员设置的联系方式';
  assert.equal((await site.call('/api/admin/site-content', { method: 'PUT', actor: senior, body: content })).status, 200);
  assert.equal((await site.call('/api/site-content')).value.content.values['footer.contact'], '高级管理员设置的联系方式');
  const submitted = await site.call('/api/feedback', { method: 'POST', body: feedback });
  assert.equal(submitted.status, 201);
  const record = (await site.call(`/api/admin/feedback?search=${feedback.qq}`, { actor: senior })).value.feedback[0];
  assert.equal(record.qq, feedback.qq);
  assert.equal((await site.call(`/api/admin/feedback/${record.id}`, { method: 'PATCH', actor: admin, body: { status: 'read' } })).status, 200);
  assert.equal((await site.call(`/api/admin/feedback/${record.id}`, { method: 'PATCH', actor: senior, body: { status: 'new' } })).status, 200);
  assert.equal((await site.call(`/api/admin/feedback/${record.id}`, { method: 'PATCH', actor: senior, body: { status: 'read' } })).status, 200);
  assert.equal((await site.call(`/api/admin/feedback/${record.id}`, { method: 'DELETE', actor: senior, body: {} })).status, 403);
  const created = await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: article });
  const backup = await site.call('/api/admin/export', { actor: senior });
  assert.equal(backup.status, 200);
  assert.deepEqual(Object.keys(backup.value).sort(), ['articles', 'exportedAt', 'siteContent', 'version']);
  assert.equal((await site.call(`/api/admin/articles/${created.value.article.id}`, { method: 'DELETE', actor: senior, body: {} })).status, 200);
  assert.equal((await site.call('/api/admin/import', { method: 'POST', actor: senior, body: backup.value })).status, 200);
  assert.equal((await site.call('/api/articles')).value.articles[0].id, created.value.article.id);
  assert.equal((await readFile(path.join(site.dataDir, 'logs.json'), 'utf8')).includes(feedback.qq), false);
});

test('senioradmin downloads Windows and Linux packages containing content snapshots only', async t => {
  const site = await installation(t); const { senior } = await site.provision();
  const created = await site.call('/api/admin/articles', { method: 'POST', actor: senior, body: article });
  for (const platform of ['windows-x64', 'linux-x64']) {
    const result = await site.call(`/api/admin/deployment?platform=${platform}`, { actor: senior });
    assert.equal(result.status, 200);
    assert.match(result.response.headers.get('content-disposition'), platform === 'windows-x64' ? /windows-x64\.zip/ : /linux-x64\.tar\.gz/);
    const files = new Map();
    if (platform === 'windows-x64') {
      let offset = 0;
      while (result.value.readUInt32LE(offset) === 0x04034b50) {
        const size = result.value.readUInt32LE(offset + 18), nameLength = result.value.readUInt16LE(offset + 26), extraLength = result.value.readUInt16LE(offset + 28);
        const name = result.value.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
        const start = offset + 30 + nameLength + extraLength;
        const bytes = result.value.subarray(start, start + size);
        files.set(name, result.value.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes);
        offset = start + size;
      }
    } else {
      const raw = gunzipSync(result.value);
      let offset = 0;
      const field = (start, length) => raw.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
      while (raw[offset] !== 0) {
        const name = field(offset, 100), size = parseInt(field(offset + 124, 12), 8);
        files.set(name, raw.subarray(offset + 512, offset + 512 + size));
        offset += 512 + Math.ceil(size / 512) * 512;
      }
    }
    assert.deepEqual([...files.keys()].filter(name => name.startsWith('data/') && !name.endsWith('/')).sort(), ['data/articles.json', 'data/site-content.json']);
    assert.equal(JSON.parse(files.get('data/articles.json').toString()).articles[0].id, created.value.article.id);
    assert.ok(files.has('runtime/node.exe'));
    assert.ok(files.has('runtime/node-v24.21.0-linux-x64.tar.gz'));
  }
  assert.equal((await site.call('/api/admin/logs?action=deployment.export', { actor: senior })).value.total, 2);
});

test('superadmin changes other accounts through all three roles and revokes every prior session', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const credentials = ordinaryCredentials;
  let session = admin;
  for (const role of ['senioradmin', 'superadmin', 'admin']) {
    const second = await site.login(credentials);
    const changed = await site.call(`/api/admin/users/${session.userId}`, { method: 'PUT', actor: superadmin, body: { role } });
    assert.equal(changed.status, 200);
    assert.equal(changed.value.user.role, role);
    assert.equal((await site.call('/api/admin/session', { actor: session })).value.authenticated, false);
    assert.equal((await site.call('/api/admin/session', { actor: second })).value.authenticated, false);
    session = await site.login(credentials);
    assert.equal(session.role, role);
    assert.equal((await site.call('/api/admin/session', { actor: superadmin })).value.authenticated, true);
  }
  assert.equal((await site.call(`/api/admin/users/${superadmin.userId}`, { method: 'PUT', actor: superadmin, body: { role: 'admin' } })).status, 409);
});

test('senioradmin creates non-super accounts and manages their passwords enablement and deletion', async t => {
  const site = await installation(t); const { senior, admin, superadmin } = await site.provision();
  for (const role of ['admin', 'senioradmin']) {
    const created = await site.call('/api/admin/users', { method: 'POST', actor: senior, body: { username: `managed_${role}`, password: 'managed-password-2026', role } });
    assert.equal(created.status, 201); assert.equal(created.value.user.role, role);
    assert.equal((await site.call(`/api/admin/users/${created.value.user.id}`, { method: 'DELETE', actor: senior, body: {} })).status, 200);
  }
  const resetPassword = 'reset-by-senior-2026';
  assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: senior, body: { newPassword: resetPassword } })).status, 200);
  assert.equal((await site.call('/api/admin/session', { actor: admin })).value.authenticated, false);
  const reset = await site.login({ ...ordinaryCredentials, password: resetPassword });
  assert.equal(reset.role, 'admin');
  assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: senior, body: { disabled: true } })).status, 200);
  assert.equal((await site.call('/api/admin/session', { actor: reset })).value.authenticated, false);
  assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: senior, body: { disabled: false } })).status, 200);
  assert.equal((await site.login({ ...ordinaryCredentials, password: resetPassword })).role, 'admin');
  assert.equal((await site.call(`/api/admin/users/${senior.userId}`, { method: 'DELETE', actor: senior, body: {} })).status, 409);
  assert.equal((await site.call('/api/admin/password', { method: 'PUT', actor: senior, body: { currentPassword: seniorCredentials.password, newPassword: 'senior-own-password-2026' } })).status, 200);
  const publicUsers = (await site.call('/api/admin/users', { actor: senior })).value.users;
  assert.equal(publicUsers.some(user => 'salt' in user || 'passwordHash' in user), false);
  assert.equal((await site.call('/api/admin/session', { actor: superadmin })).value.authenticated, true);
});

test('senioradmin cannot forge role fields or obtain superadmin access by account reset', async t => {
  const site = await installation(t); const { senior, admin, superadmin } = await site.provision();
  assert.equal((await site.call('/api/admin/users', { method: 'POST', actor: senior, body: { username: 'forged_owner', password: 'forged-password-2026', role: 'superadmin' } })).status, 403);
  for (const role of ['admin', 'senioradmin', 'superadmin', null, 'invalid']) {
    assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: senior, body: { role, newPassword: 'role-field-password-2026' } })).status, 403, String(role));
  }
  for (const body of [{ newPassword: 'stolen-super-password-2026' }, { disabled: false }, { disabled: true }, { role: 'admin' }]) {
    assert.equal((await site.call(`/api/admin/users/${superadmin.userId}`, { method: 'PUT', actor: senior, body })).status, 403);
  }
  assert.equal((await site.call(`/api/admin/users/${superadmin.userId}`, { method: 'DELETE', actor: senior, body: {} })).status, 403);
  assert.equal((await site.login(owner)).role, 'superadmin');
  assert.equal((await site.login(ordinaryCredentials)).role, 'admin');
});

test('senioradmin rejects a forged role field even in an account deletion payload', async t => {
  const site = await installation(t); const { senior, admin } = await site.provision();
  assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'DELETE', actor: senior, body: { role: 'superadmin' } })).status, 403);
  assert.equal((await site.login(ordinaryCredentials)).role, 'admin');
});

test('a downgraded senioradmin cannot finish direct publication approval website or backup writes', async t => {
  const site = await installation(t); const { superadmin, senior, admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  const originalContent = (await site.call('/api/admin/site-content', { actor: superadmin })).value.content;
  const changedContent = structuredClone(originalContent); changedContent.values['footer.contact'] = '不能提交的改动';
  for (const [route, method, body] of [
    ['/api/admin/articles', 'POST', { ...article, title: '降级后不能直接发布' }],
    [`/api/admin/requests/${submitted.value.request.id}/review`, 'POST', { decision: 'approve' }],
    ['/api/admin/site-content', 'PUT', changedContent],
    ['/api/admin/import', 'POST', { version: 1, articles: [], siteContent: changedContent }]
  ]) {
    const current = await site.login(seniorCredentials);
    const finish = await site.delayed(route, current, method);
    assert.equal((await site.call(`/api/admin/users/${senior.userId}`, { method: 'PUT', actor: superadmin, body: { role: 'admin' } })).status, 200);
    assert.equal((await finish(body)).status, 401, route);
    assert.equal((await site.call(`/api/admin/users/${senior.userId}`, { method: 'PUT', actor: superadmin, body: { role: 'senioradmin' } })).status, 200);
  }
  assert.equal((await site.call('/api/articles')).value.articles.length, 0);
  assert.equal((await site.call('/api/admin/requests', { actor: superadmin })).value.requests[0].status, 'pending');
  assert.deepEqual((await site.call('/api/site-content')).value.content, originalContent);
});

test('senioradmin cannot complete a password reset after its target becomes superadmin', async t => {
  const site = await installation(t); const { superadmin, senior, admin } = await site.provision();
  const finish = await site.delayed(`/api/admin/users/${admin.userId}`, senior, 'PUT');
  assert.equal((await site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: superadmin, body: { role: 'superadmin' } })).status, 200);
  assert.equal((await finish({ newPassword: 'promoted-target-password-2026' })).status, 403);
  assert.equal((await site.login(ordinaryCredentials)).role, 'superadmin');
  assert.equal((await site.call('/api/admin/login', { method: 'POST', body: { ...ordinaryCredentials, password: 'promoted-target-password-2026' } })).status, 401);
});

test('a login queued behind senioradmin downgrade reports the committed role and audit identity', async t => {
  const site = await installation(t); const { superadmin, senior } = await site.provision();
  const transactionFile = path.join(site.dataDir, 'content-transaction.json');
  const originalRename = fs.rename;
  let armed = true;
  let releaseCommit;
  let blockedCommit;
  const commitBlocked = new Promise(resolve => { blockedCommit = resolve; });
  fs.rename = async (from, to) => {
    if (armed && to === transactionFile) {
      armed = false;
      blockedCommit();
      await new Promise(resolve => { releaseCommit = resolve; });
    }
    return originalRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    const downgrade = site.call(`/api/admin/users/${senior.userId}`, { method: 'PUT', actor: superadmin, body: { role: 'admin' } });
    await Promise.race([commitBlocked, new Promise((_, reject) => setTimeout(() => reject(new Error('降级事务没有进入提交点')), 3000))]);
    const login = site.call('/api/admin/login', { method: 'POST', body: seniorCredentials });
    await new Promise(resolve => setTimeout(resolve, 100));
    releaseCommit();
    assert.equal((await downgrade).status, 200);
    const loggedIn = await login;
    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.value));
    assert.equal(loggedIn.value.role, 'admin');
    const current = await site.call('/api/admin/session', { actor: { cookie: loggedIn.response.headers.get('set-cookie').split(';')[0], token: loggedIn.value.csrfToken } });
    assert.equal(current.value.role, 'admin');
    assert.equal((await site.call('/api/admin/logs?search=senior_editor&action=account.login', { actor: superadmin })).value.logs[0].actor.role, 'admin');
  } finally {
    if (releaseCommit) releaseCommit();
    fs.rename = originalRename;
    syncBuiltinESMExports();
  }
});
