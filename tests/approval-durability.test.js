import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortalServer } from '../server.mjs';
import { createStore } from '../lib/store.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const owner = { username: 'durability_owner', password: 'owner-password-2026' };
const editor = { username: 'durability_admin', password: 'editor-password-2026' };
const changedPassword = 'replacement-password-2026';
const article = { title: '断电恢复审批通知', category: '通知公告', date: '2026-10-10', summary: '审批持久化测试', body: ['经审批后发布的完整正文。'], source: '办公室', status: 'published' };

function nearCapacityRequests(template, reviewReserveBytes) {
  const limit = 32 * 1024 * 1024;
  const requests = [];
  const encode = () => JSON.stringify({ version: 1, requests }, null, 2) + '\n';
  const budget = () => Buffer.byteLength(encode()) + requests.length * reviewReserveBytes;
  function record(id, body) {
    const item = structuredClone(template);
    item.id = `capacity-request-${id}`;
    item.article.id = `capacity-article-${id}`;
    item.article.body = [body];
    return item;
  }
  for (let i = 0; ; i++) {
    requests.push(record(i, '政'.repeat(50000)));
    if (budget() > limit) { requests.pop(); break; }
  }
  const filler = record('filler', '政');
  requests.push(filler);
  if (budget() > limit - 64) requests.splice(requests.length - 2, 1);
  const remaining = limit - budget();
  filler.article.body = ['政'.repeat(Math.min(50000, 1 + Math.floor((remaining - 64) / 3)))];
  return { requests, encoded: encode(), limit };
}

async function installation(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-approval-durability-'));
  let server;
  let base;
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment') });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  await start();
  async function call(route, { method = 'GET', body, actor } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
        ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, value: await response.json(), response };
  }
  async function login(credentials, setup = false) {
    const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials });
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.value));
    return { ...result.value, cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken };
  }
  async function provision() {
    const superadmin = await login(owner, true);
    const created = await call('/api/admin/users', { method: 'POST', actor: superadmin, body: editor });
    assert.equal(created.status, 201, JSON.stringify(created.value));
    return { superadmin, admin: await login(editor), user: created.value.user };
  }
  async function delayedPost(route, actor) {
    const request = http.request(base + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Origin: base, Expect: '100-continue',
        ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {})
      }
    });
    request.setTimeout(5000, () => request.destroy(new Error('Delayed request timed out')));
    t.after(() => request.destroy());
    const responsePromise = once(request, 'response');
    const continuePromise = once(request, 'continue');
    request.flushHeaders();
    await continuePromise;
    return async body => {
      request.end(JSON.stringify(body));
      const [response] = await responsePromise;
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      return { status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers };
    };
  }
  return { call, login, provision, delayedPost, dataDir, start, stop, restart: async () => { await stop(); await start(); } };
}

// Removing journal replay, or replaying articles without their review state,
// must fail this test even if the HTTP approval initially succeeded.
test('replays a committed approval over interrupted projections and cannot apply the approval twice', async t => {
  const site = await installation(t);
  const { superadmin, admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  assert.equal(submitted.status, 202, JSON.stringify(submitted.value));
  const requestId = submitted.value.request.id;
  const articleId = submitted.value.request.article.id;
  const route = `/api/admin/requests/${requestId}/review`;
  const approved = await site.call(route, { method: 'POST', actor: superadmin, body: { decision: 'approve', note: '审批提交后模拟断电' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.value));
  const articleDocument = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  const siteContent = JSON.parse(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'));
  const requestDocument = JSON.parse(await readFile(path.join(site.dataDir, 'requests.json'), 'utf8'));
  assert.equal(requestDocument.requests.find(item => item.id === requestId).status, 'approved');
  await site.stop();
  const journalFile = path.join(site.dataDir, 'content-transaction.json');
  await writeFile(journalFile, JSON.stringify({ version: 2, articles: articleDocument.articles, siteContent, requests: requestDocument.requests }));
  for (const filename of ['articles.json', 'site-content.json', 'requests.json']) await writeFile(path.join(site.dataDir, filename), '{interrupted projection');
  await site.start();
  const recovered = await site.login(owner);
  assert.equal((await site.call('/api/articles')).value.articles.filter(item => item.id === articleId).length, 1);
  const requests = (await site.call('/api/admin/requests', { actor: recovered })).value.requests;
  const request = requests.find(item => item.id === requestId);
  assert.equal(request.status, 'approved');
  assert.equal(request.note, '审批提交后模拟断电');
  assert.equal((await site.call(route, { method: 'POST', actor: recovered, body: { decision: 'approve' } })).status, 409);
  assert.deepEqual(JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8')), articleDocument);
  assert.deepEqual(JSON.parse(await readFile(path.join(site.dataDir, 'requests.json'), 'utf8')), requestDocument);
  assert.deepEqual(JSON.parse(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8')), siteContent);
  await assert.rejects(readFile(journalFile), { code: 'ENOENT' });
  await site.restart();
  assert.equal((await site.call('/api/articles')).value.articles.filter(item => item.id === articleId).length, 1);
});

// Treating unreadable request storage as an empty approval queue loses pending
// work and must never silently enable a fresh queue.
test('refuses unreadable or invalid request storage without replacing it', async t => {
  const site = await installation(t);
  const { admin } = await site.provision();
  assert.equal((await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article })).status, 202);
  await site.stop();
  const filename = path.join(site.dataDir, 'requests.json');
  for (const corrupted of ['{broken', '{"version":999,"requests":[]}', '{"version":1,"requests":[{"id":"bad-record","status":"approved"}]}']) {
    await writeFile(filename, corrupted, 'utf8');
    await assert.rejects(createPortalServer({ rootDir, dataDir: site.dataDir, deploymentDir: path.join(site.dataDir, 'temporary-deployment') }), /申请|审批|审核|请求/);
    assert.equal(await readFile(filename, 'utf8'), corrupted);
  }
});

// Keeping a credential snapshot from before the login body arrived would let
// a password that has already been reset create a fresh session.
test('a delayed login cannot use the old password after a superadmin resets the account', async t => {
  const site = await installation(t);
  const { superadmin, user } = await site.provision();
  const finishLogin = await site.delayedPost('/api/admin/login');
  const reset = await site.call(`/api/admin/users/${user.id}`, { method: 'PUT', actor: superadmin, body: { newPassword: changedPassword } });
  assert.equal(reset.status, 200, JSON.stringify(reset.value));
  const result = await finishLogin(editor);
  assert.equal(result.status, 401, JSON.stringify(result.value));
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal((await site.login({ ...editor, password: changedPassword })).role, 'admin');
});

// Removing per-user session revocation, or using global revocation instead,
// would violate one of these independent account boundaries.
test('a password reset revokes every session of that account while preserving other accounts', async t => {
  const site = await installation(t);
  const { superadmin, admin, user } = await site.provision();
  const second = await site.login(editor);
  const otherCredentials = { username: 'unaffected_admin', password: 'unaffected-password-2026' };
  assert.equal((await site.call('/api/admin/users', { method: 'POST', actor: superadmin, body: otherCredentials })).status, 201);
  const other = await site.login(otherCredentials);
  assert.equal((await site.call(`/api/admin/users/${user.id}`, { method: 'PUT', actor: superadmin, body: { newPassword: changedPassword } })).status, 200);
  for (const actor of [admin, second]) {
    assert.equal((await site.call('/api/admin/session', { actor })).value.authenticated, false);
    assert.equal((await site.call('/api/admin/articles', { actor })).status, 401);
  }
  assert.equal((await site.call('/api/admin/articles', { actor: superadmin })).status, 200);
  assert.equal((await site.call('/api/admin/articles', { actor: other })).status, 200);
  assert.equal((await site.call('/api/admin/login', { method: 'POST', body: editor })).status, 401);
  const replacement = await site.login({ ...editor, password: changedPassword });
  assert.equal((await site.call('/api/admin/articles', { actor: replacement })).status, 200);
});

// A write authenticated before its body arrives must not survive a password
// reset that has revoked its session in the meantime.
test('a password reset prevents a pending article submission from finishing with its revoked session', async t => {
  const site = await installation(t);
  const { superadmin, admin, user } = await site.provision();
  const finishWrite = await site.delayedPost('/api/admin/articles', admin);
  assert.equal((await site.call(`/api/admin/users/${user.id}`, { method: 'PUT', actor: superadmin, body: { newPassword: changedPassword } })).status, 200);
  assert.equal((await finishWrite(article)).status, 401);
  assert.equal((await site.call('/api/admin/requests', { actor: superadmin })).value.requests.length, 0);
});

// Counting only the current JSON size lets new submissions occupy the space
// required to approve existing work. Appending must fail before reviews do.
test('reserves capacity for maximum review notes and rejects an over-budget append without changing the queue', async t => {
  const site = await installation(t);
  const { admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  assert.equal(submitted.status, 202, JSON.stringify(submitted.value));
  await site.stop();
  const store = await createStore({ rootDir, dataDir: site.dataDir });
  // Each pending review needs room for a 2000-character note, including the
  // JSON escape expansion of control characters, plus reviewer metadata.
  const fixture = nearCapacityRequests(submitted.value.request, 14 * 1024);
  await store.updateRequests(() => fixture.requests);
  const filename = path.join(site.dataDir, 'requests.json');
  const before = await readFile(filename);
  const extra = structuredClone(submitted.value.request);
  extra.id = 'capacity-extra-request';
  extra.article.id = 'capacity-extra-article';
  await assert.rejects(store.updateRequests(current => [...current, extra]), error => error.status === 413 && /容量/.test(error.message));
  assert.equal((await readFile(filename)).equals(before), true);
  await site.start();
  const reviewer = await site.login(owner);
  const note = '\u0000'.repeat(2000);
  const reviewed = await site.call(`/api/admin/requests/${fixture.requests[0].id}/review`, { method: 'POST', actor: reviewer, body: { decision: 'approve', note } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value));
  assert.equal(reviewed.value.request.note, note);
  assert.equal((await site.call('/api/articles')).value.articles.filter(item => item.id === fixture.requests[0].article.id).length, 1);
  assert.ok((await readFile(filename)).length <= fixture.limit);
});

// A persisted queue that already used future review capacity cannot be
// accepted merely because its current serialization fits below 32 MiB.
test('refuses to load a queue that leaves insufficient space to review its pending requests', async t => {
  const site = await installation(t);
  const { admin } = await site.provision();
  const submitted = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article });
  assert.equal(submitted.status, 202, JSON.stringify(submitted.value));
  await site.stop();
  const fixture = nearCapacityRequests(submitted.value.request, 0);
  assert.ok(Buffer.byteLength(fixture.encoded) < fixture.limit);
  const filename = path.join(site.dataDir, 'requests.json');
  await writeFile(filename, fixture.encoded);
  await assert.rejects(createPortalServer({ rootDir, dataDir: site.dataDir, deploymentDir: path.join(site.dataDir, 'temporary-deployment') }), /容量/);
  assert.equal(await readFile(filename, 'utf8'), fixture.encoded);
});
