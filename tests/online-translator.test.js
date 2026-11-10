import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepLTranslator, createTranslationEngine } from '../lib/online-translator.mjs';

const article = {
  title: '道路施工通知',
  summary: '施工安排',
  source: '晏阳联合政府',
  body: ['第一段公告。', '第二段公告。'],
};
const languages = ['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'];

function responseFor(request) {
  const body = JSON.parse(request.init.body);
  return {
    ok: true,
    status: 200,
    async json() {
      return { translations: body.text.map((value, index) => ({ text: `${body.target_lang}:${index}:${value}` })) };
    },
  };
}

test('DeepL adapter sends only configured online requests and preserves article segments', async () => {
  const requests = [];
  const translator = createDeepLTranslator({
    apiKey: 'test-key',
    endpoint: 'https://translate.example.test/v2/translate',
    fetchImpl: async (url, init) => { requests.push({ url, init }); return responseFor({ url, init }); },
  });
  assert.equal(await translator.available(), true);
  let result;
  await translator.translateLanguage(article, 'zh-TW', value => { result = value; });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://translate.example.test/v2/translate');
  assert.equal(requests[0].init.headers.Authorization, 'DeepL-Auth-Key test-key');
  const payload = JSON.parse(requests[0].init.body);
  assert.equal(payload.target_lang, 'ZH-HANT');
  assert.deepEqual(result, {
    title: 'ZH-HANT:0:道路施工通知',
    summary: 'ZH-HANT:1:施工安排',
    source: 'ZH-HANT:2:晏阳联合政府',
    body: ['ZH-HANT:3:第一段公告。', 'ZH-HANT:4:第二段公告。'],
  });
});

test('DeepL adapter skips empty optional fields and refuses to send credentials over plain HTTP', async () => {
  let calls = 0;
  const translator = createDeepLTranslator({ apiKey: 'test-key', endpoint: 'https://translate.example.test/v2/translate', fetchImpl: async (_url, init) => {
    calls += 1;
    assert.deepEqual(JSON.parse(init.body).text, ['标题', '正文']);
    return { ok: true, status: 200, async json() { return { translations: [{ text: 'Title' }, { text: 'Body' }] }; } };
  } });
  let result;
  await translator.translateLanguage({ title: '标题', summary: '', source: '', body: ['正文'] }, 'en', value => { result = value; });
  assert.equal(calls, 1);
  assert.deepEqual(result, { title: 'Title', summary: '', source: '', body: ['Body'] });
  const insecure = createDeepLTranslator({ apiKey: 'test-key', endpoint: 'http://translate.example.test/v2/translate', fetchImpl: async () => { calls += 1; } });
  assert.equal(await insecure.available(), false);
  await assert.rejects(insecure.translateLanguage(article, 'en', () => {}), error => error.translationCode === 'engine_unavailable');
  assert.equal(calls, 1);
});

test('hybrid engine prioritizes online translations, caps concurrent languages, and falls back per language', async () => {
  let active = 0;
  let peak = 0;
  const onlineLanguages = [];
  const offlineLanguages = [];
  const online = {
    available: async () => true,
    async translateLanguage(value, language, onTranslation) {
      onlineLanguages.push(language); active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      if (language === 'ja') throw Object.assign(new Error('temporary provider failure'), { translationCode: 'translation_failed' });
      await onTranslation({ title: `${language}:${value.title}`, summary: '', source: '', body: value.body.map(item => `${language}:${item}`) });
    },
    close() {},
  };
  const offline = {
    available: async () => true,
    async translate(_value, onTranslation, options) {
      assert.deepEqual(options.languages, ['ja']);
      for (const language of options.languages) {
        offlineLanguages.push(language);
        await onTranslation(language, { title: `offline:${language}`, summary: '', source: '', body: ['offline'] });
      }
    },
    close() {},
  };
  const engine = createTranslationEngine({ online, offline, concurrency: 3 });
  const translated = new Map();
  await engine.translate(article, async (language, content) => translated.set(language, content));
  assert.ok(peak <= 3, `online concurrency exceeded limit: ${peak}`);
  assert.deepEqual(onlineLanguages, languages);
  assert.deepEqual(offlineLanguages, ['ja']);
  assert.equal(translated.get('en').title, 'en:道路施工通知');
  assert.equal(translated.get('ja').title, 'offline:ja');
  assert.equal(translated.size, languages.length);
});

test('hybrid availability is true when either online or offline engine is ready', async () => {
  const unavailable = { available: async () => false, close() {} };
  const onlineOnly = createTranslationEngine({ online: { available: async () => true, close() {} }, offline: unavailable });
  const offlineOnly = createTranslationEngine({ online: unavailable, offline: { available: async () => true, close() {} } });
  assert.equal((await onlineOnly.status()).provider, 'online');
  assert.equal((await offlineOnly.status()).provider, 'offline');
});

test('hybrid engine propagates article state conflicts instead of hiding them as provider errors', async () => {
  let offlineCalls = 0;
  const engine = createTranslationEngine({
    online: { available: async () => true, async translateLanguage(_value, _language, onTranslation) { await onTranslation({ title: '译文', summary: '', source: '', body: ['译文'] }); }, close() {} },
    offline: { available: async () => true, async translate() { offlineCalls += 1; }, close() {} },
  });
  await assert.rejects(engine.translate(article, async () => { throw new Error('article superseded'); }), /article superseded/);
  assert.equal(offlineCalls, 0);
});
