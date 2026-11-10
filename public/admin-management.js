const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const roleLabel = role => role === 'anonymous' ? '访客' : role === 'system' ? '系统任务' : role === 'superadmin' ? '超级管理员' : role === 'senioradmin' ? '高级管理员' : '普通管理员';
const adminRoles = ['admin', 'senioradmin', 'superadmin'];
const roleOptions = (roles, selected) => roles.map(role => `<option value="${role}" ${role === selected ? 'selected' : ''}>${roleLabel(role)}</option>`).join('');
const statusLabels = { pending: '待审批', approved: '已通过', rejected: '已驳回' };
const dateLabel = value => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value)) : '—';
const feedbackTypes = { suggestion: '意见建议', consultation: '在线咨询', feedback: '留言反馈' };
const hasFeedbackIdentity = value => String(value ?? '').trim().length > 0;
const feedbackIdentityLabel = value => hasFeedbackIdentity(value) ? escape(value) : '旧版未采集';
const publicationNotice = article => article.status === 'scheduled' ? `审批通过后按所选北京时间到时发布；若定时时间已过，审批通过后立即发布。定时时间：${dateLabel(article.scheduledAt)}（北京时间）。` : '审批通过后，这篇新文章将向网站访客公开。';

export function createAdminManagement({ api, toast, openModal, closeModal, getSession, onArticlesChanged, onBusyChange, document: dom = globalThis.document }) {
  const $ = selector => dom.querySelector(selector);
  let requests = [];
  let users = [];
  let logs = [];
  let feedback = [];
  let logsPage = 1;
  let logsTotal = 0;
  let feedbackPage = 1;
  let feedbackTotal = 0;
  const pageSize = 25;
  let logsLoading = false;
  let feedbackLoading = false;
  let activeFeedbackId = null;
  let activeFeedback = null;
  let generation = 0;
  let requestsLoading = false;
  let usersLoading = false;
  let busy = false;
  const isSuperadmin = () => getSession()?.authenticated && (getSession().role || 'superadmin') === 'superadmin';
  const isPrivilegedAdmin = () => getSession()?.authenticated && ['senioradmin', 'superadmin'].includes(getSession().role || 'superadmin');
  const ownUser = user => getSession()?.userId ? user.id === getSession().userId : user.username === getSession()?.username;
  const current = () => ({ generation, session: getSession() });
  const valid = expected => expected.generation === generation && expected.session === getSession() && getSession()?.authenticated;
  const requireCurrentPrivilegedAdmin = expected => { if (!valid(expected) || !isPrivilegedAdmin()) throw Object.assign(new Error('登录状态或权限已改变，请重新登录。'), { stale: true }); };
  const canManageUser = user => !!user && isPrivilegedAdmin() && !ownUser(user) && (isSuperadmin() || user.role !== 'superadmin');
  const requireCurrentUserManager = (expected, id) => {
    requireCurrentPrivilegedAdmin(expected);
    if (!canManageUser(users.find(user => user.id === id))) throw Object.assign(new Error('账号权限已改变，请刷新管理员列表。'), { stale: true });
  };

  function updatePermissions() {
    const roles = isSuperadmin() ? adminRoles : ['admin', 'senioradmin'];
    const selected = roles.includes($('#create-role').value) ? $('#create-role').value : 'admin';
    $('#create-role').innerHTML = roleOptions(roles, selected);
    $('#create-role').value = selected;
    $('#users-permissions').textContent = isSuperadmin() ? '创建账号、调整其他账号的等级，管理登录状态和密码。' : '添加普通或高级管理员，管理非超级管理员账号的登录状态和密码。';
    $('#user-levels-help').textContent = isSuperadmin() ? '普通管理员提交文章审批；高级和超级管理员管理全站并审批。仅超级管理员可以调整现有账号的等级。' : '高级管理员可添加普通或高级管理员；现有账号等级仅由超级管理员调整。超级管理员账号也须由其他超级管理员管理。';
  }

  function clear() {
    generation++; requests = []; users = []; logs = []; feedback = []; requestsLoading = false; usersLoading = false; logsLoading = false; feedbackLoading = false; busy = false;
    logsPage = 1; logsTotal = 0; feedbackPage = 1; feedbackTotal = 0; activeFeedbackId = null; activeFeedback = null;
    $('#requests-table').innerHTML = ''; $('#users-table').innerHTML = '';
    $('#logs-table').innerHTML = ''; $('#feedback-table').innerHTML = '';
    for (const id of ['requests-error', 'users-error', 'requests-status', 'users-status', 'create-user-error', 'logs-error', 'logs-status', 'feedback-error', 'feedback-status']) $(`#${id}`).textContent = '';
    $('#request-status-filter').value = 'all';
    for (const id of ['log-search', 'log-action-filter', 'log-result-filter', 'feedback-search', 'feedback-status-filter']) $(`#${id}`).value = '';
    $('#log-action-filter').innerHTML = '<option value="">全部操作</option>';
    $('#logs-empty').hidden = true; $('#feedback-empty').hidden = true;
    setListControls('logs', false, 1, 0); setListControls('feedback', false, 1, 0);
    $('#create-user-form').reset();
    $('#refresh-requests').disabled = false; $('#refresh-users').disabled = false;
    [...dom.querySelectorAll('#create-user-form input, #create-user-form select, #create-user-form button')].forEach(control => { control.disabled = false; });
  }

  function renderRequests() {
    const filter = $('#request-status-filter').value || 'all';
    const visible = requests.filter(request => (isPrivilegedAdmin() || request.requestedBy.id === getSession()?.userId || (!getSession()?.userId && request.requestedBy.username === getSession()?.username)) && (filter === 'all' || request.status === filter));
    $('#requests-table').innerHTML = visible.map(request => `<tr><td><button class="post-title-button" data-request="${escape(request.id)}">${escape(request.article.title)}</button><span class="request-kind">${request.type === 'delete' ? '删除申请' : '发布申请'}</span>${request.note ? `<p class="request-note">处理理由：${escape(request.note)}</p>` : ''}</td><td>${escape(request.requestedBy.username)}</td><td>${escape(dateLabel(request.createdAt))}</td><td><span class="badge badge-${escape(request.status)}">${escape(statusLabels[request.status] || request.status)}</span></td><td><div class="row-actions"><button data-request="${escape(request.id)}">${isPrivilegedAdmin() && request.status === 'pending' ? '查看并审批' : '查看详情'}</button></div></td></tr>`).join('');
    $('#requests-empty').hidden = visible.length > 0;
    $('#requests-status').textContent = `共 ${visible.length} 项，${visible.filter(request => request.status === 'pending').length} 项待审批`;
  }

  async function loadRequests() {
    if (!getSession()?.authenticated || requestsLoading) return;
    const expected = current(); requestsLoading = true;
    $('#requests-error').textContent = ''; $('#requests-status').textContent = '正在加载申请…';
    $('#refresh-requests').disabled = true;
    try {
      const result = await api('/api/admin/requests');
      if (!valid(expected)) return;
      requests = result.requests;
      renderRequests();
    } catch (error) { if (valid(expected) && !error.stale) { $('#requests-error').textContent = error.message; $('#requests-status').textContent = '加载未完成，请刷新申请。'; } }
    finally { if (valid(expected)) { requestsLoading = false; $('#refresh-requests').disabled = false; } }
  }

  function requestArticle(request) {
    const article = request.article;
    return `<article class="request-article"><h3>${escape(article.title)}</h3><div class="preview-meta">${escape(article.category)}　${escape(article.date)}　来源：${escape(article.source)}</div>${article.summary ? `<div class="preview-summary">${escape(article.summary)}</div>` : ''}${(article.body || []).map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}</article>`;
  }

  function showRequest(id) {
    const request = requests.find(item => item.id === id);
    if (!request || (!isPrivilegedAdmin() && !(getSession()?.userId ? request.requestedBy.id === getSession().userId : request.requestedBy.username === getSession()?.username))) return;
    const pending = isPrivilegedAdmin() && request.status === 'pending';
    openModal('申请详情', `<div class="request-details"><h2 id="modal-title">${request.type === 'delete' ? '删除申请' : '发布申请'} · ${escape(statusLabels[request.status])}</h2><dl><dt>申请人</dt><dd>${escape(request.requestedBy.username)}</dd><dt>提交时间</dt><dd>${escape(dateLabel(request.createdAt))}</dd>${request.article.status === 'scheduled' ? `<dt>定时时间</dt><dd>${escape(dateLabel(request.article.scheduledAt))}（北京时间）</dd>` : ''}${request.reviewedBy ? `<dt>审批人</dt><dd>${escape(request.reviewedBy.username)}</dd><dt>处理时间</dt><dd>${escape(dateLabel(request.reviewedAt))}</dd>` : ''}${request.note ? `<dt>处理理由</dt><dd>${escape(request.note)}</dd>` : ''}</dl><p>${request.type === 'delete' ? '以下是提交删除申请时的文章快照。审批通过后将删除对应文章。' : escape(publicationNotice(request.article))}</p></div>${requestArticle(request)}${pending ? `<div class="request-review"><label for="review-note">处理理由（选填）<textarea id="review-note" rows="3" maxlength="2000" placeholder="填写发布或删除决定的理由"></textarea></label><div class="modal-actions"><button class="button danger-button" data-review-request="${escape(id)}" data-review-decision="reject">驳回申请</button><button class="button button-primary" data-review-request="${escape(id)}" data-review-decision="approve">通过申请</button></div></div>` : ''}`);
  }

  function confirmReview(id, decision) {
    if (!isPrivilegedAdmin() || !['approve', 'reject'].includes(decision)) return;
    const request = requests.find(item => item.id === id && item.status === 'pending');
    if (!request) return;
    const expected = current();
    const note = $('#review-note')?.value || '';
    const label = decision === 'approve' ? '通过' : '驳回';
    openModal(`${label}申请`, `<h2 id="modal-title">确认${label}这项${request.type === 'delete' ? '删除' : '发布'}申请？</h2><p>《${escape(request.article.title)}》</p><p>${decision === 'reject' ? '申请将被驳回，文章内容不会因此改变。' : request.type === 'delete' ? '审批通过后，这篇文章将从网站移除。' : escape(publicationNotice(request.article))}</p><label for="review-note">处理理由（选填）<textarea id="review-note" rows="3" maxlength="2000">${escape(note)}</textarea></label><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button ${decision === 'approve' ? 'button-primary' : 'danger-button'}" data-modal-confirm>确认${label}</button></div>`, async () => {
      requireCurrentPrivilegedAdmin(expected);
      const result = await api(`/api/admin/requests/${encodeURIComponent(id)}/review`, { method: 'POST', data: { decision, note: $('#review-note').value.trim() } });
      if (!valid(expected)) return;
      requests = requests.map(item => item.id === id ? result.request : item); renderRequests(); closeModal();
      let refreshFailed = false;
      try { await onArticlesChanged(); } catch (error) { if (error.stale) return; refreshFailed = true; }
      await loadRequests();
      if (valid(expected)) toast(`申请已${label}。${refreshFailed ? '文章列表刷新未完成，请刷新列表。' : ''}`);
    });
  }

  function renderUsers() {
    $('#users-table').innerHTML = users.map(user => `<tr><td>${escape(user.username)}${ownUser(user) ? '<span class="current-user">（当前账号）</span>' : ''}</td><td>${roleLabel(user.role)}</td><td><span class="badge badge-${user.disabled ? 'disabled' : 'enabled'}">${user.disabled ? '已禁用' : '已启用'}</span></td><td>${ownUser(user) ? '<span class="current-user">在账号设置修改密码</span>' : !canManageUser(user) ? '<span class="current-user">仅其他超级管理员可管理此账号</span>' : `<div class="row-actions">${isSuperadmin() ? `<button data-role-user="${escape(user.id)}">修改等级</button>` : ''}<button data-edit-user="${escape(user.id)}">${isSuperadmin() ? '状态与密码' : '状态与密码'}</button><button class="delete-post" data-delete-user="${escape(user.id)}">删除</button></div>`}</td></tr>`).join('');
    $('#users-empty').hidden = users.length > 0;
    $('#users-status').textContent = `共 ${users.length} 个账号`;
  }

  async function loadUsers() {
    if (!isPrivilegedAdmin() || usersLoading) return;
    updatePermissions();
    const expected = current(); usersLoading = true;
    $('#users-error').textContent = ''; $('#users-status').textContent = '正在加载账号…'; $('#refresh-users').disabled = true;
    try { const result = await api('/api/admin/users'); if (!valid(expected) || !isPrivilegedAdmin()) return; users = result.users; renderUsers(); }
    catch (error) { if (valid(expected) && !error.stale) { $('#users-error').textContent = error.message; $('#users-status').textContent = '加载未完成，请刷新账号。'; } }
    finally { if (valid(expected)) { usersLoading = false; $('#refresh-users').disabled = false; } }
  }

  function setListControls(kind, loading, page, total) {
    const filters = kind === 'logs' ? ['log-search', 'log-action-filter', 'log-result-filter', 'search-logs'] : ['feedback-search', 'feedback-status-filter', 'search-feedback'];
    for (const id of [...filters, `refresh-${kind}`]) $(`#${id}`).disabled = loading;
    $(`#${kind}-previous`).disabled = loading || page <= 1;
    $(`#${kind}-next`).disabled = loading || page * pageSize >= total;
    $(`#${kind}-page`).textContent = `第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页`;
  }

  function renderLogs() {
    $('#logs-table').innerHTML = logs.map(log => `<tr><td>${escape(dateLabel(log.at))}</td><td>${escape(log.actor?.username || '系统')}<span class="request-kind">${escape(roleLabel(log.actor?.role || 'system'))}</span></td><td>${escape(log.actionLabel || log.action)}</td><td>${escape(log.target?.title || log.target?.id || '—')}${log.target?.type ? `<span class="request-kind">${escape(({ article: '文章', user: '管理员', request: '审批申请', feedback: '意见反馈', siteContent: '网站内容' })[log.target.type] || log.target.type)}${log.target.id ? ` · ${escape(log.target.id)}` : ''}</span>` : ''}</td><td><span class="badge badge-${log.result === 'success' ? 'approved' : 'rejected'}">${log.result === 'success' ? '成功' : '失败'}</span><p class="log-message">${escape(log.message || '—')}</p></td></tr>`).join('');
    $('#logs-empty').hidden = logs.length > 0;
    $('#logs-status').textContent = `共 ${logsTotal} 条日志，本页 ${logs.length} 条`;
  }

  async function loadLogs() {
    if (!isPrivilegedAdmin() || logsLoading) return;
    const expected = current(); logsLoading = true;
    const action = $('#log-action-filter').value;
    const query = new URLSearchParams({ page: String(logsPage), pageSize: String(pageSize) });
    if (action) query.set('action', action);
    if ($('#log-result-filter').value) query.set('result', $('#log-result-filter').value);
    if ($('#log-search').value.trim()) query.set('search', $('#log-search').value.trim());
    $('#logs-table').innerHTML = ''; $('#logs-empty').hidden = true;
    $('#logs-error').textContent = ''; $('#logs-status').textContent = '正在加载操作日志…';
    logsTotal = 0; setListControls('logs', true, logsPage, logsTotal);
    try {
      const result = await api(`/api/admin/logs?${query}`);
      if (!valid(expected) || !isPrivilegedAdmin()) return;
      logs = result.logs; logsTotal = result.total; logsPage = result.page;
      $('#log-action-filter').innerHTML = '<option value="">全部操作</option>' + result.actions.map(item => `<option value="${escape(item.value)}">${escape(item.label)}</option>`).join('');
      $('#log-action-filter').value = action;
      renderLogs();
    } catch (error) { if (valid(expected) && !error.stale) { $('#logs-error').textContent = error.message; $('#logs-status').textContent = '日志加载未完成，请刷新日志重试。'; } }
    finally { if (valid(expected)) { logsLoading = false; setListControls('logs', false, logsPage, logsTotal); } }
  }

  function renderFeedback() {
    const status = $('#feedback-status-filter').value;
    const visible = feedback.filter(item => !status || item.status === status);
    $('#feedback-table').innerHTML = visible.map(item => `<tr><td><button class="post-title-button" data-feedback="${escape(item.id)}">${escape(item.title)}</button><span class="request-kind">${escape(feedbackTypes[item.type] || item.type)}</span></td><td class="feedback-game-name" data-label="游戏名称">${feedbackIdentityLabel(item.gameName)}</td><td class="feedback-qq" data-label="QQ号">${feedbackIdentityLabel(item.qq)}</td><td>${escape(dateLabel(item.createdAt))}</td><td><span class="badge badge-${item.status === 'read' ? 'approved' : 'pending'}">${item.status === 'read' ? '已读' : '未读'}</span>${item.readBy ? `<span class="request-kind">${escape(item.readBy.username)} 已读</span>` : ''}</td><td><div class="row-actions"><button data-feedback="${escape(item.id)}">查看完整意见</button></div></td></tr>`).join('');
    $('#feedback-empty').hidden = visible.length > 0;
    $('#feedback-status').textContent = `共 ${feedbackTotal} 条意见，本页 ${visible.length} 条`;
  }

  async function loadFeedback() {
    if (!getSession()?.authenticated || feedbackLoading) return;
    const expected = current(); feedbackLoading = true;
    const query = new URLSearchParams({ page: String(feedbackPage), pageSize: String(pageSize) });
    if ($('#feedback-status-filter').value) query.set('status', $('#feedback-status-filter').value);
    if ($('#feedback-search').value.trim()) query.set('search', $('#feedback-search').value.trim());
    $('#feedback-table').innerHTML = ''; $('#feedback-empty').hidden = true;
    $('#feedback-error').textContent = ''; $('#feedback-status').textContent = '正在加载意见反馈…';
    feedbackTotal = 0; setListControls('feedback', true, feedbackPage, feedbackTotal);
    try {
      const result = await api(`/api/admin/feedback?${query}`);
      if (!valid(expected)) return;
      feedback = result.feedback; feedbackTotal = result.total; feedbackPage = result.page;
      renderFeedback();
    } catch (error) { if (valid(expected) && !error.stale) { $('#feedback-error').textContent = error.message; $('#feedback-status').textContent = '意见加载未完成，请刷新反馈重试。'; } }
    finally { if (valid(expected)) { feedbackLoading = false; setListControls('feedback', false, feedbackPage, feedbackTotal); } }
  }

  function showFeedback(item) {
    if (!item || !getSession()?.authenticated) return;
    activeFeedbackId = item.id;
    activeFeedback = item;
    openModal('意见反馈详情', `<div class="request-details"><h2 id="modal-title">${escape(item.title)}</h2><dl><dt>意见类型</dt><dd>${escape(feedbackTypes[item.type] || item.type)}</dd><dt>游戏名称</dt><dd>${feedbackIdentityLabel(item.gameName)}</dd><dt>QQ号</dt><dd>${feedbackIdentityLabel(item.qq)}</dd><dt>提交时间</dt><dd>${escape(dateLabel(item.createdAt))}（北京时间）</dd><dt>阅读状态</dt><dd>${item.status === 'read' ? '已读' : '未读'}</dd>${item.readBy ? `<dt>阅读人</dt><dd>${escape(item.readBy.username)}</dd><dt>阅读时间</dt><dd>${escape(dateLabel(item.readAt))}（北京时间）</dd>` : ''}</dl>${!hasFeedbackIdentity(item.gameName) && !hasFeedbackIdentity(item.qq) ? '<p class="management-help">这条旧版留言提交时未采集游戏名称和 QQ 号，因此没有可显示的身份信息。</p>' : ''}</div><article class="feedback-content"><p>${escape(item.content)}</p></article><p id="feedback-detail-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>关闭</button>${item.status !== 'read' ? `<button class="button button-primary" data-feedback-id="${escape(item.id)}" data-feedback-status="read">标记已读</button>` : isPrivilegedAdmin() ? `<button class="button" data-feedback-id="${escape(item.id)}" data-feedback-status="new">标记未读</button>` : ''}</div>`);
  }

  async function markFeedback(id, status) {
    if (!getSession()?.authenticated || busy || !['read', 'new'].includes(status) || (status === 'new' && !isPrivilegedAdmin())) return;
    const item = feedback.find(record => record.id === id) || (activeFeedbackId === id ? activeFeedback : null);
    if (!item || item.status === status) return;
    const expected = current(); busy = true; onBusyChange(true);
    $('#feedback-detail-error').textContent = '';
    const controls = [...dom.querySelectorAll('[data-feedback-status]')]; controls.forEach(button => { button.disabled = true; });
    try {
      const result = await api(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', data: { status } });
      if (!valid(expected)) return;
      const listed = feedback.some(record => record.id === id);
      feedback = feedback.map(record => record.id === id ? result.feedback : record);
      const filter = $('#feedback-status-filter').value;
      if (filter && result.feedback.status !== filter && listed) { feedback = feedback.filter(record => record.id !== id); feedbackTotal = Math.max(0, feedbackTotal - 1); }
      else if (!listed && (!filter || result.feedback.status === filter)) { feedback = [result.feedback, ...feedback]; feedbackTotal++; }
      renderFeedback(); setListControls('feedback', feedbackLoading, feedbackPage, feedbackTotal);
      if (filter) {
        feedbackPage = Math.min(feedbackPage, Math.max(1, Math.ceil(feedbackTotal / pageSize)));
        await loadFeedback();
        if (!valid(expected)) return;
      }
      if (activeFeedbackId === id) showFeedback(result.feedback);
      toast(status === 'read' ? '意见已标记为已读。' : '意见已标记为未读。');
    } catch (error) { if (valid(expected) && !error.stale) { if (activeFeedbackId === id) $('#feedback-detail-error').textContent = error.message; else $('#feedback-error').textContent = error.message; } }
    finally { if (valid(expected)) { busy = false; onBusyChange(false); controls.forEach(button => { button.disabled = false; }); } }
  }

  function editUser(id) {
    if (!isPrivilegedAdmin()) return;
    const user = users.find(item => item.id === id);
    if (!canManageUser(user)) return;
    const expected = current();
    const levelControl = isSuperadmin() ? `<label for="edit-user-role">管理员等级<select id="edit-user-role">${roleOptions(adminRoles, user.role)}</select></label>` : `<p class="management-help">当前等级：${roleLabel(user.role)}。现有账号等级仅由超级管理员调整。</p>`;
    openModal('管理员账号设置', `<h2 id="modal-title">管理 ${escape(user.username)}</h2><div class="modal-account-fields">${levelControl}<label for="edit-user-disabled">登录状态<select id="edit-user-disabled"><option value="false" ${!user.disabled ? 'selected' : ''}>启用账号</option><option value="true" ${user.disabled ? 'selected' : ''}>禁用账号</option></select></label><label for="edit-user-password">重置密码（选填）<input id="edit-user-password" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="留空保留当前密码"><small>至少10个字符。修改密码或等级后，该账号需要重新登录。</small></label></div><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button button-primary" data-modal-confirm>保存账号设置</button></div>`, async () => {
      requireCurrentUserManager(expected, id);
      const data = { disabled: $('#edit-user-disabled').value === 'true' };
      // Read the role from the open modal at confirmation time so a superadmin's
      // selection is always included even when the account list was refreshed.
      const selectedRole = $('#edit-user-role')?.value;
      if (isSuperadmin()) {
        if (!selectedRole || !adminRoles.includes(selectedRole)) throw new Error('请选择有效的管理员等级。');
        data.role = selectedRole;
      }
      const password = $('#edit-user-password').value;
      if (password) { if (password.length < 10 || password.length > 128) throw new Error('新密码须为10至128个字符。'); data.newPassword = password; }
      const result = await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', data });
      if (!valid(expected)) return;
      users = users.map(item => item.id === id ? result.user : item); renderUsers(); closeModal(); await loadUsers();
      if (valid(expected)) toast('管理员账号已更新。');
    });
  }

  function changeUserRole(id) {
    if (!isSuperadmin()) return;
    const user = users.find(item => item.id === id);
    if (!canManageUser(user)) return;
    const expected = current();
    openModal('修改管理员等级', `<h2 id="modal-title">修改 ${escape(user.username)} 的等级</h2><label for="edit-user-role">管理员等级<select id="edit-user-role">${roleOptions(adminRoles, user.role)}</select></label><p class="management-help">只有超级管理员可以调整其他账号等级。保存后，该账号的旧登录会话会立即失效。</p><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button button-primary" data-modal-confirm>保存等级</button></div>`, async () => {
      requireCurrentUserManager(expected, id);
      const role = $('#edit-user-role')?.value;
      if (!adminRoles.includes(role)) throw new Error('请选择有效的管理员等级。');
      const result = await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', data: { role } });
      if (!valid(expected)) return;
      users = users.map(item => item.id === id ? result.user : item);
      renderUsers(); closeModal(); await loadUsers();
      if (valid(expected)) toast('管理员等级已更新。');
    });
  }

  function deleteUser(id) {
    if (!isPrivilegedAdmin()) return;
    const user = users.find(item => item.id === id);
    if (!canManageUser(user)) return;
    const expected = current();
    openModal('删除管理员', `<h2 id="modal-title">删除 ${escape(user.username)}？</h2><p>此账号将无法登录，已提交的审批记录会保留。系统至少保留一名启用的超级管理员。</p><p id="modal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-modal-cancel>取消</button><button class="button danger-button" data-modal-confirm>确认删除账号</button></div>`, async () => {
      requireCurrentUserManager(expected, id); await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', data: {} });
      if (!valid(expected)) return;
      users = users.filter(item => item.id !== id); renderUsers(); closeModal(); await loadUsers();
      if (valid(expected)) toast('管理员账号已删除。');
    });
  }

  $('#create-user-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!isPrivilegedAdmin() || busy) return;
    const expected = current();
    const data = { username: $('#create-username').value.trim(), password: $('#create-password').value, role: $('#create-role').value };
    $('#create-user-error').textContent = '';
    if (!adminRoles.includes(data.role) || (!isSuperadmin() && data.role === 'superadmin')) { $('#create-user-error').textContent = '您没有创建此等级管理员的权限。'; return; }
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(data.username)) { $('#create-user-error').textContent = '账号须为3至40位字母、数字、下划线或短横线。'; return; }
    if (data.password.length < 10 || data.password.length > 128) { $('#create-user-error').textContent = '密码须为10至128个字符。'; return; }
    busy = true; onBusyChange(true);
    const controls = [...dom.querySelectorAll('#create-user-form input, #create-user-form select, #create-user-form button')].map(control => ({ control, disabled: control.disabled }));
    controls.forEach(({ control }) => { control.disabled = true; });
    try {
      requireCurrentPrivilegedAdmin(expected);
      const result = await api('/api/admin/users', { method: 'POST', data });
      if (!valid(expected)) return;
      users = [...users, result.user]; renderUsers(); $('#create-user-form').reset(); await loadUsers();
      if (valid(expected)) toast('管理员账号已创建。');
    } catch (error) { if (valid(expected) && !error.stale) $('#create-user-error').textContent = error.message; }
    finally { if (valid(expected)) { busy = false; onBusyChange(false); controls.forEach(({ control, disabled }) => { control.disabled = disabled; }); } }
  });
  $('#request-status-filter').addEventListener('change', renderRequests);
  $('#refresh-requests').addEventListener('click', loadRequests);
  $('#refresh-users').addEventListener('click', loadUsers);
  $('#refresh-logs').addEventListener('click', loadLogs);
  $('#refresh-feedback').addEventListener('click', loadFeedback);
  $('#logs-filter-form').addEventListener('submit', event => { event.preventDefault(); if (logsLoading) return; logsPage = 1; return loadLogs(); });
  for (const id of ['log-action-filter', 'log-result-filter']) $(`#${id}`).addEventListener('change', () => { if (logsLoading) return; logsPage = 1; return loadLogs(); });
  $('#logs-previous').addEventListener('click', () => { if (logsLoading || logsPage <= 1) return; logsPage--; return loadLogs(); });
  $('#logs-next').addEventListener('click', () => { if (logsLoading || logsPage * pageSize >= logsTotal) return; logsPage++; return loadLogs(); });
  $('#feedback-filter-form').addEventListener('submit', event => { event.preventDefault(); if (feedbackLoading) return; feedbackPage = 1; return loadFeedback(); });
  $('#feedback-status-filter').addEventListener('change', () => { if (feedbackLoading) return; feedbackPage = 1; return loadFeedback(); });
  $('#feedback-previous').addEventListener('click', () => { if (feedbackLoading || feedbackPage <= 1) return; feedbackPage--; return loadFeedback(); });
  $('#feedback-next').addEventListener('click', () => { if (feedbackLoading || feedbackPage * pageSize >= feedbackTotal) return; feedbackPage++; return loadFeedback(); });

  function handleClick(button) {
    if (!getSession()?.authenticated || busy) return;
    if (button.dataset.request) showRequest(button.dataset.request);
    if (button.dataset.reviewRequest) confirmReview(button.dataset.reviewRequest, button.dataset.reviewDecision);
    if (button.dataset.editUser) editUser(button.dataset.editUser);
    if (button.dataset.roleUser) changeUserRole(button.dataset.roleUser);
    if (button.dataset.deleteUser) deleteUser(button.dataset.deleteUser);
    if (button.dataset.feedback) showFeedback(feedback.find(item => item.id === button.dataset.feedback));
    if (button.dataset.feedbackStatus) return markFeedback(button.dataset.feedbackId, button.dataset.feedbackStatus);
  }
  updatePermissions();
  return { clear, updatePermissions, loadRequests, loadUsers, loadLogs, loadFeedback, handleClick, closeDetails() { activeFeedbackId = null; activeFeedback = null; } };
}
