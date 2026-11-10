import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortalServer } from '../server.mjs';
import { defaultSiteContent } from '../public/site-content-schema.js';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const beforeDeadline = Date.parse('2050-10-11T04:00:00.000Z');
const deadline = Date.parse('2050-10-11T05:00:00.000Z');
const scheduled = {
  id: 'background-scheduled-1', title: '后台定时通知', category: '通知公告',
  date: '2050-10-11', summary: '', body: ['无需公众页面访问即可自动发布。'],
  source: '办公室', status: 'scheduled', scheduledAt: '2050-10-11T05:00:00.000Z',
  isSample: false, createdAt: '2050-10-11T04:00:00.000Z', updatedAt: '2050-10-11T04:00:00.000Z'
};

async function eventually(predicate, description) {
  const started = performance.now();
  while (performance.now() - started < 2500) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail(`Timed out while waiting for ${description}`);
}

async function installation(t, { articles = [], content = defaultSiteContent } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-background-review-'));
  const file = name => path.join(dataDir, name);
  await writeFile(file('articles.json'), JSON.stringify({ version: 1, articles }));
  await writeFile(file('site-content.json'), JSON.stringify(content));
  await writeFile(file('logs.json'), JSON.stringify({ version: 1, logs: [] }));
  await writeFile(file('feedback.json'), JSON.stringify({ version: 1, feedback: [] }));
  let server;
  let clock = beforeDeadline;
  let clockReads = 0;
  async function start() {
    server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'temporary-deployment'), now: () => { clockReads++; return clock; }, schedulerIntervalMs: 20 });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  return {
    dataDir, file, start, stop, advance: value => { clock = value; }, get clockReads() { return clockReads; },
    read: async name => JSON.parse(await readFile(file(name), 'utf8')),
    raw: name => readFile(file(name), 'utf8')
  };
}

// Removing the interval while retaining the GET catch-up path must fail this test.
// No HTTP request is sent: publication and its audit trail are observed on disk.
test('the background interval publishes a due article and records exactly one automatic operation without a visitor request', async t => {
  const site = await installation(t, { articles: [scheduled] });
  await site.start();
  const initialClockReads = site.clockReads;
  await eventually(() => site.clockReads >= initialClockReads + 2, 'the scheduler to check future plans');
  assert.equal((await site.read('articles.json')).articles[0].status, 'scheduled');
  assert.deepEqual((await site.read('logs.json')).logs, []);

  const readsBeforeDeadline = site.clockReads;
  site.advance(deadline);
  // Wait for background cycles before opening projection files. Repeatedly
  // holding Windows read handles during rename would interfere with persistence.
  await eventually(() => site.clockReads >= readsBeforeDeadline + 5, 'background cycles after the deadline');
  const published = (await site.read('articles.json')).articles;
  assert.equal(published.length, 1);
  assert.equal(published[0].scheduledAt, '2050-10-11T05:00:00.000Z');
  assert.equal(published[0].updatedAt, '2050-10-11T05:00:00.000Z');
  const operations = (await site.read('logs.json')).logs;
  assert.equal(operations.length, 1);
  assert.equal(operations[0].action, 'article.auto_publish');
  assert.equal(operations[0].actor.role, 'system');
  assert.equal(operations[0].target.id, scheduled.id);
  assert.equal(operations[0].result, 'success');

  const readsAfterPublication = site.clockReads;
  await eventually(() => site.clockReads >= readsAfterPublication + 4, 'later scheduler intervals');
  assert.deepEqual((await site.read('articles.json')).articles, published);
  assert.deepEqual((await site.read('logs.json')).logs, operations);
});

// A stored draft may carry an old plan in its input, but its state cancels publication.
test('the background interval leaves a stored draft private after its previous publication deadline', async t => {
  const draft = { ...scheduled, id: 'background-draft-1', status: 'draft' };
  const site = await installation(t, { articles: [draft] });
  await site.start();
  site.advance(deadline + 60000);
  const started = site.clockReads;
  await eventually(() => site.clockReads >= started + 4, 'the scheduler to inspect the due draft');
  assert.equal((await site.read('articles.json')).articles[0].status, 'draft');
  assert.deepEqual((await site.read('logs.json')).logs, []);
});

// Keeping an unreferenced interval alive after server.close would write this plan.
test('server.close stops scheduled checks and prevents publication writes after shutdown', async t => {
  const site = await installation(t, { articles: [scheduled] });
  await site.start();
  const started = site.clockReads;
  await eventually(() => site.clockReads >= started + 2, 'the active scheduler before shutdown');
  await site.stop();
  const clockReadsAtClose = site.clockReads;
  const articlesAtClose = await site.raw('articles.json');
  const logsAtClose = await site.raw('logs.json');
  site.advance(deadline + 60000);
  await delay(100);
  assert.equal(site.clockReads, clockReadsAtClose);
  assert.equal(await site.raw('articles.json'), articlesAtClose);
  assert.equal(await site.raw('logs.json'), logsAtClose);
});

// Migrating every message string unconditionally would overwrite authored guidance.
test('startup replaces old default feedback guidance while preserving administrator text', async t => {
  const content = structuredClone(defaultSiteContent);
  Object.assign(content.values, {
    'message.notice': '本页面用于体验留言流程，留言只保存在当前浏览器，不会提交至政府部门。请不要填写任何个人敏感信息。',
    'message.save': '保存留言', 'message.savedTitle': '留言已保存在本机',
    'message.footer': '管理员自定义：提交前请核实描述。',
    'info.statement.body': '管理员自定义网站声明，保留当前内容。'
  });
  const site = await installation(t, { content });
  await site.start();
  const migrated = await site.read('site-content.json');
  assert.equal(migrated.values['message.notice'], '留言将提交至本站，由管理员查看，不会公开展示。请勿填写身份证号、电话、住址等个人敏感信息。');
  assert.equal(migrated.values['message.save'], '提交留言');
  assert.equal(migrated.values['message.savedTitle'], '留言提交成功');
  assert.equal(migrated.values['message.footer'], '管理员自定义：提交前请核实描述。');
  assert.equal(migrated.values['info.statement.body'], '管理员自定义网站声明，保留当前内容。');
  await site.stop();
  const saved = await site.raw('site-content.json');
  await site.start();
  assert.equal(await site.raw('site-content.json'), saved);
});

// Silently replacing a broken private record with an empty array loses history.
for (const [filename, description] of [['logs.json', '操作日志'], ['feedback.json', '意见反馈']]) {
  test(`startup rejects damaged ${filename} and preserves its original bytes`, async t => {
    const site = await installation(t);
    const damaged = '{ interrupted private data';
    await writeFile(site.file(filename), damaged);
    await assert.rejects(site.start(), error => error.message.includes(description));
    assert.equal(await site.raw(filename), damaged);
  });
}
