import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortalServer } from '../server.mjs';
const rootDir = fileURLToPath(new URL('../', import.meta.url));
const owner = { username: 'schedule_owner', password: 'schedule-owner-password' };
const editor = { username: 'schedule_editor', password: 'schedule-editor-password' };
const article = { title: '定时发布联合政府通知', category: '通知公告', date: '2050-10-11', summary: '', body: ['定时文章完整正文。'], source: '办公室', status: 'scheduled', scheduledAt: '2050-10-11T13:00:00+08:00' };
const feedback = { type: 'suggestion', gameName: 'SchedulePlayer', qq: '765432109876', title: '网站使用意见', content: '希望网站提供更多便民信息。' };
async function installation(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-scheduling-'));
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  let currentTime = Date.parse('2050-10-11T04:00:00Z'); let server, base;
  async function start() { server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment'), now: () => currentTime, schedulerIntervalMs: options.schedulerIntervalMs ?? 1000 }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  await start(); t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function call(route, { method = 'GET', body, actor, headers = {} } = {}) { const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, value: await response.json(), response }; }
  async function login(credentials, setup = false) { const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials }); assert.ok([200, 201].includes(result.status), JSON.stringify(result.value)); return { ...result.value, cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken }; }
  async function provision() { const superadmin = await login(owner, true); assert.equal((await call('/api/admin/users', { method: 'POST', body: editor, actor: superadmin })).status, 201); return { superadmin, admin: await login(editor) }; }
  return { dataDir, call, login, provision, start, stop, restart: async () => { await stop(); await start(); }, advance: value => { currentTime = Date.parse(value); } };
}

test('publishes a scheduled article exactly once at its deadline and records the automatic operation', async t => {
  const site = await installation(t); const { superadmin } = await site.provision();
  const created = await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: article }); assert.equal(created.status, 201); const id = created.value.article.id;
  assert.equal((await site.call('/api/articles')).value.articles.length, 0);
  site.advance('2050-10-11T05:00:00Z');
  const publicCalls = await Promise.all([1, 2, 3].map(() => site.call('/api/articles')));
  assert.ok(publicCalls.every(result => result.value.articles.find(a => a.id === id)?.status === 'published'));
  const logs = (await site.call('/api/admin/logs?action=article.auto_publish', { actor: superadmin })).value;
  assert.equal(logs.total, 1); assert.equal(logs.logs[0].actor.role, 'system'); assert.equal(logs.logs[0].target.id, id);
  await site.restart(); const again = await site.login(owner);
  assert.equal((await site.call('/api/admin/logs?action=article.auto_publish', { actor: again })).value.total, 1);
});

test('never publishes unapproved plans and publishes an overdue plan only when it is approved', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const submit = await site.call('/api/admin/articles', { method: 'POST', actor: admin, body: article }); assert.equal(submit.status, 202);
  site.advance('2050-10-11T06:00:00Z'); assert.equal((await site.call('/api/articles')).value.articles.length, 0);
  const approved = await site.call(`/api/admin/requests/${submit.value.request.id}/review`, { method: 'POST', actor: superadmin, body: { decision: 'approve' } }); assert.equal(approved.status, 200);
  assert.equal((await site.call('/api/articles')).value.articles[0].status, 'published');
});

test('catches up missed schedules on restart and cancellation prevents a later publication', async t => {
  const site = await installation(t); const { superadmin } = await site.provision();
  const created = await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: article });
  const canceled = await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: { ...article, title: '取消的定时通知' } });
  assert.equal((await site.call(`/api/admin/articles/${canceled.value.article.id}`, { method: 'PUT', actor: superadmin, body: { ...article, status: 'draft', scheduledAt: null } })).status, 200);
  await site.stop(); site.advance('2050-10-11T06:00:00Z'); await site.start();
  const visible = (await site.call('/api/articles')).value.articles;
  assert.deepEqual(visible.map(a => a.id), [created.value.article.id]);
});

test('rejects past live plans and records failure without creating an article', async t => {
  const site = await installation(t); const { superadmin } = await site.provision();
  assert.equal((await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: { ...article, scheduledAt: '2050-10-11T03:00:00Z' } })).status, 400);
  assert.equal((await site.call('/api/admin/articles', { actor: superadmin })).value.articles.length, 0);
  const logs = (await site.call('/api/admin/logs?result=failure', { actor: superadmin })).value.logs;
  assert.ok(logs.some(log => log.action === 'article.create' && log.actor.username === owner.username && log.result === 'failure'));
});

test('operation logs are superadmin-only, filterable and do not include secrets', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  assert.equal((await site.call('/api/admin/logs')).status, 401);
  assert.equal((await site.call('/api/admin/logs', { actor: admin })).status, 403);
  await site.call('/api/admin/password', { method: 'PUT', actor: admin, body: { currentPassword: editor.password, newPassword: 'replacement-secret-password' } });
  const page = (await site.call('/api/admin/logs?page=1&pageSize=2', { actor: superadmin })).value;
  assert.equal(page.logs.length, 2); assert.ok(page.total > 2); assert.equal(page.pageSize, 2);
  const changed = (await site.call('/api/admin/logs?action=account.password&search=schedule_editor', { actor: superadmin })).value;
  assert.equal(changed.total, 1); assert.equal(changed.logs[0].result, 'success');
  const contents = await readFile(path.join(site.dataDir, 'logs.json'), 'utf8');
  for (const secret of [owner.password, editor.password, 'replacement-secret-password', admin.csrfToken, superadmin.csrfToken]) assert.equal(contents.includes(secret), false);
  assert.equal((await site.call('/data/logs.json')).status, 404);
  assert.equal((await site.call('/api/admin/logs?page=-1', { actor: superadmin })).status, 400);
});

test('successful article changes and audit entries survive a interrupted projection as one transaction', async t => {
  const site = await installation(t); const { superadmin } = await site.provision();
  const logsFile = path.join(site.dataDir, 'logs.json'); await rm(logsFile); await mkdir(logsFile);
  const created = await site.call('/api/admin/articles', { method: 'POST', actor: superadmin, body: { ...article, status: 'published', scheduledAt: null } });
  assert.equal(created.status, 201);
  const journal = JSON.parse(await readFile(path.join(site.dataDir, 'content-transaction.json'), 'utf8'));
  assert.equal(journal.version, 3); assert.ok(journal.logs.some(log => log.target.id === created.value.article.id && log.action === 'article.create'));
  await rm(logsFile, { recursive: true }); await site.restart(); const again = await site.login(owner);
  assert.equal((await site.call('/api/articles')).value.articles.length, 1);
  assert.equal((await site.call('/api/admin/logs?action=article.create', { actor: again })).value.total, 1);
});

test('visitors submit private feedback and both administrator roles can read and mark it', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const submitted = await site.call('/api/feedback', { method: 'POST', body: { ...feedback, status: 'read', readBy: { id: 'forged' } } }); assert.equal(submitted.status, 201); const id = submitted.value.feedback.id;
  assert.equal(submitted.value.feedback.status, 'new');
  assert.equal((await site.call('/api/feedback')).status, 404);
  assert.equal((await site.call('/api/admin/feedback')).status, 401);
  const list = (await site.call('/api/admin/feedback', { actor: admin })).value; assert.equal(list.total, 1); assert.equal(list.feedback[0].content, feedback.content); assert.equal(list.feedback[0].gameName, feedback.gameName); assert.equal(list.feedback[0].qq, feedback.qq);
  const marked = await site.call(`/api/admin/feedback/${id}`, { method: 'PATCH', actor: admin, body: { status: 'read' } }); assert.equal(marked.status, 200); assert.equal(marked.value.feedback.readBy.username, editor.username);
  assert.equal((await site.call(`/api/admin/feedback/${id}`, { method: 'PATCH', actor: admin, body: { status: 'new' } })).status, 403);
  assert.equal((await site.call(`/api/admin/feedback/${id}`, { method: 'DELETE', actor: admin, body: {} })).status, 403);
  assert.equal((await site.call('/api/admin/feedback?status=new', { actor: superadmin })).value.total, 0);
  await site.restart(); const again = await site.login(editor); assert.equal((await site.call('/api/admin/feedback?search=便民', { actor: again })).value.total, 1);
  assert.equal((await site.call('/data/feedback.json')).status, 404);
});

test('validates and rate limits feedback without publishing or storing rejected content', async t => {
  const site = await installation(t); const { superadmin } = await site.provision();
  assert.equal((await site.call('/api/feedback', { method: 'POST', body: feedback, headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await site.call('/api/feedback', { method: 'POST', body: { ...feedback, content: '短' } })).status, 400);
  const accepted = await site.call('/api/feedback', { method: 'POST', body: { ...feedback, title: '<script>意见</script>' } }); assert.equal(accepted.status, 201);
  let result; for (let index = 0; index < 6; index++) result = await site.call('/api/feedback', { method: 'POST', body: feedback });
  assert.equal(result.status, 429);
  assert.equal((await site.call('/api/articles')).value.articles.length, 0);
  const logs = (await site.call('/api/admin/logs?action=feedback.submit&result=success', { actor: superadmin })).value.logs;
  assert.ok(logs.length >= 1); assert.equal(JSON.stringify(logs).includes(feedback.content), false); assert.equal(JSON.stringify(logs).includes(feedback.qq), false);
});

test('a concurrent password reset invalidates an old-password login even when it waits for audit storage', async t => {
  const site = await installation(t); const { superadmin, admin } = await site.provision();
  const [login, reset] = await Promise.all([
    site.call('/api/admin/login', { method: 'POST', body: editor }),
    site.call(`/api/admin/users/${admin.userId}`, { method: 'PUT', actor: superadmin, body: { newPassword: 'changed-by-owner-password' } })
  ]);
  assert.equal(reset.status, 200);
  if (login.status === 200) {
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await site.call('/api/admin/session', { headers: { Cookie: cookie } })).value.authenticated, false);
  } else assert.equal(login.status, 401);
});
