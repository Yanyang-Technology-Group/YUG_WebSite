import { contentFields, defaultSiteContent, getContentText } from './site-content-schema.js';

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function createContentDraft(content, persist) {
  let current = structuredClone(content);
  let saved = JSON.stringify(current.values);
  let busy = false;
  return {
    get busy() { return busy; },
    get dirty() { return JSON.stringify(current.values) !== saved; },
    get: key => current.values[key],
    snapshot: () => structuredClone(current),
    set(key, value) {
      if (busy) throw new Error('正在保存，请稍候。');
      if (!Object.hasOwn(current.values, key)) throw new Error('未知的网站内容字段。');
      current.values[key] = String(value);
    },
    async save() {
      if (busy) throw new Error('正在保存，请稍候。');
      busy = true;
      try {
        current = structuredClone(await persist(structuredClone(current)));
        saved = JSON.stringify(current.values);
        return structuredClone(current);
      } finally { busy = false; }
    }
  };
}

export function createWebsiteContentEditor({ api, toast, openModal, closeModal, onContentChanged, onBusyChange }) {
  const $ = selector => document.querySelector(selector);
  const editableFields = contentFields.filter(field => !field.retired);
  const groups = [...new Set(editableFields.map(field => field.group))];
  let draft = null;
  let group = groups[0];
  let query = '';
  let loaded = false;
  let loading = false;
  let loadTask = null;
  let generation = 0;

  function render() {
    $('#site-groups').innerHTML = groups.map(name => `<button type="button" data-content-group="${escapeText(name)}" class="content-group ${name === group && !query ? 'active' : ''}" aria-pressed="${name === group && !query}">${escapeText(name)}</button>`).join('');
    const fields = editableFields.filter(field => query ? [field.group, field.label, draft?.get(field.key) || ''].join(' ').toLowerCase().includes(query.toLowerCase()) : field.group === group);
    $('#site-region-title').textContent = query ? `搜索结果 · ${fields.length} 项` : group;
    $('#site-fields').innerHTML = fields.map(field => {
      const value = draft ? draft.get(field.key) : field.defaultValue;
      const id = `content-${field.key}`;
      const attributes = `id="${escapeText(id)}" data-content-key="${escapeText(field.key)}" maxlength="${field.maxLength}" ${!draft || draft.busy || loading ? 'disabled' : ''}`;
      return `<label class="content-field" for="${escapeText(id)}"><span>${escapeText(field.label)}${query ? `<small>${escapeText(field.group)}</small>` : ''}</span>${field.type === 'textarea' ? `<textarea ${attributes} rows="5">${escapeText(value)}</textarea>` : `<input ${attributes} type="text" value="${escapeText(value)}">`}<small>最多 ${field.maxLength} 字${field.type === 'textarea' ? ' · 空行分段，列表每行一项' : ''}</small></label>`;
    }).join('') || '<p class="empty-state">没有找到相关字段，请换一个关键词。</p>';
    $('#site-save').disabled = !draft || draft.busy || loading;
    $('#site-retry').disabled = !!draft?.busy || loading;
    $('#site-reset-group').disabled = !draft || draft.busy || loading || !!query;
    updateStatus();
  }

  function updateStatus() {
    $('#site-edit-status').textContent = loading ? '正在加载网站内容…' : draft?.busy ? '正在保存，请稍候…' : draft?.dirty ? '有未保存的修改' : draft ? '所有修改已保存' : '尚未加载网站内容';
  }

  async function load() {
    if (loaded) return;
    if (loading) return loadTask;
    loading = true;
    const expectedGeneration = generation;
    $('#site-error').textContent = '';
    render();
    loadTask = (async () => {
      try {
        const result = await api('/api/admin/site-content');
        if (generation !== expectedGeneration) return;
        draft = createContentDraft(result.content, async content => (await api('/api/admin/site-content', { method: 'PUT', data: content })).content);
        loaded = true;
        onContentChanged(result.content);
      } catch (error) {
        if (generation === expectedGeneration) $('#site-error').textContent = error.message;
      } finally {
        if (generation === expectedGeneration) { loading = false; loadTask = null; render(); }
      }
    })();
    return loadTask;
  }

  async function loadPublic() {
    try { onContentChanged((await api('/api/site-content')).content); }
    catch { /* The login page keeps its local site name if the public config is unavailable. */ }
  }

  $('#site-content-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft || draft.busy || loading) return;
    $('#site-error').textContent = '';
    const controls = [...document.querySelectorAll('#site-content-view input, #site-content-view textarea, #site-content-view button')].map(control => ({ control, disabled: control.disabled }));
    controls.forEach(({ control }) => { control.disabled = true; });
    onBusyChange(true);
    $('#site-edit-status').textContent = '正在保存，请稍候…';
    try {
      const content = await draft.save();
      onContentChanged(content);
      toast('网站内容已保存，刷新网站即可查看。');
    } catch (error) { $('#site-error').textContent = error.message; }
    finally {
      onBusyChange(false);
      controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
      updateStatus();
    }
  });
  $('#site-fields').addEventListener('input', event => {
    const key = event.target.dataset.contentKey;
    if (!draft || draft.busy || loading || !key) return;
    draft.set(key, event.target.value);
    $('#site-error').textContent = '';
    updateStatus();
  });
  $('#site-groups').addEventListener('click', event => {
    const button = event.target.closest('[data-content-group]');
    if (!button || draft?.busy) return;
    group = button.dataset.contentGroup;
    query = ''; $('#site-field-search').value = '';
    render();
  });
  $('#site-field-search').addEventListener('input', event => { query = event.target.value.trim(); render(); });
  $('#site-retry').addEventListener('click', () => {
    if (draft?.busy || loading) return;
    const reload = async () => { loaded = false; closeModal(); await load(); };
    if (draft?.dirty) openModal('重新加载', '<h2 id="modal-title">放弃修改并重新加载？</h2><p>尚未保存的内容会被服务器上的已保存内容替换。</p><div class="modal-actions"><button class="button" data-modal-cancel>继续编辑</button><button class="button button-primary" data-modal-confirm>重新加载</button></div>', reload);
    else return reload();
  });
  $('#site-reset-group').addEventListener('click', () => {
    if (!draft || draft.busy || query) return;
    openModal('恢复区域默认内容', `<h2 id="modal-title">恢复“${escapeText(group)}”的默认文字？</h2><p>当前区域的修改将被默认内容替换。点击保存后才会更新网站。</p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button button-primary" data-modal-confirm>恢复默认</button></div>`, async () => {
      for (const field of editableFields.filter(item => item.group === group)) draft.set(field.key, defaultSiteContent.values[field.key]);
      closeModal(); render();
    });
  });
  render();
  return {
    load, loadPublic,
    get dirty() { return !!draft?.dirty; },
    get busy() { return !!draft?.busy; },
    categoryLabel(name) { return draft ? getContentText(draft.snapshot(), `categories.${name}`) : name; },
    clear() { generation++; draft = null; loaded = false; loading = false; loadTask = null; render(); },
    discard() { generation++; draft = null; loaded = false; loading = false; loadTask = null; render(); },
  };
}
