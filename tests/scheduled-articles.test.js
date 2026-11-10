import test from 'node:test';
import assert from 'node:assert/strict';
import * as articles from '../lib/articles.mjs';
import { contentRequest, validateRequests } from '../lib/requests.mjs';

const article = {
  title: '定时发布政务通知', category: '通知公告', date: '2026-10-11',
  summary: '定时发布测试', body: ['通知完整正文。'], source: '办公室', status: 'published'
};
const stored = {
  ...article, id: 'schedule-article', isSample: false,
  createdAt: '2026-10-11T01:00:00.000Z', updatedAt: '2026-10-11T01:00:00.000Z'
};
const actor = { id: 'schedule-editor', username: 'schedule_editor' };
const badRequest = error => error instanceof articles.HttpError && error.status === 400;

// Rejecting the new status or dropping/incorrectly shifting its timestamp must fail.
test('normalizes a scheduled instant with an explicit timezone to UTC', () => {
  for (const [scheduledAt, expected] of [
    ['2026-10-12T09:30:45+08:00', '2026-10-12T01:30:45.000Z'],
    ['2026-10-12T09:30:45-05:30', '2026-10-12T15:00:45.000Z'],
    ['2028-02-29T00:00:00.125Z', '2028-02-29T00:00:00.125Z']
  ]) {
    const result = articles.validateArticle({ ...article, status: 'scheduled', scheduledAt });
    assert.equal(result.status, 'scheduled');
    assert.equal(result.scheduledAt, expected);
  }
});

// Trusting Date.parse alone admits rollover dates and timezone-less local times.
test('rejects an incomplete, impossible or timezone-less scheduled instant', () => {
  for (const scheduledAt of [
    undefined, null, '', 123,
    '2026-10-12', '2026-10-12T09:30Z', '2026-10-12T09:30:00',
    '2026-02-29T09:30:00Z', '2026-04-31T09:30:00Z',
    '2026-13-01T09:30:00Z', '2026-00-12T09:30:00Z',
    '2026-10-00T09:30:00Z', '2026-10-12T24:00:00Z',
    '2026-10-12T09:60:00Z', '2026-10-12T09:30:60Z',
    '2026-10-12T09:30:00+24:00', '2026-10-12T09:30:00+08:60'
  ]) {
    assert.throws(() => articles.validateArticle({ ...article, status: 'scheduled', scheduledAt }), badRequest, String(scheduledAt));
  }
});

// Using wall-clock checks during data loading would prevent restart catch-up.
test('accepts an overdue stored schedule so startup can publish it', () => {
  const [result] = articles.validateStoredArticles([{ ...stored, status: 'scheduled', scheduledAt: '2020-01-01T08:00:00+08:00' }]);
  assert.equal(result.status, 'scheduled');
  assert.equal(result.scheduledAt, '2020-01-01T00:00:00.000Z');
});

// Live writes must reject both overdue and already-due instants, not just bad syntax.
test('requires a scheduled live write to be strictly later than the current instant', () => {
  assert.equal(typeof articles.validateScheduleTime, 'function');
  const now = Date.parse('2026-10-12T01:30:45.000Z');
  for (const scheduledAt of ['2026-10-12T01:30:44.999Z', '2026-10-12T09:30:45+08:00']) {
    assert.throws(() => articles.validateScheduleTime({ ...article, status: 'scheduled', scheduledAt }, now), badRequest);
  }
  assert.doesNotThrow(() => articles.validateScheduleTime({ ...article, status: 'scheduled', scheduledAt: '2026-10-12T01:30:45.001Z' }, now));
});

// Dropping historical timestamps would erase the provenance of automatic publication.
test('retains the scheduled instant on a published article without rejecting its age', () => {
  const result = articles.validateArticle({ ...article, scheduledAt: '2020-01-01T08:00:00+08:00' });
  assert.equal(result.scheduledAt, '2020-01-01T00:00:00.000Z');
  assert.equal(typeof articles.validateScheduleTime, 'function');
  assert.doesNotThrow(() => articles.validateScheduleTime(result, Date.parse('2026-10-12T00:00:00Z')));
});

// Persisting null on old data changes capacity accounting and deletion fingerprints.
test('keeps missing or null schedule fields absent on existing published content', () => {
  for (const input of [stored, { ...stored, scheduledAt: null }]) {
    const [result] = articles.validateStoredArticles([input]);
    assert.equal(Object.hasOwn(result, 'scheduledAt'), false);
    assert.deepEqual(result, stored);
  }
});

// Keeping a previous schedule when selecting draft leaves unintended scheduled metadata.
test('clears the scheduled instant when an article is changed to a draft', () => {
  for (const scheduledAt of ['2026-10-12T09:30:00+08:00', 'invalid old input']) {
    const result = articles.validateArticle({ ...article, status: 'draft', scheduledAt });
    assert.equal(Object.hasOwn(result, 'scheduledAt'), false);
  }
});

// Applying the old published-only constraint would prevent saved scheduled submissions.
test('allows scheduled publication submissions to survive request validation', () => {
  const request = contentRequest('publish', { ...stored, status: 'scheduled', scheduledAt: '2020-01-01T00:00:00.000Z' }, actor);
  const [result] = validateRequests([request]);
  assert.equal(result.type, 'publish');
  assert.equal(result.status, 'pending');
  assert.equal(result.article.status, 'scheduled');
  assert.equal(result.article.scheduledAt, '2020-01-01T00:00:00.000Z');
});

// Broadening publication states must not broaden ordinary-admin deletion snapshots.
test('continues to reject deletion snapshots for content that is not published', () => {
  const request = contentRequest('delete', { ...stored, status: 'scheduled', scheduledAt: '2026-10-12T01:30:00.000Z' }, actor);
  assert.throws(() => validateRequests([request]), badRequest);
});

test('continues to reject draft publication submissions', () => {
  const request = contentRequest('publish', { ...stored, status: 'draft' }, actor);
  assert.throws(() => validateRequests([request]), badRequest);
});
