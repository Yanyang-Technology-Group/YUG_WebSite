import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeFeedback, validateStoredFeedback } from '../lib/feedback.mjs';

const maxBytes = 16 * 1024 * 1024;
const at = '2026-10-11T00:00:00.000Z';
const reader = { id: 'r'.repeat(80), username: 'r'.repeat(40) };
const encodedBytes = records => Buffer.byteLength(JSON.stringify({ version: 1, feedback: records }, null, 2) + '\n');
const record = id => ({ type: 'suggestion', gameName: '游'.repeat(40), qq: '123456789012', title: 'xx', content: 'x'.repeat(1000), id, createdAt: at, status: 'new' });
const markRead = records => records.map(item => ({ ...item, status: 'read', readBy: reader, readAt: at }));
const markUnread = records => records.map(({ readBy, readAt, ...item }) => ({ ...item, status: 'new' }));

function fillBytes(records, reserve) {
  let remaining = maxBytes - encodedBytes(records) - reserve;
  assert.ok(remaining >= 0);
  for (const item of records) {
    const count = Math.min(1000, Math.floor(remaining / 2));
    item.content = '文'.repeat(count) + 'x'.repeat(1000 - count);
    remaining -= count * 2;
  }
  assert.ok(remaining <= 1, 'fixture must reach the byte boundary');
  return records;
}

test('read feedback cannot use processing space already reserved for its unread state', () => {
  const records = fillBytes(markRead(Array.from({ length: 5000 }, (_, i) => record(`full-${i}`))), 0);
  assert.ok(encodedBytes(records) <= maxBytes);
  assert.throws(() => validateStoredFeedback(records), error => error.status === 413);
});

test('marking feedback read does not create submission capacity that marking unread later needs', () => {
  const records = fillBytes(Array.from({ length: 4500 }, (_, i) => record(`bounded-${i}`)), 4500 * 1024);
  validateStoredFeedback(records);
  const read = validateStoredFeedback(markRead(records));
  const additional = { ...record('extra'), content: 'x'.repeat(10) };
  assert.throws(() => validateStoredFeedback([...read, additional]), error => error.status === 413);
});

test('an accepted feedback set supports read and unread processing at its reserved byte boundary', () => {
  const records = fillBytes(Array.from({ length: 4500 }, (_, i) => record(`roundtrip-${i}`)), 4500 * 1024);
  const accepted = validateStoredFeedback(records);
  const read = validateStoredFeedback(markRead(accepted));
  const unread = validateStoredFeedback(markUnread(read));
  assert.equal(read.length, 4500);
  assert.deepEqual(unread, accepted);
  assert.ok(Buffer.byteLength(serializeFeedback(read)) <= maxBytes);
  assert.ok(Buffer.byteLength(serializeFeedback(unread)) <= maxBytes);
});
