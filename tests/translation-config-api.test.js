import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPortalServer } from '../server.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const config = { provider: 'llm', endpoint: 'https://model.example/v1/chat/completions', model: 'test-model', apiKey: 'api-private-test-key', fallback: false };
async function installation(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-config-'));
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  let server, base, fail = false;
  const sent = [];
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, schedulerIntervalMs: 100000, translationFetch: async (url, init) => {
      if (fail) throw new Error('api-private-test-key upstream failure with private body');
      if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'test-model' }, { id: 'backup-model' }] }) };
      const request = JSON.parse(init.body); sent.push({ url, request, init });
      const input = JSON.parse(request.messages[1].content);
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: input.texts.map(value => 'translated: ' + value) }) } }] }) };
    } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  await start();
  async function call(route, actor, method = 'GET', data) {
    const response = await fetch(base + route, { method, headers: { ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, value: await response.json(), response };
  }
  async function login(username, setup = false) {
    const result = await call('/api/admin/' + (setup ? 'setup' : 'login'), null, 'POST', { username, password: 'very-safe-password-123' });
    assert.ok([200, 201].includes(result.status));
    return { cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken };
  }
  const owner = await login('owner', true);
  async function actor(role) {
    const username = role + '-user';
    assert.equal((await call('/api/admin/users', owner, 'POST', { username, password: 'very-safe-password-123', role })).status, 201);
    return login(username);
  }
  return { call, owner, actor, dataDir, sent, fail: () => { fail = true; }, restart: async () => { await stop(); await start(); return login('owner'); } };
}
test('only managers configure or test translation; keys stay private through restart and logs', async t => {
  const site = await installation(t);
  const ordinary = await site.actor('admin'), senior = await site.actor('senioradmin');
  const route = '/api/admin/translation/settings';
  assert.equal((await site.call(route)).status, 401);
  for (const [url, method, data] of [[route, 'GET'], [route, 'PUT', config], ['/api/admin/translation/test', 'POST', {}], ['/api/admin/translation/discover', 'POST', {}]]) {
    assert.equal((await site.call(url, ordinary, method, data)).status, 403);
  }
  assert.equal((await site.call(route, { cookie: site.owner.cookie, token: 'wrong' }, 'PUT', config)).status, 403);
  const saved = await site.call(route, senior, 'PUT', config);
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.equal(saved.value.settings.hasApiKey, true);
  assert.ok(!JSON.stringify(saved.value).includes(config.apiKey));
  const state = await site.call('/api/admin/translation', ordinary);
  assert.equal(state.value.onlineProvider, 'llm');
  assert.equal(state.value.offlineAvailable, false);
  assert.ok(!JSON.stringify(state.value).includes(config.apiKey));
  assert.equal((await site.call('/data/translation-settings.json')).status, 404);
  const tested = await site.call('/api/admin/translation/test', senior, 'POST', {});
  assert.equal(tested.status, 200);
  assert.equal(site.sent.length, 1);
  assert.match(site.sent[0].request.messages[1].content, /连接测试/);
  assert.ok(!JSON.stringify(tested.value).includes(config.apiKey));
  const discovered = await site.call('/api/admin/translation/discover', senior, 'POST', {});
  assert.equal(discovered.status, 200, JSON.stringify(discovered.value));
  assert.deepEqual(discovered.value.models, ['test-model', 'backup-model']);
  assert.equal(discovered.value.selectedModel, 'test-model');
  assert.ok(!JSON.stringify(discovered.value).includes(config.apiKey));
  assert.equal((await site.call('/api/admin/translation/test', site.owner, 'POST', { text: '私人文章' })).status, 400);
  const blank = await site.call(route, site.owner, 'PUT', { ...config, apiKey: '', model: 'changed-model' });
  assert.equal(blank.status, 200);
  assert.equal(JSON.parse(await readFile(path.join(site.dataDir, 'translation-settings.json'), 'utf8')).apiKey, config.apiKey);
  const owner = await site.restart();
  const after = await site.call(route, owner);
  assert.equal(after.value.settings.model, 'changed-model');
  assert.equal(after.value.settings.hasApiKey, true);
  site.fail();
  const failed = await site.call('/api/admin/translation/test', owner, 'POST', {});
  assert.equal(failed.status, 502);
  const logs = await site.call('/api/admin/logs', owner);
  assert.ok(logs.value.logs.some(item => item.action === 'translation.configure'));
  assert.ok(logs.value.logs.some(item => item.action === 'translation.test' && item.result === 'failure'));
  assert.ok(logs.value.logs.some(item => item.action === 'translation.discover'));
  for (const output of [after.value, failed.value, logs.value, (await site.call('/api/admin/export', owner)).value]) assert.ok(!JSON.stringify(output).includes(config.apiKey));
  assert.equal((await site.call(route, owner, 'PUT', { ...config, apiKey: '', clearApiKey: true })).status, 200);
  assert.equal((await site.call('/api/admin/translation', owner)).value.onlineAvailable, false);
});
test('saved LLM configuration is used for all eleven publication translations without restart', async t => {
  const site = await installation(t);
  assert.equal((await site.call('/api/admin/translation/settings', site.owner, 'PUT', config)).status, 200);
  const created = await site.call('/api/admin/articles', site.owner, 'POST', { title: '新的公告', summary: '摘要', source: '晏阳联合政府', body: ['公开的通知正文。'], category: '通知公告', date: '2026-10-19', status: 'published', autoTranslate: true });
  assert.equal(created.status, 201);
  let published;
  for (let i = 0; i < 120; i++) {
    published = (await site.call('/api/articles')).value.articles[0];
    if (published?.translation?.status === 'completed') break;
    await delay(25);
  }
  assert.equal(published.translation?.status, 'completed');
  assert.equal(Object.keys(published.translation.locales).length, 11);
  assert.equal(site.sent.length, 11);
  assert.ok(site.sent.every(item => item.init.headers.Authorization === 'Bearer ' + config.apiKey && item.request.model === config.model));
});
