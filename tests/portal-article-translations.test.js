import test from 'node:test';
import assert from 'node:assert/strict';
import * as articleLanguages from '../public/portal-i18n.js';
import { searchContent } from '../public/portal-utils.js';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { services as serviceDefaults } from '../public/portal-data.js';
import { defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds } from '../public/site-content-schema.js';

const article = {
  id: 'local-news', title: '新城区开放', summary: '新城区建设情况', source: '晏阳信息中心',
  body: ['城市广场已经开放。', '欢迎市民参观。'], category: '政务要闻', date: '2026-10-18',
  translation: { status: 'translating', locales: {
    en: { title: 'New district opens', summary: 'District construction update', source: 'Yanyang Information Centre', body: ['The civic plaza is open.', 'Residents are welcome.'] },
    ar: { title: 'افتتاح المنطقة الجديدة', summary: 'تحديث أعمال البناء', source: 'مركز معلومات يانيانغ', body: ['الساحة المدنية مفتوحة.', 'نرحب بالسكان.'] },
  } },
};

test('uses a completed locale while the remaining offline translations are still running', () => {
  const translated = articleLanguages.localizeArticle(article, 'en');
  assert.equal(translated.title, 'New district opens');
  assert.equal(translated.summary, 'District construction update');
  assert.equal(translated.source, 'Yanyang Information Centre');
  assert.deepEqual(translated.body, ['The civic plaza is open.', 'Residents are welcome.']);
  assert.equal(translated.isTranslated, true);
  assert.equal(translated.contentLanguage, 'en');
  assert.equal(translated.id, 'local-news');
});

test('searches translated titles and body rather than an unrelated original language', () => {
  const translated = articleLanguages.localizeArticle(article, 'en');
  assert.equal(searchContent([translated], 'district')[0].id, 'local-news');
  assert.equal(searchContent([translated], 'civic plaza')[0].title, 'New district opens');
  assert.equal(searchContent([translated], '新城区').length, 0);
});

test('keeps original text when a locale is unavailable or malformed and never mutates the original', () => {
  const before = structuredClone(article);
  for (const code of ['zh-CN', 'fr', 'unsupported']) {
    const result = articleLanguages.localizeArticle(article, code);
    assert.equal(result.title, '新城区开放');
    assert.deepEqual(result.body, ['城市广场已经开放。', '欢迎市民参观。']);
    assert.equal(result.isTranslated, false);
    assert.equal(result.contentLanguage, 'zh-CN');
  }
  const malformed = { ...article, translation: { locales: { en: { title: 'Only a title' } } } };
  assert.equal(articleLanguages.localizeArticle(malformed, 'en').title, '新城区开放');
  assert.deepEqual(article, before);
});

test('recomputes from original content when switching between translated languages and Chinese', async () => {
  const i18n = articleLanguages.createI18n({ load: async locale => ({ version: 1, locale, values: {}, ui: {} }) });
  await i18n.setLanguage('en');
  assert.equal(i18n.localizeArticle(article).title, 'New district opens');
  await i18n.setLanguage('ar');
  assert.equal(i18n.localizeArticle(article).body[0], 'الساحة المدنية مفتوحة.');
  assert.equal(i18n.direction, 'rtl');
  await i18n.setLanguage('zh-CN');
  assert.equal(i18n.localizeArticle(article).title, '新城区开放');
});

test('keeps available translations on a partial failure and allows empty optional fields', () => {
  const partial = { ...article, translation: { status: 'failed', locales: { en: { title: 'Notice', summary: '', source: '', body: ['A public notice.'] } } } };
  const result = articleLanguages.localizeArticle(partial, 'en');
  assert.equal(result.title, 'Notice');
  assert.equal(result.summary, '');
  assert.equal(result.source, '');
  assert.equal(result.isTranslated, true);
  assert.equal(articleLanguages.localizeArticle({ ...article, translation: undefined }, 'en').title, '新城区开放');
});

// Article control runs unchanged; the DOM and HTTP boundary supply isolated fixtures.
async function adminWorkspace({ role = 'superadmin', available = true, onlineAvailable = false, offlineAvailable = available, initialArticles = [] } = {}) {
  const nodes = new Map(), requests = [], timers = new Map();
  let timerId = 0, stored = structuredClone(initialArticles);
  const node = selector => {
    if (!nodes.has(selector)) {
      const attributes = new Map(), classes = new Set();
      nodes.set(selector, {
        value: '', textContent: '', innerHTML: '', dataset: {}, checked: false, open: false, style: {},
        classList: { add: key => classes.add(key), remove: key => classes.delete(key), toggle(key, selected) { selected ? classes.add(key) : classes.delete(key); } },
        setAttribute: (key, value) => attributes.set(key, String(value)), removeAttribute: key => attributes.delete(key),
        getAttribute: key => attributes.get(key), addEventListener() {}, insertAdjacentHTML(_where, html) { this.innerHTML += html; },
        reset() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {}, scrollTo() {} }, Intl, Date,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    createWebsiteContentEditor: () => ({ dirty: false, loadPublic: async () => {}, load: async () => {}, clear() {} }),
    createAdminManagement: () => ({ clear() {}, handleClick() {}, loadRequests: async () => {} }),
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET', input = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, method, input });
      let result;
      if (url === '/api/admin/session') result = { authenticated: true, username: 'test_admin', role, csrfToken: 'test-csrf' };
      else if (url === '/api/admin/translation') result = { available, onlineAvailable, offlineAvailable, provider: onlineAvailable ? 'hybrid' : offlineAvailable ? 'offline' : 'unavailable', engine: onlineAvailable ? '联网优先' : '离线翻译', languages: ['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'], activeArticleId: null };
      else if (url === '/api/admin/articles' && method === 'GET') result = { articles: structuredClone(stored) };
      else if (url.endsWith('/translate')) {
        stored = stored.map(item => ({ ...item, autoTranslate: true, translation: { status: 'pending', locales: {} } }));
        result = { article: stored[0] };
      } else if (url === '/api/admin/articles' && method === 'POST') {
        stored = [{ ...input, id: 'new-article' }]; result = { article: stored[0] };
      } else throw Error(`Unexpected request ${method} ${url}`);
      return { ok: true, json: async () => result };
    },
  });
  const source = (await readFile(new URL('../public/admin.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { run: code => vm.runInContext(code, context), node, requests, timers };
}

test('new editor defaults to automatic translation, respects old article opt-out, and submits the chosen option', async () => {
  const site = await adminWorkspace({ initialArticles: [{ ...article, status: 'published', translation: undefined }] });
  site.run('openEditor()');
  assert.equal(site.node('#post-auto-translate').checked, true);
  site.run("openEditor('local-news')");
  assert.equal(site.node('#post-auto-translate').checked, false);
  site.run('openEditor()');
  site.node('#post-title').value = '测试文章';
  site.node('#post-body').value = '测试正文。';
  site.node('#post-auto-translate').checked = false;
  await site.run("saveArticle('published')");
  assert.equal(site.requests.find(item => item.method === 'POST').input.autoTranslate, false);
});

test('translation status identifies the online-first provider and its local fallback', async () => {
  const site = await adminWorkspace({ available: true, onlineAvailable: true, offlineAvailable: true });
  assert.match(site.node('#translation-engine-status').textContent, /联网翻译已配置 · 离线模型可回退/);
  assert.match(site.node('#post-translation-help').textContent, /DeepL API 密钥/);
});

test('managers see progress and can generate missing translations, ordinary administrators cannot retry', async () => {
  const partial = { ...article, status: 'published', autoTranslate: true, translation: { ...article.translation, status: 'failed' } };
  const manager = await adminWorkspace({ initialArticles: [partial], role: 'senioradmin' });
  assert.match(manager.node('#post-table').innerHTML, /2 \/ 11/);
  assert.match(manager.node('#post-table').innerHTML, /data-translate="local-news"/);
  await manager.run("translateArticle('local-news')");
  assert.equal(manager.requests.find(item => item.url.endsWith('/translate')).method, 'POST');
  assert.match(manager.node('#post-table').innerHTML, /等待自动翻译/);
  assert.ok([...manager.timers.values()].some(timer => timer.delay === 4000));
  const ordinary = await adminWorkspace({ role: 'admin', initialArticles: [partial] });
  assert.doesNotMatch(ordinary.node('#post-table').innerHTML, /data-translate/);
  await ordinary.run("translateArticle('local-news')");
  assert.equal(ordinary.requests.filter(item => item.url.endsWith('/translate')).length, 0);
});

test('managers can explicitly retranslate an article whose translations are already complete', async () => {
  const complete = { ...article, status: 'published', autoTranslate: true, translation: {
    status: 'completed', locales: Object.fromEntries(['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'].map(code => [code, { title: code, summary: '', source: '', body: ['已完成译文。', '第二段译文。'] }]))
  } };
  const manager = await adminWorkspace({ initialArticles: [complete], role: 'senioradmin' });
  assert.match(manager.node('#post-table').innerHTML, /11 \/ 11/);
  assert.match(manager.node('#post-table').innerHTML, /data-translate="local-news"/);
  assert.match(manager.node('#post-table').innerHTML, /重新翻译/);
  await manager.run("translateArticle('local-news')");
  assert.equal(manager.requests.filter(item => item.url.endsWith('/translate')).length, 1);
  assert.match(manager.node('#post-table').innerHTML, /等待自动翻译/);
  assert.match(manager.node('#post-table').innerHTML, /0 \/ 11/);
});

test('managers can retry a failed article even when all locale results were saved', async () => {
  const failed = { ...article, status: 'published', autoTranslate: true, translation: {
    status: 'failed', locales: Object.fromEntries(['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'].map(code => [code, { title: code, summary: '', source: '', body: ['已完成译文。', '第二段译文。'] }]))
  } };
  const manager = await adminWorkspace({ initialArticles: [failed], role: 'superadmin' });
  assert.match(manager.node('#post-table').innerHTML, /11 \/ 11/);
  assert.match(manager.node('#post-table').innerHTML, /data-translate="local-news"/);
  assert.match(manager.node('#post-table').innerHTML, /重试翻译/);
  await manager.run("translateArticle('local-news')");
  assert.equal(manager.requests.filter(item => item.url.endsWith('/translate')).length, 1);
  assert.match(manager.node('#post-table').innerHTML, /等待自动翻译/);
});

test('unavailable offline engine keeps publishing usable and background refresh preserves unfinished editor fields', async () => {
  const site = await adminWorkspace({ available: false, initialArticles: [{ ...article, status: 'published', autoTranslate: true }] });
  assert.match(site.node('#translation-engine-status').textContent, /未就绪/);
  site.run('openEditor()');
  site.node('#post-title').value = '尚未保存的标题';
  site.node('#post-body').value = '尚未保存的正文';
  await site.run('loadArticles()');
  await site.run('loadTranslationInfo()');
  assert.equal(site.node('#post-title').value, '尚未保存的标题');
  assert.equal(site.node('#post-body').value, '尚未保存的正文');
  await site.run("saveArticle('published')");
  assert.ok(site.requests.some(item => item.url === '/api/admin/articles' && item.method === 'POST'));
});

async function portalWorkspace(inputArticle = article) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) {
      const attributes = new Map(), classes = new Set();
      nodes.set(selector, { value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
        classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key), toggle(key, selected) { selected ? classes.add(key) : classes.delete(key); } },
        setAttribute: (key, value) => attributes.set(key, String(value)), getAttribute: key => attributes.get(key),
        addEventListener() {}, insertAdjacentHTML(_where, html) { this.innerHTML += html; }, focus() {},
        showModal() { this.open = true; }, close() { this.open = false; },
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, body: node('body'), documentElement: node('html') },
    serviceDefaults, defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds,
    searchContent, createI18n: options => articleLanguages.createI18n({ ...options, load: async locale => JSON.parse(await readFile(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8')) }), languages: articleLanguages.languages, structuredClone, Intl, Date,
    localStorage: { getItem: () => null, setItem() {} }, location: { hash: '' }, window: { addEventListener() {}, scrollTo() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: async url => ({ ok: true, json: async () => url === '/api/articles' ? { articles: [structuredClone(inputArticle)] }
      : url === '/api/site-content' ? { content: structuredClone(defaultSiteContent) }
      : JSON.parse(await readFile(new URL(`../public/${url.replace('./', '')}`, import.meta.url), 'utf8')) }),
  });
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { node, run: code => vm.runInContext(code, context) };
}

test('portal renders translated lists and search, refreshes an open article on language switch, and falls back to Chinese', async () => {
  const site = await portalWorkspace();
  await site.run("setLanguage('en', false)");
  assert.match(site.node('#news-list').innerHTML, /New district opens/);
  site.run("openSearch('civic plaza')");
  assert.match(site.node('#dialog-content').innerHTML, /New district opens/);
  site.run("openArticle('local-news')");
  assert.match(site.node('#dialog-content').innerHTML, /Yanyang Information Centre/);
  assert.match(site.node('#dialog-content').innerHTML, /Residents are welcome/);
  assert.doesNotMatch(site.node('#dialog-content').innerHTML, /original-content-note/);
  await site.run("setLanguage('ar', false)");
  assert.match(site.node('#dialog-content').innerHTML, /lang="ar" dir="rtl"/);
  assert.match(site.node('#dialog-content').innerHTML, /الساحة المدنية مفتوحة/);
  await site.run("setLanguage('fr', false)");
  assert.match(site.node('#dialog-content').innerHTML, /新城区开放/);
  assert.match(site.node('#dialog-content').innerHTML, /original-content-note/);
  await site.run("setLanguage('zh-CN', false)");
  assert.match(site.node('#news-list').innerHTML, /新城区开放/);
  assert.doesNotMatch(site.node('#dialog-content').innerHTML, /original-content-note/);
});

test('translated article text remains escaped in lists and full article markup', async () => {
  const unsafe = structuredClone(article);
  unsafe.translation.locales.en.title = '<script>unsafe title</script>';
  unsafe.translation.locales.en.body = ['<img src=x onerror=alert(1)>'];
  const site = await portalWorkspace(unsafe);
  await site.run("setLanguage('en', false)");
  assert.match(site.node('#news-list').innerHTML, /&lt;script&gt;unsafe title/);
  site.run("openArticle('local-news')");
  assert.match(site.node('#dialog-content').innerHTML, /&lt;img src=x/);
  assert.doesNotMatch(site.node('#dialog-content').innerHTML, /<img src=x/);
});
