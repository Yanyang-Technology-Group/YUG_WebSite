import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAudit, validateLogs } from '../lib/audit.mjs';
import { createStore } from '../lib/store.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const now = Date.parse('2026-10-11T00:00:00.000Z');
const maxBytes = 16 * 1024 * 1024;
const bytes = logs => Buffer.byteLength(JSON.stringify({ version: 1, logs }, null, 2) + '\n');
const event = (i, large = false) => ({ actor: { id: 'owner', username: 'review_owner', role: 'superadmin' }, action: 'article.update', target: { type: 'article', id: `article-${i}`, title: large ? '文'.repeat(200) : `文章 ${i}` }, result: 'success', message: large ? '文'.repeat(500) : '' });
const entry = (i, large = false) => ({ ...event(i, large), id: `entry-${i}`, at: new Date(now).toISOString(), actionLabel: '修改文章或发布计划' });

test('audit count retention keeps the newest 10000 entries in chronological insertion order', () => {
  const original = validateLogs(Array.from({ length: 10000 }, (_, i) => entry(i)));
  const result = appendAudit(original, [event('new-a'), event('new-b'), event('new-c')], now + 1000);
  assert.equal(result.length, 10000);
  assert.deepEqual(result.slice(0, -3).map(item => item.id), original.slice(3).map(item => item.id));
  assert.deepEqual(result.slice(-3).map(item => item.target.id), ['article-new-a', 'article-new-b', 'article-new-c']);
  assert.equal(original[0].id, 'entry-0');
  validateLogs(result);
});

test('audit byte retention removes only an oldest prefix and retains newly appended events within 16 MiB', () => {
  const candidates = Array.from({ length: 8000 }, (_, i) => entry(i, true));
  let low = 0, high = candidates.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytes(candidates.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  const original = validateLogs(candidates.slice(0, low));
  const incoming = Array.from({ length: 100 }, (_, i) => event(`incoming-${i}`, true));
  const result = appendAudit(original, incoming, now + 1000);
  assert.ok(bytes(result) <= maxBytes);
  assert.ok(result.length < original.length + incoming.length);
  const survivingOriginal = result.slice(0, -incoming.length);
  assert.deepEqual(survivingOriginal.map(item => item.id), original.slice(-survivingOriginal.length).map(item => item.id));
  assert.deepEqual(result.slice(-incoming.length).map(item => item.target.id), incoming.map(item => item.target.id));
  validateLogs(result);
});

test('over-limit and malformed saved audit records are rejected without silent truncation', () => {
  assert.throws(() => validateLogs(Array.from({ length: 10001 }, (_, i) => entry(i))), error => error.status === 400);
  assert.throws(() => validateLogs(Array.from({ length: 8000 }, (_, i) => entry(i, true))), error => error.status === 400);
  assert.throws(() => validateLogs([{ ...entry(0), at: 'invalid' }]), error => error.status === 400);
});

test('rolled audit entries persist across store restart', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-audit-retention-review-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  await writeFile(path.join(dataDir, 'logs.json'), JSON.stringify({ version: 1, logs: Array.from({ length: 9998 }, (_, i) => entry(i)) }));
  const store = await createStore({ rootDir, dataDir, now: () => now });
  await store.appendLog(Array.from({ length: 4 }, (_, i) => event(`persist-${i}`)));
  const persisted = JSON.parse(await readFile(path.join(dataDir, 'logs.json'), 'utf8'));
  assert.equal(persisted.logs.length, 10000);
  assert.equal(persisted.logs[0].id, 'entry-2');
  const restarted = await createStore({ rootDir, dataDir, now: () => now });
  assert.deepEqual(restarted.getLogs(), persisted.logs);
});

test('a corrupt audit file prevents startup and remains intact for recovery', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-audit-corruption-review-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, 'articles.json'), JSON.stringify({ version: 1, articles: [] }));
  const corrupt = JSON.stringify({ version: 1, logs: [{ ...entry(0), action: 'unknown.action' }] });
  await writeFile(path.join(dataDir, 'logs.json'), corrupt);
  await assert.rejects(createStore({ rootDir, dataDir, now: () => now }), /操作日志格式不正确，请从备份恢复/);
  assert.equal(await readFile(path.join(dataDir, 'logs.json'), 'utf8'), corrupt);
});
