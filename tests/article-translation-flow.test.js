import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortalServer } from '../server.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const languages = ['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'];
const original = { title: '自动翻译通知', category: '通知公告', date: '2050-10-11', summary: '通知摘要', body: ['第一段完整通知。', '第二段完整通知。'], source: '办公室', status: 'published', autoTranslate: true };
const ownerCredentials = { username: 'translation_owner', password: 'owner-password-2050' };
const editorCredentials = { username: 'translation_editor', password: 'editor-password-2050' };
const seniorCredentials = { username: 'translation_senior', password: 'senior-password-2050' };

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

function translated(language, article) {
  return { title: `${language}: ${article.title}`, summary: `${language}: ${article.summary}`, source: `${language}: ${article.source}`, body: article.body.map(value => `${language}: ${value}`) };
}

function engineFixture({ available = true, run, gates = [] } = {}) {
  const calls = [];
  return {
    calls,
    available: async () => available,
    async translate(article, onTranslation) {
      calls.push(structuredClone(article));
      if (run) return run(article, onTranslation);
      for (const language of languages) await onTranslation(language, translated(language, article));
    },
    close() { gates.forEach(item => item.release()); }
  };
}

async function eventually(read, accept, description) {
  const started = performance.now();
  let value;
  while (performance.now() - started < 4000) {
    value = await read();
    if (accept(value)) return value;
    await delay(15);
  }
  assert.fail(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

async function installation(t, engine) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-translation-flow-'));
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  let clock = Date.parse('2050-10-11T04:00:00Z');
  let server, base, owner;
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment'), now: () => clock, schedulerIntervalMs: 20, translationEngine: engine });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    engine?.close();
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  await start();
  async function call(route, { method = 'GET', body, actor } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json(), response };
  }
  async function login(credentials, setup = false) {
    const result = await call(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials });
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.value));
    return { cookie: result.response.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken };
  }
  owner = await login(ownerCredentials, true);
  async function addActor(credentials, role) {
    const result = await call('/api/admin/users', { method: 'POST', actor: owner, body: { ...credentials, role } });
    assert.equal(result.status, 201, JSON.stringify(result.value));
    return login(credentials);
  }
  const publicArticle = async id => (await call('/api/articles')).value.articles.find(article => article.id === id);
  const complete = id => eventually(() => publicArticle(id), article => article?.translation?.status === 'completed', 'completed persisted translations');
  return { call, owner, addActor, publicArticle, complete, dataDir, advance: value => { clock = value; }, restart: async () => { await stop(); await start(); } };
}

// Omitting the publication trigger or dropping validated locale data must fail.
test('publishing automatically stores every translated locale and retains the original through restart', async t => {
  const engine = engineFixture();
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const article = await site.complete(result.value.article.id);
  assert.equal(article.title, '自动翻译通知');
  assert.deepEqual(article.body, ['第一段完整通知。', '第二段完整通知。']);
  assert.deepEqual(Object.keys(article.translation.locales).sort(), [...languages].sort());
  assert.deepEqual(article.translation.locales.en, { title: 'en: 自动翻译通知', summary: 'en: 通知摘要', source: 'en: 办公室', body: ['en: 第一段完整通知。', 'en: 第二段完整通知。'] });
  assert.match(article.translation.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(article.translation.updatedAt)));
  await site.restart();
  const persisted = await site.publicArticle(article.id);
  assert.deepEqual(persisted.translation, article.translation);
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  assert.deepEqual(stored.articles[0].translation, article.translation);
});

// Translating submissions or plans before their publication leaks private text.
test('drafts pending approvals and future schedules remain untranslated until public publication', async t => {
  const engine = engineFixture();
  const site = await installation(t, engine);
  const editor = await site.addActor(editorCredentials, 'admin');
  const draft = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: { ...original, title: '未公开工作草稿', status: 'draft' } });
  assert.equal(draft.status, 201);
  const request = await site.call('/api/admin/articles', { method: 'POST', actor: editor, body: { ...original, title: '等待审批的通知' } });
  assert.equal(request.status, 202);
  const planned = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: { ...original, title: '等待时间的通知', status: 'scheduled', scheduledAt: '2050-10-11T05:00:00Z' } });
  assert.equal(planned.status, 201);
  await delay(100);
  assert.deepEqual(engine.calls, []);
  assert.deepEqual((await site.call('/api/articles')).value.articles, []);
  const reviewed = await site.call(`/api/admin/requests/${request.value.request.id}/review`, { method: 'POST', actor: site.owner, body: { decision: 'approve' } });
  assert.equal(reviewed.status, 200);
  await site.complete(request.value.request.article.id);
  assert.deepEqual(engine.calls.map(article => article.title), ['等待审批的通知']);
  site.advance(Date.parse('2050-10-11T05:00:00Z'));
  await site.complete(planned.value.article.id);
  assert.deepEqual(engine.calls.map(article => article.title), ['等待审批的通知', '等待时间的通知']);
  assert.equal(await site.publicArticle(draft.value.article.id), undefined);
});

// Applying an old engine result after a source edit must never expose stale text.
test('editing source while a translation runs discards its stale result and translates the new source', async t => {
  const old = gate(), current = gate();
  const engine = engineFixture({ gates: [old, current], async run(article, onTranslation) {
    await (article.title === original.title ? old : current).promise;
    for (const language of languages) await onTranslation(language, translated(language, article));
  } });
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const id = result.value.article.id;
  await eventually(() => engine.calls.length, count => count === 1, 'the original translation to start');
  const edit = await site.call(`/api/admin/articles/${id}`, { method: 'PUT', actor: site.owner, body: { ...original, title: '编辑后的新通知', body: ['仅允许这份新正文的译文。'] } });
  assert.equal(edit.status, 200);
  old.release();
  await eventually(() => engine.calls.length, count => count === 2, 'translation of the edited source');
  const during = await site.publicArticle(id);
  assert.equal(during.title, '编辑后的新通知');
  assert.notEqual(during.translation?.locales?.en?.title, 'en: 自动翻译通知');
  current.release();
  const article = await site.complete(id);
  assert.equal(article.translation.locales.en.title, 'en: 编辑后的新通知');
  assert.deepEqual(article.translation.locales.en.body, ['en: 仅允许这份新正文的译文。']);
});

// Updating translation metadata must not invalidate a previously requested deletion.
test('ordinary deletion approval stays valid when background translation completes', async t => {
  const held = gate();
  const engine = engineFixture({ gates: [held], async run(article, onTranslation) {
    await held.promise;
    for (const language of languages) await onTranslation(language, translated(language, article));
  } });
  const site = await installation(t, engine);
  const editor = await site.addActor(editorCredentials, 'admin');
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const deletion = await site.call(`/api/admin/articles/${result.value.article.id}`, { method: 'DELETE', actor: editor, body: {} });
  assert.equal(deletion.status, 202);
  held.release();
  await site.complete(result.value.article.id);
  const approval = await site.call(`/api/admin/requests/${deletion.value.request.id}/review`, { method: 'POST', actor: site.owner, body: { decision: 'approve' } });
  assert.equal(approval.status, 200, JSON.stringify(approval.value));
  assert.equal(await site.publicArticle(result.value.article.id), undefined);
});

// Retry is a management write; allowing it to an ordinary admin bypasses review.
test('all signed-in roles can inspect engine availability but only a manager can translate an existing article', async t => {
  const site = await installation(t, engineFixture());
  const editor = await site.addActor(editorCredentials, 'admin');
  const senior = await site.addActor(seniorCredentials, 'senioradmin');
  assert.equal((await site.call('/api/admin/translation')).status, 401);
  for (const actor of [site.owner, editor, senior]) {
    const availability = await site.call('/api/admin/translation', { actor });
    assert.equal(availability.status, 200);
    assert.equal(availability.value.available, true);
  }
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: { ...original, autoTranslate: false } });
  assert.equal(result.status, 201);
  const route = `/api/admin/articles/${result.value.article.id}/translate`;
  assert.equal((await site.call(route, { method: 'POST', actor: editor, body: {} })).status, 403);
  assert.equal((await site.call(route, { method: 'POST', actor: senior, body: {} })).status, 202);
  const article = await site.complete(result.value.article.id);
  assert.equal(article.autoTranslate, true);
  const draft = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: { ...original, status: 'draft' } });
  const draftRetry = await site.call(`/api/admin/articles/${draft.value.article.id}/translate`, { method: 'POST', actor: site.owner, body: {} });
  assert.ok([400, 409].includes(draftRetry.status));
});

// Missing model files must not turn a valid source publication into a failure.
test('an unavailable translation engine leaves the original published and responsive', async t => {
  const engine = engineFixture({ available: false });
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  assert.equal((await site.call('/api/admin/translation', { actor: site.owner })).value.available, false);
  await delay(80);
  const article = await site.publicArticle(result.value.article.id);
  assert.equal(article.title, '自动翻译通知');
  assert.deepEqual(article.body, ['第一段完整通知。', '第二段完整通知。']);
  assert.deepEqual(article.translation?.locales || {}, {});
  assert.deepEqual(engine.calls, []);
});

// A failed language must preserve successful locales and permit manager retry.
test('a partial engine failure retains valid locales and a retry completes the remaining translation', async t => {
  let fail = true;
  const engine = engineFixture({ async run(article, onTranslation) {
    await onTranslation('en', translated('en', article));
    if (fail) throw new Error('offline model translation failed');
    for (const language of languages.filter(code => code !== 'en')) await onTranslation(language, translated(language, article));
  } });
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const article = await eventually(() => site.publicArticle(result.value.article.id), item => item?.translation?.status === 'failed', 'partial translation failure to persist');
  assert.equal(article.translation.locales.en.title, 'en: 自动翻译通知');
  assert.equal(article.title, '自动翻译通知');
  fail = false;
  const retry = await site.call(`/api/admin/articles/${article.id}/translate`, { method: 'POST', actor: site.owner, body: {} });
  assert.equal(retry.status, 202);
  const completed = await site.complete(article.id);
  assert.deepEqual(Object.keys(completed.translation.locales).sort(), [...languages].sort());
});

// Delayed callbacks after removal must neither resurrect content nor lose deletion.
test('deleting an article during translation prevents late results from restoring it', async t => {
  const held = gate();
  let returned = false;
  const engine = engineFixture({ gates: [held], async run(article, onTranslation) {
    await held.promise;
    try { for (const language of languages) await onTranslation(language, translated(language, article)); }
    finally { returned = true; }
  } });
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  await eventually(() => engine.calls.length, count => count === 1, 'translation to start before deletion');
  const deletion = await site.call(`/api/admin/articles/${result.value.article.id}`, { method: 'DELETE', actor: site.owner, body: {} });
  assert.equal(deletion.status, 200);
  held.release();
  await eventually(() => returned, value => value, 'late callbacks after deletion to finish');
  assert.equal(await site.publicArticle(result.value.article.id), undefined);
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  assert.deepEqual(stored.articles, []);
});

// Reusing a prior attempted fingerprint must not suppress an explicit re-enable.
test('re-enabling automatic translation on unchanged published text generates its removed translations again', async t => {
  const engine = engineFixture();
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const id = result.value.article.id;
  await site.complete(id);
  const disabled = await site.call(`/api/admin/articles/${id}`, { method: 'PUT', actor: site.owner, body: { ...original, autoTranslate: false } });
  assert.equal(disabled.status, 200);
  assert.equal((await site.publicArticle(id)).translation, undefined);
  const enabled = await site.call(`/api/admin/articles/${id}`, { method: 'PUT', actor: site.owner, body: original });
  assert.equal(enabled.status, 200);
  const article = await site.complete(id);
  assert.equal(article.translation.locales.en.title, 'en: 自动翻译通知');
  assert.equal(engine.calls.length, 2);
});

// Restoring source-only content is new work even if this process translated it before.
test('restoring an unchanged article without its translations schedules those translations again', async t => {
  const engine = engineFixture();
  const site = await installation(t, engine);
  const result = await site.call('/api/admin/articles', { method: 'POST', actor: site.owner, body: original });
  assert.equal(result.status, 201);
  const article = await site.complete(result.value.article.id);
  const { translation, ...sourceOnly } = article;
  const restored = await site.call('/api/admin/import', { method: 'POST', actor: site.owner, body: { version: 1, articles: [sourceOnly] } });
  assert.equal(restored.status, 200);
  const regenerated = await site.complete(article.id);
  assert.equal(regenerated.translation.locales.en.title, 'en: 自动翻译通知');
  assert.equal(engine.calls.length, 2);
});
