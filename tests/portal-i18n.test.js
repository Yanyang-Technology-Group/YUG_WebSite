import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createI18n, languages, normalizeLanguage } from '../public/portal-i18n.js';
import { defaultSiteContent, contentFields } from '../public/site-content-schema.js';

const bundle = locale => ({ version: 1, locale, values: { 'nav.home': locale + ' home' }, ui: { language: locale + ' language' } });

test('language defaults to Chinese and ignores unsupported or inaccessible preferences', () => {
  assert.deepEqual(languages.map(item => item.code), ['zh-CN', 'zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it']);
  assert.equal(createI18n().language, 'zh-CN');
  assert.equal(normalizeLanguage('../../private'), 'zh-CN');
  assert.equal(createI18n({ storage: { getItem() { throw Error('blocked'); } } }).preferredLanguage, 'zh-CN');
  assert.equal(createI18n({ storage: { getItem: () => 'en' } }).preferredLanguage, 'en');
});

test('switches local dictionaries, persists preference, preserves authored and empty text', async () => {
  const saved = [];
  const i18n = createI18n({ storage: { getItem: () => null, setItem: (...args) => saved.push(args) }, load: async code => bundle(code) });
  await i18n.setLanguage('en');
  assert.equal(i18n.text('nav.home', '首页', '首页'), 'en home');
  assert.equal(i18n.text('nav.home', '自定义首页', '首页'), '自定义首页');
  assert.equal(i18n.text('nav.home', '', '首页'), '');
  assert.equal(i18n.text('missing', '中文原文', '中文原文'), '中文原文');
  assert.equal(saved[0][1], 'en');
  await i18n.setLanguage('ar');
  assert.equal(i18n.direction, 'rtl');
  await i18n.setLanguage('zh-CN');
  assert.equal(i18n.direction, 'ltr');
  assert.equal(i18n.text('nav.home', '首页', '首页'), '首页');
});

test('a slow earlier dictionary cannot override a newer language choice', async () => {
  let release;
  const i18n = createI18n({ load: code => code === 'en' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(bundle(code)) });
  const first = i18n.setLanguage('en');
  await i18n.setLanguage('ja');
  release(bundle('en'));
  assert.equal(await first, false);
  assert.equal(i18n.language, 'ja');
});

test('failed or invalid dictionary loads keep the active language and allow a retry', async () => {
  let fail = true;
  const i18n = createI18n({ load: async code => fail ? { ...bundle(code), locale: 'wrong' } : bundle(code) });
  await assert.rejects(i18n.setLanguage('en'));
  assert.equal(i18n.language, 'zh-CN');
  fail = false;
  await i18n.setLanguage('en');
  assert.equal(i18n.language, 'en');
});

test('switching remains usable when browser storage is unavailable', async () => {
  const i18n = createI18n({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } }, load: async code => bundle(code) });
  assert.equal(await i18n.setLanguage('fr'), true);
  assert.equal(i18n.language, 'fr');
});

test('all bundled languages cover active interface fields and preserve placeholders and paragraphs', async () => {
  const keys = contentFields.filter(field => !field.retired && !field.key.endsWith('Query')).map(field => field.key).sort();
  let uiKeys;
  for (const { code } of languages.filter(item => item.code !== 'zh-CN')) {
    const dictionary = JSON.parse(await readFile(new URL(`../public/locales/${code}.json`, import.meta.url), 'utf8'));
    assert.equal(dictionary.version, 1);
    assert.equal(dictionary.locale, code);
    assert.deepEqual(Object.keys(dictionary.values).sort(), keys, code);
    uiKeys ??= Object.keys(dictionary.ui).sort();
    assert.deepEqual(Object.keys(dictionary.ui).sort(), uiKeys, code);
    for (const key of keys) {
      const source = defaultSiteContent.values[key], translated = dictionary.values[key];
      assert.equal(typeof translated, 'string', `${code}:${key}`);
      assert.ok(translated.trim(), `${code}:${key}`);
      assert.deepEqual(translated.match(/\{[^}]+\}/g), source.match(/\{[^}]+\}/g), `${code}:${key} placeholders`);
      assert.equal((translated.match(/\n/g) || []).length, (source.match(/\n/g) || []).length, `${code}:${key} paragraphs`);
    }
  }
});
