import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortalServer } from '../server.mjs';
import { validateStoredFeedback } from '../lib/feedback.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const owner = { username: 'identity_owner', password: 'identity-owner-password' };
const input = { type: 'suggestion', gameName: 'MinePlayer', qq: '765432109876', title: '完善公共服务', content: '建议完善社区公共服务的引导标识。' };
const legacy = { id: 'legacy-feedback_1', type: 'feedback', title: '历史网站意见', content: '历史反馈没有收集游戏名称和联系信息。', createdAt: '2026-10-10T01:00:00.000Z', status: 'new' };

async function installation(t, { feedback = [], start = true } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-feedback-identity-'));
  const feedbackFile = path.join(dataDir, 'feedback.json');
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  await writeFile(feedbackFile, JSON.stringify({ version: 1, feedback }));
  let server, base, actor;
  let clock = Date.parse('2026-10-11T01:30:00.000Z');
  async function begin() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment'), now: () => clock });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  if (start) await begin();
  async function call(route, { method = 'GET', body, authenticated = false } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(authenticated ? actor : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, value: await response.json(), response };
  }
  async function login(setup = false) {
    const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: owner });
    assert.equal(result.status, setup ? 201 : 200, JSON.stringify(result.value));
    actor = { Cookie: result.response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': result.value.csrfToken };
  }
  return { dataDir, feedbackFile, call, login, start: begin, nextWindow: () => { clock += 60000; }, restart: async () => { await stop(); actor = undefined; await begin(); } };
}

// Omitting either identity field from POST validation must fail for every type.
test('all feedback types reject missing identity fields without storing a record', async t => {
  const site = await installation(t);
  await site.login(true);
  for (const type of ['suggestion', 'consultation', 'feedback']) {
    for (const missing of [['gameName'], ['qq'], ['gameName', 'qq']]) {
      const body = { ...input, type };
      for (const field of missing) delete body[field];
      site.nextWindow();
      const result = await site.call('/api/feedback', { method: 'POST', body });
      assert.equal(result.status, 400, `${type}: missing ${missing.join(', ')}`);
    }
  }
  assert.equal((await site.call('/api/admin/feedback', { authenticated: true })).value.total, 0);
  assert.deepEqual(JSON.parse(await readFile(site.feedbackFile, 'utf8')).feedback, []);
});

// Coercing numbers or accepting invalid lengths/digits would create unusable contacts.
test('feedback API rejects invalid game names and QQ strings', async t => {
  const site = await installation(t);
  await site.login(true);
  const cases = [
    ['gameName', ''], ['gameName', '   '], ['gameName', 'x'.repeat(41)],
    ['gameName', 12345], ['gameName', null], ['gameName', {}],
    ['qq', ''], ['qq', '  '], ['qq', '1234'], ['qq', '1234567890123'],
    ['qq', '012345'], ['qq', '12a45'], ['qq', '１２３４５'],
    ['qq', '123 45'], ['qq', '+12345'], ['qq', '12345\n67890'],
    ['qq', 12345], ['qq', null], ['qq', false], ['qq', ['12345']]
  ];
  for (const [field, value] of cases) {
    site.nextWindow();
    const result = await site.call('/api/feedback', { method: 'POST', body: { ...input, [field]: value } });
    assert.equal(result.status, 400, `${field}: ${JSON.stringify(value)}`);
  }
  assert.equal((await site.call('/api/admin/feedback', { authenticated: true })).value.total, 0);
});

// Dropping identity during creation or stored-data validation loses it after restart.
test('accepted feedback trims and persists identity for every type through restart', async t => {
  const site = await installation(t);
  await site.login(true);
  const accepted = [];
  const cases = [
    { type: 'suggestion', gameName: ' M ', qq: ' 12345 ' },
    { type: 'consultation', gameName: ` ${'游'.repeat(40)} `, qq: ' 123456789012 ' },
    { type: 'feedback', gameName: ' MinePlayer ', qq: ' 765432109876 ' }
  ];
  for (const identity of cases) {
    const submitted = await site.call('/api/feedback', { method: 'POST', body: { ...input, ...identity } });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.value));
    assert.equal(submitted.value.feedback.gameName, identity.gameName.trim());
    assert.equal(submitted.value.feedback.qq, identity.qq.trim());
    assert.equal(submitted.value.feedback.type, identity.type);
    accepted.push(submitted.value.feedback);
  }
  assert.deepEqual(JSON.parse(await readFile(site.feedbackFile, 'utf8')).feedback, accepted);
  await site.restart();
  await site.login();
  const listed = await site.call('/api/admin/feedback', { authenticated: true });
  assert.equal(listed.value.total, 3);
  assert.deepEqual(listed.value.feedback, [...accepted].reverse());
});

// Leaving identity out of the search haystack hides matching private feedback.
test('administrator feedback search finds game name and QQ while retaining other filters', async t => {
  const site = await installation(t, { feedback: [legacy] });
  await site.login(true);
  const first = await site.call('/api/feedback', { method: 'POST', body: input });
  const second = await site.call('/api/feedback', { method: 'POST', body: { ...input, gameName: 'OtherPlayer', qq: '987654321' } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  for (const search of ['mineplayer', '76543210']) {
    const listed = await site.call(`/api/admin/feedback?search=${search}`, { authenticated: true });
    assert.equal(listed.value.total, 1, search);
    assert.equal(listed.value.feedback[0].id, first.value.feedback.id);
  }
  const marked = await site.call(`/api/admin/feedback/${first.value.feedback.id}`, { method: 'PATCH', authenticated: true, body: { status: 'read' } });
  assert.equal(marked.status, 200);
  assert.equal((await site.call('/api/admin/feedback?search=mineplayer&status=new', { authenticated: true })).value.total, 0);
  const read = await site.call('/api/admin/feedback?search=76543210&status=read&pageSize=1', { authenticated: true });
  assert.equal(read.value.total, 1);
  assert.equal(read.value.feedback[0].id, first.value.feedback.id);
  const history = await site.call('/api/admin/feedback?search=' + encodeURIComponent('历史网站意见'), { authenticated: true });
  assert.equal(history.value.feedback[0].id, legacy.id);
});

// Enforcing the new POST contract during loading must not erase old records.
test('legacy feedback without either identity field remains readable and processable across restart', async t => {
  const readLegacy = { ...legacy, id: 'legacy-read_2', status: 'read', readBy: { id: 'old-reader_1', username: 'old_reader' }, readAt: '2026-10-10T02:00:00.000Z' };
  const site = await installation(t, { feedback: [legacy, readLegacy] });
  await site.login(true);
  const list = await site.call('/api/admin/feedback', { authenticated: true });
  assert.deepEqual(list.value.feedback, [readLegacy, legacy]);
  assert.equal((await site.call(`/api/admin/feedback/${legacy.id}`, { method: 'PATCH', authenticated: true, body: { status: 'read' } })).status, 200);
  assert.equal((await site.call(`/api/admin/feedback/${legacy.id}`, { method: 'PATCH', authenticated: true, body: { status: 'new' } })).status, 200);
  await site.restart();
  await site.login();
  assert.deepEqual((await site.call('/api/admin/feedback', { authenticated: true })).value.feedback, [readLegacy, legacy]);
});

// Treating a partial or malformed new identity as legacy would hide damaged storage.
test('stored feedback rejects partial or invalid identity instead of dropping it', () => {
  const cases = [
    { gameName: 'MinePlayer' }, { qq: '12345' },
    { gameName: '', qq: '12345' }, { gameName: 'x'.repeat(41), qq: '12345' },
    { gameName: 12345, qq: '12345' }, { gameName: null, qq: '12345' },
    { gameName: 'MinePlayer', qq: '' }, { gameName: 'MinePlayer', qq: '012345' },
    { gameName: 'MinePlayer', qq: 12345 }, { gameName: 'MinePlayer', qq: null },
    { gameName: undefined, qq: undefined }
  ];
  for (const identity of cases) assert.throws(() => validateStoredFeedback([{ ...legacy, ...identity }]), error => error.status === 400, JSON.stringify(identity));
});

for (const identity of [{ gameName: 'MinePlayer' }, { qq: '12345' }, { gameName: 'MinePlayer', qq: 12345 }, { gameName: '', qq: '12345' }]) {
  test(`startup rejects damaged stored identity ${JSON.stringify(identity)} and preserves its original bytes`, async t => {
    const site = await installation(t, { feedback: [{ ...legacy, ...identity }], start: false });
    const original = await readFile(site.feedbackFile, 'utf8');
    await assert.rejects(site.start(), error => error.message.includes('意见反馈'));
    assert.equal(await readFile(site.feedbackFile, 'utf8'), original);
  });
}

// Recording visitor payloads in an audit target or public article response leaks QQ.
test('feedback QQ stays out of operation logs and public responses', async t => {
  const site = await installation(t);
  await site.login(true);
  const submitted = await site.call('/api/feedback', { method: 'POST', body: input });
  assert.equal(submitted.status, 201);
  assert.equal((await site.call('/api/feedback')).status, 404);
  assert.equal((await site.call('/data/feedback.json')).status, 404);
  const publicArticles = await site.call('/api/articles');
  assert.deepEqual(publicArticles.value.articles, []);
  assert.equal(JSON.stringify(publicArticles.value).includes(input.qq), false);
  assert.equal((await site.call(`/api/admin/feedback/${submitted.value.feedback.id}`, { method: 'PATCH', authenticated: true, body: { status: 'read' } })).status, 200);
  const logs = await site.call('/api/admin/logs', { authenticated: true });
  assert.ok(logs.value.logs.some(log => log.action === 'feedback.submit'));
  assert.ok(logs.value.logs.some(log => log.action === 'feedback.read'));
  assert.equal(JSON.stringify(logs.value).includes(input.qq), false);
  assert.equal((await readFile(path.join(site.dataDir, 'logs.json'), 'utf8')).includes(input.qq), false);
});
