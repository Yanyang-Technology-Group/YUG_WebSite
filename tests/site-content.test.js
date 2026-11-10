import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const account = { username: 'content_admin', password: 'content-password-2026' };
const legacyPhotoValues = {
  'slides.0.alt': '湖畔柳树、绿色山林与古塔组成的山水风景',
  'slides.0.kicker': '山水之城 · 幸福之城',
  'slides.0.title': '一城山水满目新　宜居晏阳向未来',
  'slides.1.alt': '湖水、绿树与城市天际线相映的城市风光',
  'slides.1.kicker': '品质之城 · 宜居之城',
  'slides.1.title': '推窗见绿出门见景　共建美好家园',
  'slides.2.alt': '灯火辉映的滨江城市夜景',
  'slides.2.kicker': '活力之城 · 创新之城',
  'slides.2.title': '灯火映江城　点亮高质量发展新图景',
  'footer.attribution': '图片：Bjoertvedt、Yinweichen（CC BY-SA 4.0），DvTor8303（CC0）；经缩放处理'
};

async function installation(t, { siteContent } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-content-test-'));
  if (siteContent) await writeFile(path.join(dataDir, 'site-content.json'), JSON.stringify(siteContent), 'utf8');
  const { createPortalServer } = await import('../server.mjs');
  let server;
  let base;
  let cookie = '';
  let token = '';
  async function start() {
    server = await createPortalServer({ rootDir, dataDir });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  await start();
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(auth && cookie ? { Cookie: cookie } : {}), ...(auth && token ? { 'X-CSRF-Token': token } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, response, value: await response.json() };
  }
  function authenticate(result) {
    assert.ok(result.status === 200 || result.status === 201, JSON.stringify(result.value));
    cookie = result.response.headers.get('set-cookie').split(';')[0];
    token = result.value.csrfToken;
  }
  return {
    request, dataDir,
    setup: async () => authenticate(await request('/api/admin/setup', { method: 'POST', body: account })),
    login: async () => authenticate(await request('/api/admin/login', { method: 'POST', body: account })),
    restart: async () => { await stop(); cookie = ''; token = ''; await start(); }
  };
}

test('exposes default site text publicly but protects administrative writes and persists edits', async t => {
  const site = await installation(t);
  const initial = await site.request('/api/site-content');
  assert.equal(initial.status, 200);
  assert.equal(initial.value.content.version, 1);
  assert.ok(Object.values(initial.value.content.values).some(value => value.includes('晏阳联合政府')));
  assert.equal((await site.request('/api/admin/site-content')).status, 401);
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: initial.value.content })).status, 401);
  await site.setup();
  const keys = Object.keys(initial.value.content.values);
  const updated = structuredClone(initial.value.content);
  updated.values[keys[0]] = '晏阳联合政府自定义名称';
  updated.values[keys[1]] = '';
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: updated, headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: updated, headers: { Origin: 'https://invalid.example' } })).status, 403);
  const saved = await site.request('/api/admin/site-content', { method: 'PUT', body: updated });
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.deepEqual(saved.value.content, updated);
  assert.deepEqual((await site.request('/api/site-content')).value.content, updated);
  await site.restart();
  assert.deepEqual((await site.request('/api/site-content')).value.content, updated);
  await site.login();
  assert.deepEqual((await site.request('/api/admin/site-content')).value.content, updated);
});

test('migrates legacy photo defaults into the current captions and persists later edits across restart', async t => {
  const { defaultSiteContent } = await import('../public/site-content-schema.js');
  const site = await installation(t, { siteContent: { version: 1, values: legacyPhotoValues } });
  const migrated = (await site.request('/api/site-content')).value.content;
  for (const [key, oldValue] of Object.entries(legacyPhotoValues)) {
    assert.notEqual(defaultSiteContent.values[key], oldValue, `${key} has a replacement photo default`);
    assert.equal(migrated.values[key], defaultSiteContent.values[key], `${key} migrates the exact legacy default`);
  }
  assert.deepEqual(migrated, defaultSiteContent, 'an old partial snapshot receives all new schema defaults');
  assert.deepEqual(JSON.parse(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8')), migrated, 'migrated captions are written to the isolated installation');
  await site.restart();
  assert.deepEqual((await site.request('/api/site-content')).value.content, migrated);
  await site.setup();
  const edited = structuredClone(migrated);
  edited.values['slides.0.title'] = '管理员保存的建筑照片标题';
  edited.values['slides.1.kicker'] = '';
  const saved = await site.request('/api/admin/site-content', { method: 'PUT', body: edited });
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  await site.restart();
  assert.deepEqual((await site.request('/api/site-content')).value.content, edited);
});

test('preserves customized photo captions including empty values when opening an existing installation', async t => {
  for (const [name, customValue] of [['similar text', oldValue => `${oldValue}（自定义）`], ['empty text', () => '']]) {
    await t.test(name, async t => {
      const custom = Object.fromEntries(Object.entries(legacyPhotoValues).map(([key, oldValue]) => [key, customValue(oldValue)]));
      const site = await installation(t, { siteContent: { version: 1, values: custom } });
      const content = (await site.request('/api/site-content')).value.content;
      for (const [key, value] of Object.entries(custom)) assert.equal(content.values[key], value, key);
      await site.restart();
      assert.deepEqual((await site.request('/api/site-content')).value.content, content);
      const stored = JSON.parse(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'));
      for (const [key, value] of Object.entries(custom)) assert.equal(stored.values[key], value, `${key} remains unchanged on disk`);
    });
  }
});

test('migrates only matching photo fields within a mixed legacy and customized snapshot', async t => {
  const { defaultSiteContent } = await import('../public/site-content-schema.js');
  const values = {
    ...legacyPhotoValues,
    'slides.0.alt': '',
    'slides.1.title': `${legacyPhotoValues['slides.1.title']}（自定义）`,
    'footer.attribution': '图片由建筑作者提供'
  };
  const site = await installation(t, { siteContent: { version: 1, values } });
  const content = (await site.request('/api/site-content')).value.content;
  assert.equal(content.values['slides.0.alt'], '');
  assert.equal(content.values['slides.1.title'], values['slides.1.title']);
  assert.equal(content.values['footer.attribution'], '图片由建筑作者提供');
  for (const key of ['slides.0.kicker', 'slides.0.title', 'slides.1.alt', 'slides.1.kicker', 'slides.2.alt', 'slides.2.kicker', 'slides.2.title']) {
    assert.equal(content.values[key], defaultSiteContent.values[key], `${key} migrates independently of custom fields`);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8')), content);
});

test('rejects invalid configuration without writing and keeps markup and URLs as plain text', async t => {
  const site = await installation(t);
  await site.setup();
  const initial = (await site.request('/api/site-content')).value.content;
  assert.ok(initial);
  const key = Object.keys(initial.values)[0];
  const before = await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8');
  for (const invalid of [
    { version: 2, values: {} },
    { version: 1, values: [] },
    { version: 1, values: { unexpected_content_key: 'text' } },
    { version: 1, values: { [key]: 123 } },
    { version: 1, values: { [key]: '字'.repeat(100000) } },
    JSON.parse('{"version":1,"values":{"__proto__":"bad"}}')
  ]) {
    const result = await site.request('/api/admin/site-content', { method: 'PUT', body: invalid });
    assert.ok([400, 413].includes(result.status), JSON.stringify(result.value));
    assert.equal(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'), before);
  }
  const literal = '<script>alert(1)</script> https://example.com';
  const saved = await site.request('/api/admin/site-content', { method: 'PUT', body: { version: 1, values: { [key]: literal } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.equal(saved.value.content.values[key], literal);
  assert.equal(Object.keys(saved.value.content.values).length, Object.keys(initial.values).length, 'new schema defaults are merged into incomplete snapshots');
  assert.equal((await site.request('/api/site-content')).value.content.values[key], literal);
});

test('exports and restores site text with articles while old backups preserve the current site text', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = (await site.request('/api/admin/export')).value;
  assert.equal(backup.version, 1);
  assert.equal(backup.siteContent.version, 1);
  const key = Object.keys(backup.siteContent.values)[0];
  const changed = { version: 1, values: { [key]: '恢复前的管理员自定义名称' } };
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: changed })).status, 200);
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: { version: 1, articles: backup.articles.slice(0, 1) } })).status, 200);
  assert.equal((await site.request('/api/site-content')).value.content.values[key], changed.values[key]);
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
  assert.equal((await site.request('/api/admin/import', { method: 'POST', body: backup })).status, 200);
  assert.deepEqual((await site.request('/api/site-content')).value.content, backup.siteContent);
  assert.equal((await site.request('/api/articles')).value.articles.length, backup.articles.length);
  await site.restart();
  assert.deepEqual((await site.request('/api/site-content')).value.content, backup.siteContent);
  assert.equal((await site.request('/api/articles')).value.articles.length, backup.articles.length);
});

test('returns a readable 413 response for a site configuration request exceeding the transport limit', async t => {
  const site = await installation(t);
  await site.setup();
  const content = (await site.request('/api/site-content')).value.content;
  const key = Object.keys(content.values)[0];
  const oversized = await site.request('/api/admin/site-content', { method: 'PUT', body: { version: 1, values: { [key]: '字'.repeat(1024 * 1024) } } });
  assert.equal(oversized.status, 413);
  assert.match(oversized.value.message, /2 MiB/);
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: content })).status, 200);
  assert.deepEqual((await site.request('/api/site-content')).value.content, content);
});

test('validates both restore sections before committing either section', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = (await site.request('/api/admin/export')).value;
  assert.ok(backup.siteContent);
  const key = Object.keys(backup.siteContent.values)[0];
  const articlesBefore = await readFile(path.join(site.dataDir, 'articles.json'), 'utf8');
  const contentBefore = await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8');
  const badContent = await site.request('/api/admin/import', { method: 'POST', body: { ...backup, articles: backup.articles.slice(0, 1), siteContent: { version: 1, values: { nonexistent: 'bad' } } } });
  assert.equal(badContent.status, 400);
  const badArticle = await site.request('/api/admin/import', { method: 'POST', body: { ...backup, articles: [{ ...backup.articles[0], title: '' }], siteContent: { version: 1, values: { [key]: '不应保存的修改' } } } });
  assert.equal(badArticle.status, 400);
  assert.equal(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'), articlesBefore);
  assert.equal(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'), contentBefore);
});

test('rejects corrupt stored site content without overwriting it', async t => {
  const site = await installation(t);
  await writeFile(path.join(site.dataDir, 'site-content.json'), '{broken', 'utf8');
  const { createPortalServer } = await import('../server.mjs');
  await assert.rejects(createPortalServer({ rootDir, dataDir: site.dataDir }), /网站内容/);
  assert.equal(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'), '{broken');
});

test('does not replace either snapshot when the joint restore commit cannot be saved', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = (await site.request('/api/admin/export')).value;
  const key = Object.keys(backup.siteContent.values)[0];
  const articlesBefore = await readFile(path.join(site.dataDir, 'articles.json'), 'utf8');
  const contentBefore = await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8');
  await mkdir(path.join(site.dataDir, 'content-transaction.json'));
  const restored = await site.request('/api/admin/import', { method: 'POST', body: { ...backup, articles: backup.articles.slice(0, 1), siteContent: { version: 1, values: { [key]: '不能提交的恢复内容' } } } });
  assert.equal(restored.status, 500);
  assert.equal((await site.request('/api/articles')).value.articles.length, backup.articles.length);
  assert.deepEqual((await site.request('/api/site-content')).value.content, backup.siteContent);
  assert.equal(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'), articlesBefore);
  assert.equal(await readFile(path.join(site.dataDir, 'site-content.json'), 'utf8'), contentBefore);
});

test('replays a committed joint restore on restart before allowing later writes', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = (await site.request('/api/admin/export')).value;
  assert.ok(backup.siteContent);
  const key = Object.keys(backup.siteContent.values)[0];
  const committed = { version: 1, articles: backup.articles.slice(0, 1), siteContent: { version: 1, values: { ...backup.siteContent.values, [key]: '已提交的联合恢复内容' } } };
  await writeFile(path.join(site.dataDir, 'content-transaction.json'), JSON.stringify(committed), 'utf8');
  await writeFile(path.join(site.dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: committed.articles }), 'utf8');
  await site.restart();
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
  assert.equal((await site.request('/api/site-content')).value.content.values[key], committed.siteContent.values[key]);
  await assert.rejects(readFile(path.join(site.dataDir, 'content-transaction.json')), { code: 'ENOENT' });
  await site.login();
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: { version: 1, values: { [key]: '恢复后的后续编辑' } } })).status, 200);
  await site.restart();
  assert.equal((await site.request('/api/site-content')).value.content.values[key], '恢复后的后续编辑');
});

test('keeps a committed restore authoritative and blocks later writes until projections can finish', async t => {
  const site = await installation(t);
  await site.setup();
  const backup = (await site.request('/api/admin/export')).value;
  const key = Object.keys(backup.siteContent.values)[0];
  const nextContent = { version: 1, values: { ...backup.siteContent.values, [key]: '投影失败后仍然完整提交的恢复' } };
  const contentFile = path.join(site.dataDir, 'site-content.json');
  await rm(contentFile);
  await mkdir(contentFile);
  const restored = await site.request('/api/admin/import', { method: 'POST', body: { version: 1, articles: backup.articles.slice(0, 1), siteContent: nextContent } });
  assert.equal(restored.status, 200);
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
  assert.deepEqual((await site.request('/api/site-content')).value.content, nextContent);
  const journalBefore = await readFile(path.join(site.dataDir, 'content-transaction.json'), 'utf8');
  assert.equal((await site.request('/api/admin/site-content', { method: 'PUT', body: backup.siteContent })).status, 500);
  assert.equal((await site.request('/api/admin/articles', { method: 'POST', body: { ...backup.articles[0], title: '不应覆盖未投影恢复的后续文章' } })).status, 500);
  assert.equal(await readFile(path.join(site.dataDir, 'content-transaction.json'), 'utf8'), journalBefore);
  await rm(contentFile, { recursive: true });
  await site.restart();
  assert.equal((await site.request('/api/articles')).value.articles.length, 1);
  assert.deepEqual((await site.request('/api/site-content')).value.content, nextContent);
  await assert.rejects(readFile(path.join(site.dataDir, 'content-transaction.json')), { code: 'ENOENT' });
});

test('renames only marked sample article text when opening an existing installation', async t => {
  const site = await installation(t);
  const stored = JSON.parse(await readFile(path.join(site.dataDir, 'articles.json'), 'utf8'));
  const sample = { ...stored.articles[0], title: '云川市人民政府关于云川市和云川的公告', source: '云川市人民政府', summary: '云川市工作', body: ['云川市人民政府通知。'], isSample: true };
  const custom = { ...sample, id: 'user-custom-article', isSample: false };
  await writeFile(path.join(site.dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [sample, custom] }), 'utf8');
  await site.restart();
  const articles = (await site.request('/api/articles')).value.articles;
  assert.equal(articles.find(article => article.id === sample.id).title, '晏阳联合政府关于晏阳和晏阳的公告');
  assert.equal(articles.find(article => article.id === sample.id).source, '晏阳联合政府');
  assert.equal(articles.find(article => article.id === custom.id).title, custom.title);
  assert.equal(articles.find(article => article.id === custom.id).body[0], custom.body[0]);
});
