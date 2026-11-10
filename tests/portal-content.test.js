import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { services as serviceDefaults } from '../public/portal-data.js';
import { searchContent } from '../public/portal-utils.js';
import { createI18n, languages } from '../public/portal-i18n.js';
import { defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds } from '../public/site-content-schema.js';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const markup = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function createDom() {
  const elements = [...markup.matchAll(/<([\w-]+)\b([^>]*)>/g)].map(([, tag, attributes]) => {
    const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    return {
      tagName: tag.toUpperCase(), attributes: attrs, dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      id: attrs.id, textContent: '', innerHTML: '', style: {}, listeners: new Map(),
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; } },
      setAttribute(key, value) { attrs[key] = String(value); }, getAttribute(key) { return attrs[key] ?? null; },
      addEventListener(name, listener) { this.listeners.set(name, listener); }, insertAdjacentHTML(_position, html) { this.innerHTML += html; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    };
  });
  const matches = (element, selector) => {
    if (selector.startsWith('#')) return element.id === selector.slice(1);
    const attribute = selector.match(/\[([^\]=]+)(?:="([^"]*)")?\]/);
    if (attribute && (element.attributes[attribute[1]] === undefined || (attribute[2] !== undefined && element.attributes[attribute[1]] !== attribute[2]))) return false;
    const className = selector.replace(/\[[^\]]*\]/g, '').match(/\.([\w-]+)/);
    if (className && !element.classList.contains(className[1])) return false;
    return Boolean(attribute || className);
  };
  const generated = new Map();
  const document = {
    title: '', body: elements.find(element => element.tagName === 'BODY'),
    querySelector(selector) {
      const element = elements.find(item => matches(item, selector));
      if (element) return element;
      if (selector.startsWith('#') && elements.some(item => item.innerHTML.includes(`id="${selector.slice(1)}"`))) {
        if (!generated.has(selector)) generated.set(selector, { dataset: {}, focus() {} });
        return generated.get(selector);
      }
      return null;
    },
    querySelectorAll: selector => elements.filter(element => matches(element, selector)), addEventListener() {},
  };
  return document;
}

async function runPortal(overrides = {}, failingContent = false, storageBlocked = false) {
  const document = createDom();
  const content = structuredClone(defaultSiteContent);
  Object.assign(content.values, overrides);
  const context = vm.createContext({
    document, serviceDefaults, defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds, searchContent, createI18n, languages,
    structuredClone, Intl, Date, clearTimeout() {}, setTimeout() { return 1; },
    window: { addEventListener() {}, scrollTo() {}, scrollY: 0 }, location: { hash: '' },
    localStorage: { getItem() { return null; } },
    fetch: async url => ({ ok: !(failingContent && url === '/api/site-content'), json: async () => url === '/api/site-content' ? { content } : { articles: [] } }),
  });
  if (storageBlocked) Object.defineProperty(context, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { document, context };
}

test('real portal initializes and applies server content without changing category routes', async () => {
  const { document, context } = await runPortal({ 'site.name': '测试联合政府', 'site.title': '测试门户', 'categories.政务要闻': '地区快讯', 'services.social-insurance.name': '居民保障' });
  assert.equal(document.title, '测试门户');
  assert.equal(document.querySelector('[data-content="site.name"]').textContent, '测试联合政府');
  assert.equal(document.querySelector('[data-news-tab="政务要闻"]').textContent, '地区快讯');
  assert.equal(document.querySelector('[data-news-tab="政务要闻"]').dataset.newsTab, '政务要闻');
  assert.match(document.querySelector('#service-grid').innerHTML, /居民保障/);
  vm.runInContext("openSearch('', '政务要闻')", context);
  assert.match(document.querySelector('#dialog-content').innerHTML, /地区快讯/);
  assert.match(document.querySelector('#dialog-content').innerHTML, /data-result-category="政务要闻"/);
});

test('a browser storage getter failure does not prevent the portal from initializing', async () => {
  const { document, context } = await runPortal({}, false, true);
  assert.equal(document.title, '晏阳联合政府网站');
  vm.runInContext("openInfo('网站帮助')", context);
  assert.match(document.querySelector('#dialog-content').innerHTML, /网站帮助/);
});

test('empty custom category names stay empty and configured markup renders as text', async () => {
  const { document, context } = await runPortal({ 'categories.政务要闻': '', 'services.social-insurance.name': '<img src=x onerror=alert(1)>', 'info.help.title': '<script>title</script>' });
  assert.equal(vm.runInContext("categoryName('政务要闻')", context), '');
  assert.ok(!document.querySelector('#service-grid').innerHTML.includes('<img src=x'));
  assert.match(document.querySelector('#service-grid').innerHTML, /&lt;img/);
  vm.runInContext("openInfo('网站帮助')", context);
  assert.match(document.querySelector('#dialog-content').innerHTML, /&lt;script&gt;title/);
});

test('content loading failure displays a message and leaves the current content intact', async () => {
  const { document } = await runPortal({}, true);
  assert.equal(document.title, '晏阳联合政府网站');
  assert.match(document.querySelector('#toast').textContent, /无法载入网站内容/);
});
