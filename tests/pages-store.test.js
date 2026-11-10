import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createD1Store } from '../lib/d1-store.mjs';
import { runTranslationStep } from '../lib/pages-translations.mjs';
import { newArticle, translationLanguages } from '../lib/articles.mjs';

// Exercise the real migration and SQLite transaction semantics behind D1.
async function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.prepare('INSERT INTO portal_records VALUES (?, ?, ?, ?)').run('initialized', '0', 0, 'true');
  const db = {
    prepare(sql) {
      const statement = { sql, parameters: [], bind(...parameters) { return { ...statement, parameters }; }, async all() { return { results: sqlite.prepare(sql).all(...this.parameters) }; } };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}
const article = () => newArticle({ title: '边缘翻译验证文章', category: '通知公告', date: '2026-11-09', body: ['隔离测试正文。'], status: 'published', autoTranslate: true });
test('D1 upgrades legacy footer/contact defaults and persists them without changing authored text', async t => {
  const db = await database(t);
  const legacy = { version: 1, values: { 'footer.brand': '晏阳联合政府', 'footer.description': '晏阳联合政府网站 · 政务门户', 'interaction.hotlineNumber': '12345', 'gallery.title': '保留自定义标题' } };
  await db.prepare('INSERT INTO portal_records VALUES (?, ?, ?, ?)').bind('siteContent', '0', 0, JSON.stringify(legacy)).all();
  const store = await createD1Store(db);
  assert.equal(store.state.siteContent.values['footer.brand'], '© 2025-2026 晏阳技术组');
  assert.equal(store.state.siteContent.values['interaction.hotlineNumber'], 'feedback@yanyn.cn');
  assert.equal(store.state.siteContent.values['gallery.title'], '保留自定义标题');
  await store.flush();
  assert.deepEqual((await createD1Store(db)).state.siteContent, store.state.siteContent);
});
async function translatedStore(t) {
  const db = await database(t), store = await createD1Store(db);
  await store.updateArticles(() => [article()]);
  await store.updateTranslationSettings(() => ({ provider: 'llm', endpoint: 'https://translation.example.test/v1/chat/completions', model: 'test-model', apiKey: 'private-test-key', fallback: false }));
  await store.flush(); return db;
}
function translatedResponse(options) {
  const request = JSON.parse(options.body);
  const texts = JSON.parse(request.messages[1].content).texts;
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: texts.map(text => 'Translated ' + text) }) } }] });
}
test('D1 revision conflicts preserve all records from the winning transaction', async t => {
  const db = await database(t);
  const first = await createD1Store(db), stale = await createD1Store(db);
  await first.updateArticles(() => [article()]);
  await stale.updateArticles(() => [{ ...article(), title: '失败事务不应写入' }]);
  await first.flush();
  await assert.rejects(stale.flush(), error => error.status === 409);
  const persisted = await createD1Store(db);
  assert.deepEqual(persisted.getArticles(), first.getArticles());
  assert.deepEqual(persisted.getLogs(), first.getLogs());
});
test('D1 oversized rows and batches fail before any revision is committed', async t => {
  const db = await database(t), large = await createD1Store(db);
  large.state.jobs = [['large', { value: 'x'.repeat(1500000) }]];
  await assert.rejects(large.flush(), error => error.status === 413);
  const many = await createD1Store(db);
  many.state.jobs = Array.from({ length: 901 }, (_, i) => [String(i), { value: i }]);
  await assert.rejects(many.flush(), error => error.status === 413);
  assert.equal((await db.prepare('SELECT version FROM portal_revision').all()).results[0].version, 0);
  assert.deepEqual((await createD1Store(db)).state.jobs, []);
});
test('Pages translation resumes from persisted progress and completes all eleven languages', async t => {
  const db = await translatedStore(t); let requests = 0;
  const fetchImpl = async (_url, options) => { requests++; return translatedResponse(options); };
  for (let step = 1; step <= translationLanguages.length; step++) {
    await runTranslationStep({ DB: db }, { fetchImpl });
    const state = await createD1Store(db), current = state.getArticles()[0];
    assert.equal(Object.keys(current.translation.locales).length, step);
    assert.equal(current.translation.status, step === translationLanguages.length ? 'completed' : 'pending');
    assert.deepEqual(state.state.jobs, []);
  }
  await runTranslationStep({ DB: db }, { fetchImpl });
  assert.equal(requests, 11, 'completed jobs must not call the service again');
});
test('Pages translation discards stale results after an edit and redacts service failures', async t => {
  const db = await translatedStore(t);
  await runTranslationStep({ DB: db }, { fetchImpl: async (_url, options) => {
    const edited = await createD1Store(db);
    await edited.updateArticles(items => items.map(item => ({ ...item, title: '翻译期间修改后的文章' })));
    await edited.flush(); return translatedResponse(options);
  } });
  let state = await createD1Store(db);
  assert.equal(state.getArticles()[0].title, '翻译期间修改后的文章');
  assert.equal(state.getArticles()[0].translation, undefined, 'editing invalidates the old translation fingerprint');
  await runTranslationStep({ DB: db }, { fetchImpl: async () => { throw new Error('private-test-key provider error'); } });
  state = await createD1Store(db);
  assert.equal(state.getArticles()[0].translation.status, 'failed');
  assert.ok(!JSON.stringify(state.getLogs()).includes('private-test-key'));
  assert.deepEqual(state.state.jobs, []);
});
