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
const storageKey = 'yunchuan-portal-local-messages';
const receipt = { id: 'feedback-accepted-1', type: 'suggestion', gameName: '方块玩家', qq: '123456789', title: '完善公共服务', content: '建议完善社区公共服务的引导标识。', createdAt: '2026-10-11T01:30:00.000Z', status: 'new' };

// Run the actual portal controller; the only replacements are the DOM,
// browser storage, and the HTTP boundary. Generated forms use shipped markup.
async function portal({ status = 201, error = '留言暂时无法提交', pending = false, storageFails = false, saved = [], overrides = {} } = {}) {
  let generated = [];
  const listeners = new Map();
  function parseNodes(html) {
    const nodes = [...html.matchAll(/<([\w-]+)\b([^>]*)>/g)].map(match => {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
      const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
      return {
        index: match.index, tagName: match[1].toUpperCase(), id: attrs.id || '', attributes: attrs,
        value: attrs.value || '', disabled: false, open: false, textContent: '', innerHTML: '', style: {}, listeners: new Map(),
        dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
        classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; } },
        setAttribute(key, value) { attrs[key] = String(value); }, getAttribute(key) { return attrs[key] ?? null; }, removeAttribute(key) { delete attrs[key]; },
        addEventListener(name, listener) { this.listeners.set(name, listener); }, insertAdjacentHTML(_position, html) { this.innerHTML += html; },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.listeners.get('close')?.(); },
        closest() { return this; }
      };
    });
    for (const form of nodes.filter(node => node.tagName === 'FORM')) {
      const end = html.indexOf('</form>', form.index);
      form.elements = nodes.filter(node => node.index > form.index && node.index < end && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(node.tagName));
      for (const field of form.elements) if (field.attributes.name) form.elements[field.attributes.name] = field;
      form.querySelectorAll = selector => form.elements.filter(node => selector.split(',').some(tag => node.tagName === tag.trim().toUpperCase()));
      for (const field of form.elements.filter(node => node.tagName === 'SELECT')) {
        const end = html.indexOf('</select>', field.index);
        field.value = /<option(?:\s+value="([^"]*)")?[^>]*>([^<]*)/.exec(html.slice(field.index, end))?.slice(1).find(value => value !== undefined) || '';
      }
    }
    return nodes;
  }
  const nodes = parseNodes(markup);
  const matches = (node, selector) => {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attribute = selector.match(/\[([^\]=]+)(?:="([^"]*)")?\]/);
    if (attribute && (node.attributes[attribute[1]] === undefined || (attribute[2] !== undefined && node.attributes[attribute[1]] !== attribute[2]))) return false;
    const className = selector.replace(/\[[^\]]*\]/g, '').match(/\.([\w-]+)/);
    if (className && !node.classList.contains(className[1])) return false;
    return Boolean(attribute || className);
  };
  const document = {
    title: '', body: nodes.find(node => node.tagName === 'BODY'),
    querySelector: selector => [...generated, ...nodes].find(node => matches(node, selector)) || null,
    querySelectorAll: selector => [...nodes, ...generated].filter(node => matches(node, selector)),
    addEventListener: (event, handler) => listeners.set(event, handler)
  };
  const dialogContent = document.querySelector('#dialog-content');
  let dialogHtml = '';
  Object.defineProperty(dialogContent, 'innerHTML', { get: () => dialogHtml, set(value) { dialogHtml = value; generated = parseNodes(value); } });
  const content = structuredClone(defaultSiteContent);
  Object.assign(content.values, overrides);
  const storage = new Map([[storageKey, JSON.stringify(saved)]]);
  const requests = [];
  let resolveResponse;
  const responseReady = pending ? new Promise(resolve => { resolveResponse = resolve; }) : Promise.resolve();
  const windowListeners = new Map();
  const context = vm.createContext({
    document, serviceDefaults, defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds, searchContent, createI18n, languages,
    structuredClone, Intl, Date, clearTimeout() {}, setTimeout() { return 1; }, location: { hash: '' },
    window: { addEventListener: (event, handler) => windowListeners.set(event, handler), scrollTo() {}, scrollY: 0 },
    localStorage: { getItem: key => storage.get(key) || null, setItem(key, value) { if (storageFails) throw new Error('storage unavailable'); storage.set(key, value); } },
    fetch: async (url, options = {}) => {
      if (url === '/api/site-content') return { ok: true, status: 200, json: async () => ({ content }) };
      if (url === '/api/articles') return { ok: true, status: 200, json: async () => ({ articles: [] }) };
      requests.push({ url, method: options.method || 'GET', headers: options.headers, input: options.body ? JSON.parse(options.body) : undefined });
      await responseReady;
      return { ok: status >= 200 && status < 300, status, json: async () => status === 201 ? { feedback: receipt } : { message: error } };
    }
  });
  const run = code => vm.runInContext(code, context);
  run(source);
  await new Promise(resolve => setImmediate(resolve));
  run('openMessageForm()');
  const form = document.querySelector('#message-form');
  if (form.elements.gameName) form.elements.gameName.value = receipt.gameName;
  if (form.elements.qq) form.elements.qq.value = receipt.qq;
  form.elements.title.value = receipt.title;
  form.elements.content.value = receipt.content;
  return { document, form, requests, storage, run, submit: () => run("saveMessage(document.querySelector('#message-form'))"), resubmitCaptured: () => { context.capturedForm = form; return run('saveMessage(capturedForm)'); }, finish: () => resolveResponse?.(), windowListeners };
}

// Local-only saves or accepting arbitrary 2xx status must not report submission.
test('submits visitor feedback to the server and displays its real receipt only after HTTP 201', async () => {
  const site = await portal();
  await site.submit();
  assert.equal(site.requests.length, 1);
  assert.equal(site.requests[0].url, '/api/feedback');
  assert.equal(site.requests[0].method, 'POST');
  assert.equal(site.requests[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(site.requests[0].input, { type: 'suggestion', gameName: receipt.gameName, qq: receipt.qq, title: receipt.title, content: receipt.content });
  assert.match(site.document.querySelector('#dialog-content').innerHTML, /留言提交成功/);
  assert.match(site.document.querySelector('#dialog-content').innerHTML, /feedback-accepted-1/);
  const saved = JSON.parse(site.storage.get(storageKey));
  assert.equal(saved[0].submitted, true);
  assert.equal(saved[0].id, receipt.id);
});

// Removing either identity input or native constraints must make this fail.
test('the shared message form exposes required game name and numeric QQ fields', async () => {
  const site = await portal();
  assert.ok(site.form.elements.gameName, 'game name field exists');
  assert.ok(site.form.elements.qq, 'QQ field exists');
  const html = site.document.querySelector('#dialog-content').innerHTML;
  assert.match(html, /<input[^>]*name="gameName"[^>]*required/);
  assert.match(html, /<input[^>]*name="qq"[^>]*required/);
  assert.equal(site.form.elements.qq.getAttribute('inputmode'), 'numeric');
  assert.equal(site.form.elements.qq.getAttribute('maxlength'), '12');
});

// Missing/invalid identity must never reach HTTP, regardless of feedback type.
test('all message types reject blank game names and invalid QQ without losing the draft', async () => {
  for (const type of ['suggestion', 'consultation', 'feedback']) {
    for (const invalid of [{ gameName: '' }, { gameName: '   ' }, { gameName: '名'.repeat(41) }, { qq: '' }, { qq: '1234' }, { qq: '012345' }, { qq: '12345a' }, { qq: '1234567890123' }]) {
      const site = await portal();
      assert.ok(site.form.elements.gameName && site.form.elements.qq, 'identity fields exist');
      site.form.elements.type.value = type;
      for (const [field, value] of Object.entries(invalid)) site.form.elements[field].value = value;
      await site.submit();
      assert.equal(site.requests.length, 0, `${type} ${JSON.stringify(invalid)}`);
      assert.equal(site.form.elements.title.value, receipt.title);
      assert.equal(site.form.elements.content.value, receipt.content);
      assert.ok(site.document.querySelector('#message-error').textContent);
      assert.equal(site.document.querySelector('#message-form'), site.form);
    }
  }
});

test('trimmed game names and QQ boundaries are sent under stable field names', async () => {
  for (const qq of ['12345', '123456789012']) {
    const site = await portal({ overrides: { 'message.gameNameLabel': '玩家角色', 'message.qqLabel': '联系号码' } });
    assert.ok(site.form.elements.gameName && site.form.elements.qq, 'identity fields exist');
    site.form.elements.gameName.value = '  ' + '名'.repeat(40) + '  ';
    site.form.elements.qq.value = ` ${qq} `;
    await site.submit();
    assert.equal(site.requests.length, 1);
    assert.equal(site.requests[0].input.gameName, '名'.repeat(40));
    assert.equal(site.requests[0].input.qq, qq);
  }
});

// A receipt cache failure must not encourage retrying an already-durable write.
test('a local receipt storage failure still reports successful submission and cannot submit the same form twice', async () => {
  const site = await portal({ storageFails: true });
  await site.submit();
  assert.equal(site.requests.length, 1);
  assert.match(site.document.querySelector('#dialog-content').innerHTML, /留言提交成功/);
  assert.match(site.document.querySelector('#dialog-content').innerHTML, /无需再次提交/);
  // The old form is no longer the current screen, even if a second event was queued.
  await site.resubmitCaptured();
  assert.equal(site.requests.length, 1);
});

// HTTP failures must leave the draft editable rather than clearing it or lying.
test('HTTP 400, 429 and 500 preserve the draft and show the server error', async () => {
  for (const status of [400, 429, 500]) {
    const site = await portal({ status, error: `服务器拒绝 ${status}` });
    await site.submit();
    assert.equal(site.document.querySelector('#message-form'), site.form);
    assert.equal(site.form.elements.title.value, receipt.title);
    assert.equal(site.form.elements.content.value, receipt.content);
    assert.equal(site.form.elements.gameName.value, receipt.gameName);
    assert.equal(site.form.elements.qq.value, receipt.qq);
    assert.equal(site.document.querySelector('#message-error').textContent, `服务器拒绝 ${status}`);
    assert.equal(site.form.elements.find(node => node.tagName === 'BUTTON').disabled, false);
    assert.doesNotMatch(site.document.querySelector('#dialog-content').innerHTML, /success-panel/);
    assert.deepEqual(JSON.parse(site.storage.get(storageKey)), []);
  }
});

// Translating editable labels must not change the stable API type identifier.
test('custom type labels retain stable server identifiers', async () => {
  const site = await portal({ overrides: { 'message.typeSuggestion': '自定义民生提案', 'message.typeConsultation': '自定义咨询', 'message.typeFeedback': '自定义反馈' } });
  assert.equal(site.form.elements.type.value, 'suggestion');
  assert.match(site.document.querySelector('#dialog-content').innerHTML, /value="consultation">自定义咨询/);
  site.form.elements.type.value = 'consultation';
  await site.submit();
  assert.equal(site.requests[0].input.type, 'consultation');
});

// An in-flight double click must create one record while freezing its input.
test('pending feedback disables input and prevents duplicate submissions', async () => {
  const site = await portal({ pending: true });
  const first = site.submit();
  try {
    assert.ok(site.form.elements.every(node => node.disabled));
    await site.submit();
    assert.equal(site.requests.length, 1);
  } finally { site.finish(); await first; }
});

// A request can complete after closing, replacing, or navigating from its form.
test('late feedback responses cannot overwrite a new dialog or a reopened draft', async () => {
  for (const navigation of ['reopen', 'info', 'hash']) {
    const site = await portal({ pending: true });
    const submitting = site.submit();
    if (navigation === 'hash') {
      site.run("location.hash = '#news'");
      site.windowListeners.get('hashchange')();
    } else site.run(navigation === 'reopen' ? 'closeDialog(); openMessageForm()' : "openInfo('联系我们')");
    const previous = site.document.querySelector('#dialog-content').innerHTML;
    site.finish(); await submitting;
    assert.equal(site.document.querySelector('#dialog-content').innerHTML, previous, navigation);
    assert.doesNotMatch(site.document.querySelector('#dialog-content').innerHTML, /success-panel/);
  }
});

// Existing local records must remain unsent and visibly distinct from receipts.
test('history labels legacy records as local and never uploads them automatically', async () => {
  const legacy = { id: 'YY-old-local', type: '意见建议', title: '旧的本地留言', content: '旧内容只存在此浏览器，不应自动发送。', date: '2026/10/10 09:00:00' };
  const site = await portal({ saved: [legacy] });
  assert.equal(site.requests.length, 0);
  await site.submit();
  site.run('openMessages()');
  const history = site.document.querySelector('#dialog-content').innerHTML;
  assert.match(history, /本地未提交/);
  assert.match(history, /已提交/);
  assert.match(history, /旧的本地留言/);
  assert.equal(site.requests.length, 1);
});

test('a successful-looking HTTP 200 cannot be reported as a submitted record', async () => {
  const site = await portal({ status: 200 });
  await site.submit();
  assert.equal(site.document.querySelector('#message-form'), site.form);
  assert.doesNotMatch(site.document.querySelector('#dialog-content').innerHTML, /success-panel/);
  assert.notEqual(site.document.querySelector('#message-error').textContent, '');
});
