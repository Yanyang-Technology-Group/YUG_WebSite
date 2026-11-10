import test from 'node:test';
import assert from 'node:assert/strict';
import * as articles from '../lib/articles.mjs';
import { articleFingerprint } from '../lib/requests.mjs';

const article = { id: 'translated-article', title: '城市公告', summary: '建设安排', source: '晏阳联合政府', body: ['第一段。', '第二段。'], category: '通知公告', date: '2026-10-18', status: 'published', isSample: false, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', autoTranslate: true };
const english = { title: 'City notice', summary: 'Construction plan', source: 'Yanyang United Government', body: ['First paragraph.', 'Second paragraph.'] };
function translated() {
  return { ...article, translation: { fingerprint: articles.articleTranslationFingerprint(article), status: 'translating', locales: { en: english }, updatedAt: '2026-10-18T00:01:00.000Z' } };
}

// Dropping the opt-in at validation would silently disable publication translation.
test('article validation retains an explicit translation choice and rejects non-boolean input', () => {
  assert.equal(articles.validateArticle(article).autoTranslate, true);
  assert.equal(articles.validateArticle({ ...article, autoTranslate: false }).autoTranslate, false);
  assert.throws(() => articles.validateArticle({ ...article, autoTranslate: 'true' }), error => error.status === 400);
});

// Rebuilding stored records without translated fields loses results on restart/import.
test('stored translations survive validation with paragraph order and escaped text untouched', () => {
  assert.equal(typeof articles.articleTranslationFingerprint, 'function');
  const input = translated();
  input.translation.locales.en.body[0] = '<script>plain article text</script>';
  assert.deepEqual(articles.validateStoredArticles([input])[0], input);
});

// Translations of an older source must never be served after editing or opting out.
test('source edits and opting out discard obsolete translations', () => {
  assert.equal(typeof articles.articleTranslationFingerprint, 'function');
  assert.equal(articles.validateStoredArticles([{ ...translated(), title: '修改后的公告' }])[0].translation, undefined);
  assert.equal(articles.validateStoredArticles([{ ...translated(), autoTranslate: false }])[0].translation, undefined);
});

// Arbitrary locales and a shorter body would mislabel or silently truncate public text.
test('stored translation validation rejects unsupported locales and missing paragraphs', () => {
  assert.equal(typeof articles.articleTranslationFingerprint, 'function');
  for (const locales of [{ unknown: english }, { en: { ...english, body: ['Only one.'] } }]) {
    assert.throws(() => articles.validateStoredArticles([{ ...translated(), translation: { ...translated().translation, locales } }]), error => error.status === 400);
  }
});

// Background translation must not invalidate an existing delete approval snapshot.
test('deletion approval fingerprint ignores generated translations while detecting source edits', () => {
  assert.equal(articleFingerprint(article), articleFingerprint({ ...article, translation: { status: 'completed', locales: { en: english } } }));
  assert.notEqual(articleFingerprint(article), articleFingerprint({ ...article, title: '另一则公告' }));
});
