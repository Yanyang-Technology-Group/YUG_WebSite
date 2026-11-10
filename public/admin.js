import { createWebsiteContentEditor } from './admin-site-content.js';
import { createAdminManagement } from './admin-management.js';
import { createTranslationSettingsEditor } from './admin-translation.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const categories = ['政务要闻', '通知公告', '政策文件', '政策解读', '部门动态', '民生资讯'];
let session = null;
let articles = [];
let selectedStatus = 'all';
let editingId = null;
let dirty = false;
let currentView = 'welcome';
let toastTimeout;
let mutationBusy = false;
let modalAction = null;
const dialog = $('#admin-dialog');
let websiteContent = null;
let siteEditor;
let navigationLocks = [];
let workspaceUsername = null;
let sessionGeneration = 0;
let connectionGeneration = 0;
let management;
let translationSettings;
let welcomeTransitionTimer;
let welcomeTransitionSession = null;
let welcomeTransitionRun = 0;
let translationInfo = null;
let translationPollTimer = null;
let translationPollBusy = false;
const translationLanguages = ['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'];
const isSuperadmin = () => session?.authenticated && (session.role || 'superadmin') === 'superadmin';
const isPrivilegedAdmin = () => session?.authenticated && ['senioradmin', 'superadmin'].includes(session.role || 'superadmin');
const viewNames = ['welcome', 'posts', 'editor', 'requests', 'feedback', 'users', 'logs', 'site-content', 'translation-settings', 'account'];
const canView = view => session?.authenticated && viewNames.includes(view) && (isPrivilegedAdmin() || ['welcome', 'posts', 'editor', 'requests', 'feedback', 'account'].includes(view));
const categoryLabel = name => websiteContent?.values?.[`categories.${name}`] ?? name;

function staleResponse() { return Object.assign(new Error('登录状态已改变，请重试。'), { stale: true }); }
function setSession(value) { session = value; sessionGeneration++; }
function clearWorkspace({ retainWebsiteDraft = false } = {}) {
  sessionGeneration++;
  clearTimeout(translationPollTimer); translationPollTimer = null; translationInfo = null; translationPollBusy = false;
  dismissWelcomeTransition({ reveal: false });
  articles = []; editingId = null; dirty = false; selectedStatus = 'all'; mutationBusy = false;
  management?.clear();
  translationSettings?.clear();
  if (!retainWebsiteDraft) { siteEditor.clear(); workspaceUsername = null; }
  $('#post-form').reset(); $('#password-form').reset(); $('#post-table').innerHTML = ''; $('#post-search').value = ''; $('#post-category-filter').value = '';
  $$('#post-form input, #post-form select, #post-form textarea, #post-form button, #password-form input, #password-form button, #back-posts, #preview-post, #logout, [data-view]').forEach(control => { control.disabled = false; });
  $('#account-label').textContent = ''; $('#account-username').textContent = ''; $('#account-role').textContent = '';
  $('#welcome-username').textContent = ''; $('#welcome-role').textContent = ''; $('#welcome-description').textContent = ''; $('#welcome-date').textContent = '';
  $('#welcome-date').dateTime = '';
  for (const name of ['published', 'draft', 'scheduled']) $(`#welcome-${name}`).textContent = 0;
  $('#welcome-view').classList.remove('welcome-enter');
  $('#editor-error').textContent = ''; $('#password-error').textContent = ''; $('#save-status').textContent = '';
  clearTimeout(toastTimeout); $('#admin-toast').textContent = ''; $('#admin-toast').classList.remove('visible');
  $('#workspace').hidden = true; $('#account-label').hidden = true; $('#account-role').hidden = true; $('#logout').hidden = true;
  if (dialog.open) closeModal();
  $('#modal-content').innerHTML = '';
}

function updatePermissions() {
  const privileged = isPrivilegedAdmin();
  const superadmin = isSuperadmin();
  const senioradmin = privileged && !superadmin;
  $$('[data-view]').forEach(button => { button.hidden = !canView(button.dataset.view); });
  $('#account-role').hidden = false;
  $('#account-role').textContent = superadmin ? '超级管理员' : senioradmin ? '高级管理员' : '普通管理员';
  $('#account-role').classList.toggle('role-superadmin', superadmin);
  $('#account-role').classList.toggle('role-senioradmin', senioradmin);
  $('#account-role-description').textContent = superadmin ? '超级管理员：可管理全站内容、审批和管理员账号，并调整其他账号的等级。' : senioradmin ? '高级管理员：可管理全站内容、审批和非超级管理员账号；现有账号等级仅由超级管理员调整。' : '普通管理员：新文章发布和删除文章均须高级或超级管理员审批。';
  $('#approval-notice').hidden = privileged;
  $('#save-draft').hidden = !privileged;
  $('#draft-stat').hidden = !privileged;
  $('#scheduled-stat').hidden = !privileged;
  $$('[data-status="draft"], [data-status="scheduled"]').forEach(button => { button.hidden = !privileged; });
  $('#article-stats').classList.toggle('stats-published-only', !privileged);
  $('#editor-description').textContent = privileged ? '填写文章信息，保存草稿、立即发布或定时发布。' : '提交新文章后，由高级或超级管理员审批通过再按发布时间公开。';
  updatePublishSettings();
  $('#requests-title').textContent = privileged ? '内容审批' : '我的申请';
  $('#requests-description').textContent = privileged ? '查看文章内容，处理发布和删除申请。' : '查看您提交的发布和删除申请及处理结果。';
  $$('[data-requests-label]').forEach(label => { label.textContent = privileged ? '内容审批' : '我的申请'; });
  management?.updatePermissions?.();
  renderWelcome();
}

function renderWelcome() {
  if (!session?.authenticated) return;
  const privileged = isPrivilegedAdmin();
  $('#welcome-username').textContent = session.username;
  $('#welcome-role').textContent = isSuperadmin() ? '超级管理员' : privileged ? '高级管理员' : '普通管理员';
  $('#welcome-description').textContent = privileged ? '管理网站内容、处理发布审批，或查看访客的意见反馈。选择一项工作开始。' : '提交文章发布与删除申请，查看审批进度和访客留言。文章经审批通过后才会公开。';
  const now = new Date();
  $('#welcome-date').textContent = `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full' }).format(now)} · 北京时间`;
  $('#welcome-date').dateTime = today();
  $('#welcome-published').textContent = articles.filter(article => article.status === 'published').length;
  $('#welcome-draft').textContent = privileged ? articles.filter(article => article.status === 'draft').length : 0;
  $('#welcome-scheduled').textContent = privileged ? articles.filter(article => article.status === 'scheduled').length : 0;
  $('#welcome-draft-stat').hidden = !privileged;
  $('#welcome-scheduled-stat').hidden = !privileged;
}

function dismissWelcomeTransition({ reveal = true } = {}) {
  clearTimeout(welcomeTransitionTimer);
  welcomeTransitionTimer = null;
  welcomeTransitionRun++;
  const revealWelcome = reveal && welcomeTransitionSession === sessionGeneration && session?.authenticated && currentView === 'welcome';
  welcomeTransitionSession = null;
  const transition = $('#welcome-transition');
  if (transition.open) transition.close();
  $('#transition-username').textContent = '';
  $('#transition-role').textContent = '';
  if (revealWelcome) {
    $('#welcome-view').classList.add('welcome-enter');
    $('#welcome-title').focus({ preventScroll: true });
  }
}

function playWelcomeTransition() {
  dismissWelcomeTransition({ reveal: false });
  if (!session?.authenticated || currentView !== 'welcome' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  $('#welcome-view').classList.remove('welcome-enter');
  $('#transition-username').textContent = session.username;
  $('#transition-role').textContent = $('#welcome-role').textContent;
  welcomeTransitionSession = sessionGeneration;
  const expectedSession = sessionGeneration;
  const expectedRun = ++welcomeTransitionRun;
  $('#welcome-transition').showModal();
  $('#transition-enter').focus({ preventScroll: true });
  welcomeTransitionTimer = setTimeout(() => {
    if (expectedRun === welcomeTransitionRun && expectedSession === sessionGeneration) dismissWelcomeTransition();
  }, 2400);
  return true;
}

function toast(message) {
  clearTimeout(toastTimeout);
  $('#admin-toast').textContent = message;
  $('#admin-toast').classList.add('visible');
  toastTimeout = setTimeout(() => $('#admin-toast').classList.remove('visible'), 3300);
}

async function api(url, { method = 'GET', data } = {}) {
  if (session?.authenticated && !isPrivilegedAdmin() && url.startsWith('/api/admin/')) {
    const allowed = ['/api/admin/session', '/api/admin/logout', '/api/admin/password'].includes(url) || (['/api/admin/requests', '/api/admin/translation'].includes(url) && method === 'GET') || (/^\/api\/admin\/feedback(?:\?[^#]*)?$/.test(url) && method === 'GET') || (/^\/api\/admin\/feedback\/[^/?]+$/.test(url) && method === 'PATCH') || (url === '/api/admin/articles' && ['GET', 'POST'].includes(method)) || (/^\/api\/admin\/articles\/[^/]+$/.test(url) && method === 'DELETE');
    if (!allowed) throw new Error('您没有此操作的权限。');
  }
  const expectedGeneration = sessionGeneration;
  let response;
  try {
    response = await fetch(url, { method, credentials: 'same-origin', headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(url === '/api/admin/setup' && session?.runtime === 'cloudflare-pages' ? { 'X-Setup-Token': $('#setup-token')?.value || '' } : {}), ...(method !== 'GET' && session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  } catch { if (expectedGeneration !== sessionGeneration) throw staleResponse(); throw new Error('无法连接管理服务，请确认网站仍在运行。'); }
  const result = await response.json().catch(() => null);
  if (expectedGeneration !== sessionGeneration) throw staleResponse();
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const hint = response.status === 404 ? '后台 API 不存在（HTTP 404）。请重新上传完整 out 文件夹，确认包含 _worker.js 和 _routes.json；并启用 nodejs_compat、绑定 D1 数据库 DB。' : '后台未返回有效 JSON（HTTP ' + response.status + '），请检查 Cloudflare Functions 运行日志和数据库绑定。';
    throw new Error(hint);
  }
  if (!response.ok) {
    if (response.status === 401 && session?.authenticated && !url.endsWith('/password')) {
      clearWorkspace({ retainWebsiteDraft: true });
      setSession(null);
      await connect();
      toast('登录已过期，请重新登录。');
    }
    throw new Error(result.message || '操作未完成（HTTP ' + response.status + '），请检查后台服务后重试。');
  }
  return result;
}

async function connect() {
  const expectedConnection = ++connectionGeneration;
  $('#retry-connect').hidden = true;
  try {
    const connected = await api('/api/admin/session');
    if (expectedConnection !== connectionGeneration) return;
    setSession(connected);
    const expectedSession = sessionGeneration;
    await siteEditor.loadPublic();
    if (expectedConnection !== connectionGeneration || expectedSession !== sessionGeneration) return;
    if (session.authenticated) { await enterWorkspace(); return; }
    $('#workspace').hidden = true;
    $('#auth-view').hidden = false;
    $('#account-label').hidden = true;
    $('#account-role').hidden = true;
    $('#logout').hidden = true;
    const setup = session.setupRequired;
    if ($('#setup-token-label')) $('#setup-token-label').hidden = !(setup && session.runtime === 'cloudflare-pages');
    if ($('#setup-token')) $('#setup-token').required = setup && session.runtime === 'cloudflare-pages';
    $('#auth-title').textContent = setup ? '设置管理员' : '欢迎回来';
    $('#auth-description').textContent = setup ? '首次使用，请创建您的管理账号和密码。' : '登录后即可发布文章和管理网站。';
    $('#auth-submit').textContent = setup ? '创建账号并进入' : '进入管理模式';
    $('#confirm-label').hidden = !setup;
    $('#password-confirm').required = setup;
    $('#password').autocomplete = setup ? 'new-password' : 'current-password';
    $('#auth-form').hidden = setup && !session.setupAllowed;
    if (setup && !session.setupAllowed) {
      $('#auth-description').textContent = session.runtime === 'cloudflare-pages' ? '请先在 Pages 配置至少 32 位的 SETUP_TOKEN 密钥，并重新部署，然后创建超级管理员。' : '请先在部署网站的电脑上打开管理模式，设置管理员账号。';
      $('#retry-connect').hidden = false;
    }
  } catch (error) {
    if (error.stale || expectedConnection !== connectionGeneration) return;
    $('#auth-title').textContent = '管理服务未连接';
    $('#auth-description').textContent = error.message;
    $('#auth-form').hidden = true;
    $('#retry-connect').hidden = false;
  }
}

async function loadArticles() {
  const expectedGeneration = sessionGeneration;
  const result = await api('/api/admin/articles');
  if (expectedGeneration !== sessionGeneration) throw staleResponse();
  articles = isPrivilegedAdmin() ? result.articles : result.articles.filter(article => article.status === 'published');
  renderArticles();
  scheduleTranslationRefresh();
}

function renderTranslationEngine() {
  const ready = translationInfo?.available === true;
  if (session?.runtime === 'cloudflare-pages' || translationInfo?.runtime === 'cloudflare-pages') {
    const offlineOption = $('#translation-provider option[value="offline"]');
    if (offlineOption) { offlineOption.disabled = true; offlineOption.hidden = true; }
    const fallback = $('#translation-fallback');
    if (fallback) { fallback.checked = false; fallback.closest('label').hidden = true; }
    $('#translation-engine-status').textContent = ready ? '在线翻译已配置 · 分批生成 11 种语言' : '请在翻译设置中配置在线服务；文章可正常发布。';
    $('#post-translation-help').textContent = '文章公开后分语言生成译文，访问网站或管理页时继续处理。失败后可重试；此部署不提供本机离线模型。';
    return;
  }
  const description = translationInfo === null ? '正在检查翻译服务…' : translationInfo.onlineAvailable ? `联网翻译已配置${translationInfo.offlineAvailable ? ' · 离线模型可回退' : ''} · 自动处理 11 种语言` : translationInfo.offlineAvailable ? '在线服务未配置 · 使用离线模型翻译 11 种语言' : '在线服务未配置，离线翻译组件也未就绪。文章仍可正常发布。';
  $('#translation-engine-status').textContent = description;
  $('#translation-engine-status').classList.toggle('translation-unavailable', translationInfo !== null && !ready);
  $('#post-translation-help').textContent = translationInfo?.onlineAvailable ? '文章公开后优先使用联网翻译；单种语言失败时由离线模型补齐。可在“翻译设置”中配置 DeepL API 密钥或 AI 大模型密钥，密钥不会进入文章、日志或部署包。审批和定时发布规则照常生效。' : translationInfo && !translationInfo.offlineAvailable ? '在线翻译服务尚未配置。文章仍可正常发布；可在“翻译设置”中配置 DeepL API 密钥或 AI 大模型，或安装离线翻译模型后生成译文。' : '文章公开后优先使用已配置的联网服务，在线失败时由本机离线模型补齐其他 11 种语言。可在“翻译设置”中配置 DeepL API 密钥或 AI 大模型；审批和定时发布规则照常生效。';
}

async function loadTranslationInfo() {
  const expectedGeneration = sessionGeneration;
  try {
    const result = await api('/api/admin/translation');
    if (expectedGeneration !== sessionGeneration) return;
    translationInfo = { runtime: result.runtime, available: result.available === true, onlineAvailable: result.onlineAvailable === true, offlineAvailable: result.offlineAvailable ?? result.available === true, provider: result.provider || 'offline', activeArticleId: result.activeArticleId || null };
  } catch (error) {
    if (error.stale || expectedGeneration !== sessionGeneration) return;
    translationInfo = { available: false, onlineAvailable: false, offlineAvailable: false, activeArticleId: null };
  }
  renderTranslationEngine();
  renderArticles();
  scheduleTranslationRefresh();
}

function scheduleTranslationRefresh() {
  clearTimeout(translationPollTimer); translationPollTimer = null;
  if (!session?.authenticated || translationPollBusy || (!translationInfo?.activeArticleId && !articles.some(article => ['pending', 'translating'].includes(article.translation?.status)))) return;
  const expectedGeneration = sessionGeneration;
  translationPollTimer = setTimeout(async () => {
    if (expectedGeneration !== sessionGeneration || !session?.authenticated) return;
    translationPollBusy = true;
    try { await Promise.all([loadArticles(), loadTranslationInfo()]); }
    catch { /* A later refresh can recover without interrupting an open editor. */ }
    finally { translationPollBusy = false; if (expectedGeneration === sessionGeneration) scheduleTranslationRefresh(); }
  }, 4000);
}

function articleTranslationState(article) {
  const count = translationLanguages.filter(code => {
    const locale = article.translation?.locales?.[code];
    return locale && typeof locale.title === 'string' && Array.isArray(locale.body) && locale.body.length;
  }).length;
  const status = article.translation?.status;
  const running = ['pending', 'translating'].includes(status);
  const label = status === 'translating' ? '正在自动翻译' : status === 'pending' ? '等待自动翻译' : status === 'failed' ? (count === 11 ? '译文已保存，任务失败' : '翻译未完成') : count === 11 ? '翻译完成' : article.autoTranslate ? (article.status === 'published' ? '等待自动翻译' : '发布后自动翻译') : '未启用自动翻译';
  const retry = isPrivilegedAdmin() && article.status === 'published' && (count < 11 || ['completed', 'failed'].includes(status)) && !running;
  const retryLabel = status === 'completed' ? '重新翻译' : count || status === 'failed' ? '重试翻译' : '生成译文';
  const failureNote = count === 11 ? '已保存的译文仍可使用，可重新运行翻译。' : '已有译文可用，可重新生成缺失译文。';
  return `<div class="translation-state${status === 'failed' ? ' translation-failed' : ''}"${running ? ' role="status"' : ''}><span>${label}</span><small>${count} / 11 种语言</small>${status === 'failed' ? `<small>${failureNote}</small>` : ''}</div>${retry ? `<button class="translation-retry" data-translate="${escape(article.id)}"${translationInfo?.available !== true ? ' disabled title="请先配置联网服务或安装离线翻译模型"' : ''}>${retryLabel}</button>` : ''}`;
}

async function translateArticle(id) {
  if (!isPrivilegedAdmin() || mutationBusy || translationInfo?.available !== true) return;
  const article = articles.find(item => item.id === id);
  if (!article || article.status !== 'published') return;
  const expectedGeneration = sessionGeneration;
  mutationBusy = true;
  try {
    const result = await api(`/api/admin/articles/${id}/translate`, { method: 'POST', data: {} });
    if (expectedGeneration !== sessionGeneration) return;
    articles = articles.map(item => item.id === id ? result.article : item);
    renderArticles(); scheduleTranslationRefresh();
    toast('已加入自动翻译队列，译文完成后自动显示。');
  } catch (error) { if (!error.stale && expectedGeneration === sessionGeneration) toast(error.message); }
  finally { if (expectedGeneration === sessionGeneration) mutationBusy = false; }
}

async function enterWorkspace({ animate = false } = {}) {
  const expectedGeneration = sessionGeneration;
  const retainedWebsiteDraft = isPrivilegedAdmin() && siteEditor.dirty && workspaceUsername === (session.userId || session.username);
  if (!retainedWebsiteDraft) siteEditor.clear();
  management?.clear();
  workspaceUsername = session.userId || session.username;
  await loadArticles();
  if (expectedGeneration !== sessionGeneration) return;
  updatePermissions();
  $('#auth-view').hidden = true;
  $('#workspace').hidden = false;
  $('#account-label').hidden = false;
  $('#account-label').textContent = session.username;
  $('#account-username').textContent = session.username;
  $('#logout').hidden = false;
  $('#auth-form').reset();
  $('#auth-error').textContent = '';
  showView(retainedWebsiteDraft ? 'site-content' : 'welcome');
  renderTranslationEngine();
  void loadTranslationInfo();
  if (animate && !retainedWebsiteDraft && !playWelcomeTransition()) $('#welcome-view').classList.add('welcome-enter');
  if (retainedWebsiteDraft) toast('已保留尚未保存的网站内容，请继续编辑或保存。');
}

function showView(view) {
  if (!canView(view)) { if (session?.authenticated) toast('您没有此页面的权限。'); return; }
  dismissWelcomeTransition({ reveal: false });
  currentView = view;
  $('#welcome-view').classList.remove('welcome-enter');
  for (const name of viewNames) $(`#${name}-view`).hidden = name !== view;
  $$('[data-view]').forEach(button => {
    const active = button.dataset.view === view || (view === 'editor' && button.dataset.view === 'posts');
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (view === 'welcome') renderWelcome();
  const title = view === 'welcome' ? $('#welcome-title') : $(`#${view}-view h1`);
  if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  if (view === 'site-content') siteEditor.load();
  if (view === 'requests') management.loadRequests();
  if (view === 'users') management.loadUsers();
  if (view === 'logs') management.loadLogs();
  if (view === 'feedback') management.loadFeedback();
  if (view === 'translation-settings') translationSettings?.load();
}

function renderArticles() {
  $('#count-all').textContent = articles.length;
  $('#count-published').textContent = articles.filter(item => item.status === 'published').length;
  $('#count-draft').textContent = articles.filter(item => item.status === 'draft').length;
  $('#count-scheduled').textContent = articles.filter(item => item.status === 'scheduled').length;
  const query = $('#post-search').value.trim().toLowerCase();
  const category = $('#post-category-filter').value;
  const filtered = articles.filter(item => (selectedStatus === 'all' || item.status === selectedStatus) && (!category || item.category === category) && item.title.toLowerCase().includes(query));
  $('#post-table').innerHTML = filtered.map(article => `<tr><td>${isPrivilegedAdmin() ? `<button class="post-title-button" data-edit="${escape(article.id)}">${escape(article.title)}</button>` : `<button class="post-title-button" data-read="${escape(article.id)}">${escape(article.title)}</button>`}<p class="post-summary">${escape(article.summary || '暂无摘要')}</p></td><td>${escape(categoryLabel(article.category))}</td><td><span class="badge badge-${escape(article.status)}">${article.status === 'published' ? '已发布' : article.status === 'scheduled' ? '待定时发布' : '草稿'}</span>${article.status === 'scheduled' ? `<small class="scheduled-time">${escape(beijingTimeLabel(article.scheduledAt))} 北京时间</small>` : ''}</td><td>${escape(article.date)}</td><td>${articleTranslationState(article)}</td><td><div class="row-actions">${isPrivilegedAdmin() ? `<button data-edit="${escape(article.id)}">编辑</button>` : `<button data-read="${escape(article.id)}">查看</button>`}<button class="delete-post" data-delete="${escape(article.id)}">${isPrivilegedAdmin() ? '删除' : '申请删除'}</button></div></td></tr>`).join('');
  $('#post-empty').hidden = filtered.length > 0;
  $('#list-count').textContent = `共 ${filtered.length} 篇文章`;
  renderWelcome();
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function beijingLocalTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function beijingTimeLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value));
}

function updatePublishSettings() {
  const scheduled = $('#post-publish-mode').value === 'scheduled';
  $('#post-scheduled-label').hidden = !scheduled;
  $('#post-scheduled-at').disabled = !scheduled || mutationBusy;
  $('#publish-post').textContent = !isPrivilegedAdmin() ? (scheduled ? '提交定时发布审批' : '提交发布审批') : scheduled ? '保存定时发布' : editingId && articles.find(item => item.id === editingId)?.status === 'published' ? '保存并发布' : '立即发布文章';
  $('#publish-description').textContent = !isPrivilegedAdmin() ? (scheduled ? '提交后须审批，通过后到所选时间才公开；若审批时时间已过，将立即发布。可在“我的申请”查看进度。' : '提交后不会立即公开。高级或超级管理员审批通过后才发布，可在“我的申请”查看进度和处理理由。') : scheduled ? '保存后文章保持待定时发布，到所选北京时间才公开。保存为草稿会取消定时。' : '立即发布后对网站访客公开。保存为草稿仅在管理模式可见，并取消已有定时。';
}

function openEditor(id = null) {
  if (mutationBusy || !session?.authenticated) return;
  if (id && !isPrivilegedAdmin()) { toast('普通管理员只能新建文章并提交审批。'); return; }
  const article = articles.find(item => item.id === id);
  if (id && !article) { toast('文章已不存在，请刷新列表。'); return; }
  editingId = id;
  dirty = false;
  $('#post-form').reset();
  $('#post-auto-translate').checked = article ? article.autoTranslate === true : true;
  $('#post-title').value = article?.title || '';
  $('#post-category').value = article?.category || categories[0];
  $('#post-date').value = article?.date || today();
  $('#post-source').value = article?.source || websiteContent?.values?.['site.name'] || '晏阳联合政府';
  $('#post-summary').value = article?.summary || '';
  $('#post-body').value = article?.body.join('\n\n') || '';
  $('#post-publish-mode').value = article?.status === 'scheduled' ? 'scheduled' : 'published';
  $('#post-scheduled-at').value = article?.status === 'scheduled' ? beijingLocalTime(article.scheduledAt) : '';
  $('#editor-title').textContent = article ? '编辑文章' : '新建文章';
  updatePublishSettings();
  $('#editor-error').textContent = '';
  $('#save-status').textContent = '';
  $('#body-count').textContent = `${$('#post-body').value.length}字`;
  showView('editor');
  $('#post-title').focus();
}

function formArticle(status = 'draft') {
  return { title: $('#post-title').value.trim(), category: $('#post-category').value, date: $('#post-date').value, source: $('#post-source').value.trim() || websiteContent?.values?.['site.name'] || '晏阳联合政府', summary: $('#post-summary').value.trim(), body: $('#post-body').value.trim().split(/\n\s*\n/).map(text => text.trim()).filter(Boolean), autoTranslate: $('#post-auto-translate').checked, status };
}

function openModal(label, content, action) {
  $('#modal-label').textContent = label;
  $('#modal-content').innerHTML = content;
  modalAction = action || null;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  const title = $('#modal-title');
  if (title) { title.tabIndex = -1; title.focus(); }
}

function closeModal() { dialog.close(); modalAction = null; management?.closeDetails?.(); }
$('#modal-close').addEventListener('click', closeModal);
dialog.addEventListener('close', () => { modalAction = null; management?.closeDetails?.(); });

function leaveEditor(action) {
  if (mutationBusy) return;
  if (currentView === 'site-content' && siteEditor.dirty) {
    openModal('尚未保存', '<h2 id="modal-title">离开网站内容编辑？</h2><p>尚未保存的修改将丢失。请先保存，或放弃本次修改。</p><div class="modal-actions"><button class="button" data-modal-cancel>继续编辑</button><button class="button button-primary" data-modal-confirm>放弃修改并离开</button></div>', async () => { siteEditor.discard(); closeModal(); action(); });
    return;
  }
  if (currentView !== 'editor' || !dirty) { action(); return; }
  openModal('尚未保存', `<h2 id="modal-title">离开当前编辑？</h2><p>尚未提交的修改将丢失。${isPrivilegedAdmin() ? '您可以返回编辑，先保存为草稿。' : '您可以返回编辑，提交发布审批。'}</p><div class="modal-actions"><button class="button" data-modal-cancel>继续编辑</button><button class="button button-primary" data-modal-confirm>放弃修改并离开</button></div>`, async () => { dirty = false; closeModal(); action(); });
}

async function saveArticle(status) {
  if (mutationBusy || !session?.authenticated) return;
  if (!isPrivilegedAdmin() && (editingId || !['published', 'scheduled'].includes(status))) { $('#editor-error').textContent = '普通管理员只能新建文章并提交发布审批。'; return; }
  const expectedGeneration = sessionGeneration;
  const article = formArticle(status);
  if (!article.title || !article.body.length) { $('#editor-error').textContent = '请填写标题和正文。'; return; }
  if (status === 'scheduled') {
    const localTime = $('#post-scheduled-at').value;
    const scheduled = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime) ? new Date(`${localTime}:00+08:00`) : new Date(NaN);
    if (!Number.isFinite(scheduled.getTime()) || beijingLocalTime(scheduled) !== localTime || scheduled.getTime() <= Date.now()) { $('#editor-error').textContent = '请选择有效的未来定时时间（北京时间 UTC+8）。'; return; }
    article.scheduledAt = scheduled.toISOString();
  }
  mutationBusy = true;
  $('#editor-error').textContent = '';
  $('#save-status').textContent = isPrivilegedAdmin() ? '正在保存，请稍候…' : '正在提交审批，请稍候…';
  const lockedControls = $$('#post-form input, #post-form select, #post-form textarea, #post-form button, #back-posts, #preview-post, #logout, [data-view]').map(control => ({ control, disabled: control.disabled }));
  lockedControls.forEach(({ control }) => { control.disabled = true; });
  try {
    const result = await api(editingId ? `/api/admin/articles/${editingId}` : '/api/admin/articles', { method: editingId ? 'PUT' : 'POST', data: article });
    if (expectedGeneration !== sessionGeneration) return;
    if (result.request) {
      dirty = false; editingId = null;
      $('#post-form').reset();
      await management.loadRequests();
      if (expectedGeneration !== sessionGeneration) return;
      showView('requests');
      toast(status === 'scheduled' ? '定时发布申请已提交审批，通过后到所选时间才公开；若审批时时间已过，将立即发布。' : '发布申请已提交审批，通过后才会公开。');
      return;
    }
    editingId = result.article.id;
    articles = [result.article, ...articles.filter(item => item.id !== editingId)];
    dirty = false;
    renderArticles();
    let refreshError = null;
    try { await loadArticles(); }
    catch (error) { if (error.stale) return; refreshError = error; }
    if (expectedGeneration !== sessionGeneration) return;
    showView('posts');
    const savedMessage = status === 'published' ? '文章已发布。' : status === 'scheduled' ? `定时发布已保存，将于${beijingTimeLabel(article.scheduledAt)}（北京时间）公开。` : '草稿已保存。';
    toast(refreshError ? `${savedMessage}列表刷新未完成，已保留本次保存结果。` : savedMessage);
  } catch (error) { if (!error.stale && expectedGeneration === sessionGeneration) $('#editor-error').textContent = error.message; }
  finally {
    if (expectedGeneration === sessionGeneration) {
      mutationBusy = false;
      $('#save-status').textContent = '';
      lockedControls.forEach(({ control, disabled }) => { control.disabled = disabled; });
      if (session?.authenticated) updatePermissions();
    }
  }
}

function previewArticle() {
  const article = formArticle();
  openModal('文章预览', `<article><h1 id="modal-title">${escape(article.title || '未填写标题')}</h1><div class="preview-meta">${escape(categoryLabel(article.category))}　${escape(article.date)}　来源：${escape(article.source)}</div>${article.summary ? `<div class="preview-summary">${escape(article.summary)}</div>` : ''}${article.body.map(text => `<p>${escape(text)}</p>`).join('') || '<p>暂无正文内容。</p>'}</article>`);
}

function askDelete(id) {
  if (!session?.authenticated || mutationBusy) return;
  const article = articles.find(item => item.id === id);
  if (!article) return;
  const direct = isPrivilegedAdmin();
  const expectedGeneration = sessionGeneration;
  openModal(direct ? '删除文章' : '申请删除', `<h2 id="modal-title">${direct ? '删除这篇文章？' : '提交删除审批？'}</h2><p>《${escape(article.title)}》</p><p>${direct ? '文章将从网站与管理列表移除，请确认后操作。' : '高级或超级管理员审批通过后，文章才会从网站移除。您可以在“我的申请”查看结果。'}</p><p class="form-error" id="modal-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button button-primary" data-modal-confirm>${direct ? '确认删除' : '提交删除审批'}</button></div>`, async () => {
    if (expectedGeneration !== sessionGeneration) throw staleResponse();
    const result = await api(`/api/admin/articles/${id}`, { method: 'DELETE', data: {} });
    closeModal();
    if (result.request) { await management.loadRequests(); if (expectedGeneration === sessionGeneration) toast('删除申请已提交审批，文章仍保持发布。'); }
    else { await loadArticles(); if (expectedGeneration === sessionGeneration) toast('文章已删除。'); }
  });
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#auth-error').textContent = '';
  const setup = session?.setupRequired;
  if (setup && $('#password').value !== $('#password-confirm').value) { $('#auth-error').textContent = '两次输入的密码不一致。'; return; }
  $('#auth-submit').disabled = true;
  try {
    setSession(await api(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', data: { username: $('#username').value.trim(), password: $('#password').value } }));
    await enterWorkspace({ animate: true });
  } catch (error) { if (!error.stale) $('#auth-error').textContent = error.message; }
  finally { $('#auth-submit').disabled = false; }
});
$('#retry-connect').addEventListener('click', connect);
$('#logout').addEventListener('click', () => leaveEditor(async () => {
  try { await api('/api/admin/logout', { method: 'POST', data: {} }); clearWorkspace(); setSession(null); await connect(); }
  catch (error) { if (!error.stale) toast(error.message); }
}));
$('#new-post').addEventListener('click', () => openEditor());
$('#welcome-new-post').addEventListener('click', () => leaveEditor(() => openEditor()));
$('#welcome-replay').addEventListener('click', () => {
  if (!session?.authenticated || mutationBusy || currentView !== 'welcome') return;
  if (!playWelcomeTransition()) toast('已按系统的减少动态效果设置关闭开场动画。');
});
$('#transition-enter').addEventListener('click', () => dismissWelcomeTransition());
$('#welcome-transition').addEventListener('cancel', event => { event.preventDefault(); dismissWelcomeTransition(); });
$('#back-posts').addEventListener('click', () => leaveEditor(() => showView('posts')));
$('#post-form').addEventListener('input', () => { dirty = true; $('#body-count').textContent = `${$('#post-body').value.length}字`; });
$('#post-form').addEventListener('change', () => { dirty = true; });
$('#post-publish-mode').addEventListener('change', updatePublishSettings);
$('#post-form').addEventListener('submit', event => { event.preventDefault(); const action = event.submitter?.value || 'draft'; return saveArticle(action === 'published' && $('#post-publish-mode').value === 'scheduled' ? 'scheduled' : action); });
$('#preview-post').addEventListener('click', previewArticle);
$('#post-search').addEventListener('input', renderArticles);
$('#post-category-filter').addEventListener('change', renderArticles);

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || mutationBusy) return;
  management.handleClick(button);
  if (button.dataset.view) leaveEditor(() => showView(button.dataset.view));
  if (button.dataset.edit) openEditor(button.dataset.edit);
  if (button.dataset.delete) askDelete(button.dataset.delete);
  if (button.dataset.translate) await translateArticle(button.dataset.translate);
  if (button.dataset.read) { const article = articles.find(item => item.id === button.dataset.read); if (article) openModal('查看文章', `<article><h1 id="modal-title">${escape(article.title)}</h1><div class="preview-meta">${escape(categoryLabel(article.category))}　${escape(article.date)}　来源：${escape(article.source)}</div>${article.body.map(text => `<p>${escape(text)}</p>`).join('')}</article>`); }
  if (button.dataset.status) {
    if (['draft', 'scheduled'].includes(button.dataset.status) && !isPrivilegedAdmin()) return;
    selectedStatus = button.dataset.status;
    $$('[data-status]').forEach(item => { const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', selected); });
    renderArticles();
  }
  if (button.hasAttribute('data-modal-cancel')) closeModal();
  if (button.hasAttribute('data-modal-confirm') && modalAction && !mutationBusy) {
    const expectedGeneration = sessionGeneration;
    mutationBusy = true; button.disabled = true;
    try { await modalAction(); }
    catch (error) { if (!error.stale && expectedGeneration === sessionGeneration) { if ($('#modal-error')) $('#modal-error').textContent = error.message; else toast(error.message); } }
    finally { if (expectedGeneration === sessionGeneration) { mutationBusy = false; button.disabled = false; } }
  }
});

$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!session?.authenticated || mutationBusy) return;
  const expectedGeneration = sessionGeneration;
  $('#password-error').textContent = '';
  if ($('#new-password').value !== $('#new-password-confirm').value) { $('#password-error').textContent = '两次输入的新密码不一致。'; return; }
  const button = event.submitter; button.disabled = true;
  try {
    await api('/api/admin/password', { method: 'PUT', data: { currentPassword: $('#current-password').value, newPassword: $('#new-password').value } });
    if (expectedGeneration !== sessionGeneration) return;
    $('#password-form').reset();
    toast('密码已更新，其他登录会话已退出。');
  } catch (error) { if (expectedGeneration === sessionGeneration && !error.stale) $('#password-error').textContent = error.message; }
  finally { if (expectedGeneration === sessionGeneration) button.disabled = false; }
});
window.addEventListener('beforeunload', event => { if ((dirty && currentView === 'editor') || (siteEditor.dirty && currentView === 'site-content')) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', () => { if (session?.authenticated && ['welcome', 'posts'].includes(currentView)) loadArticles().catch(error => { if (!error.stale) toast(error.message); }); if (session?.authenticated) void loadTranslationInfo(); if (session?.authenticated && currentView === 'requests') management.loadRequests(); if (isPrivilegedAdmin() && currentView === 'users') management.loadUsers(); });
$('#post-category').innerHTML = categories.map(category => `<option>${category}</option>`).join('');
$('#post-category-filter').insertAdjacentHTML('beforeend', categories.map(category => `<option>${category}</option>`).join(''));
siteEditor = createWebsiteContentEditor({
  api, toast, openModal, closeModal,
  onContentChanged(content) {
    websiteContent = content;
    const name = content.values['site.name'];
    document.title = `管理模式 · ${name}`;
    $$('[data-admin-site-name]').forEach(node => { node.textContent = name; });
    for (const selector of ['#post-category', '#post-category-filter']) {
      const selected = $(selector).value;
      $(selector).innerHTML = (selector.endsWith('filter') ? '<option value="">全部栏目</option>' : '') + categories.map(category => `<option value="${escape(category)}">${escape(categoryLabel(category))}</option>`).join('');
      $(selector).value = selected;
    }
    renderArticles();
  },
  onBusyChange(busy) {
    mutationBusy = busy;
    if (busy) {
      navigationLocks = $$('[data-view], #logout').map(control => ({ control, disabled: control.disabled }));
      navigationLocks.forEach(({ control }) => { control.disabled = true; });
    } else {
      navigationLocks.forEach(({ control, disabled }) => { control.disabled = disabled; });
      navigationLocks = [];
    }
  }
});
management = createAdminManagement({ api, toast, openModal, closeModal, getSession: () => session, onArticlesChanged: loadArticles, onBusyChange(busy) { mutationBusy = busy; $$('[data-view], #logout').forEach(button => { button.disabled = busy; }); } });
translationSettings = typeof createTranslationSettingsEditor === 'function' ? createTranslationSettingsEditor({ document, api, onSaved: () => { void loadTranslationInfo(); }, onBusyChange(busy) { mutationBusy = busy; $$('[data-view], #logout').forEach(button => { button.disabled = busy; }); } }) : { clear() {} };
$('.admin-brand').addEventListener('click', event => {
  if (mutationBusy || (currentView === 'editor' && dirty) || (currentView === 'site-content' && siteEditor.dirty)) {
    event.preventDefault();
    leaveEditor(() => { window.location.href = '/'; });
  }
});
connect();
