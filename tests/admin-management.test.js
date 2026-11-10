import test from 'node:test';
import assert from 'node:assert/strict';

const article = { id: 'article-1', title: '<待审批标题>', body: ['第一段完整正文', '第二段 <script>'], category: '政务要闻', status: 'published', date: '2026-10-10', source: '发布机构', summary: '摘要', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
const request = { id: 'request-1', type: 'delete', status: 'pending', requestedBy: { id: 'user-2', username: 'editor' }, createdAt: '2026-10-10T00:00:00.000Z', articleId: 'article-1', article, note: '' };

const logEntry = { id: 'log-1', at: '2026-10-10T00:00:00.000Z', actor: { id: 'system', username: '系统', role: 'system' }, action: 'article.schedule.publish', actionLabel: '定时发布', target: { type: 'article', id: 'article-1', title: '<发布目标>' }, result: 'success', message: '<img src=x onerror=alert(1)>发布完成' };
const feedbackEntry = { id: 'feedback-1', type: 'suggestion', title: '<改进建议>', content: '第一段完整意见\n第二段 <script>', createdAt: '2026-10-10T00:00:00.000Z', status: 'new' };

async function management({ role = 'superadmin', failReview = false, failCreate = false, pendingRequests = false, pendingCreate = false, requestFixture = null, userFixture = null, pendingLogs = false, failLogs = false, logFixture = [logEntry], logTotal = 26, pendingFeedback = false, failFeedbackRead = false, pendingFeedbackRead = false, feedbackFixture = [feedbackEntry], paginateFeedback = false } = {}) {
  const { createAdminManagement } = await import('../public/admin-management.js');
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: selector === '#request-status-filter' ? 'all' : selector === '#create-role' ? 'admin' : '', textContent: '', innerHTML: '', hidden: false, disabled: false, listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; }, reset() { for (const id of ['#create-username', '#create-password']) node(id).value = ''; node('#create-role').value = 'admin'; } });
    return nodes.get(selector);
  };
  const document = { querySelector: node, querySelectorAll: () => [] };
  const calls = [];
  let action;
  let modal = '';
  let currentSession = { authenticated: true, userId: 'user-1', username: 'owner', role, csrfToken: 'csrf' };
  let finishRequests;
  let finishCreate;
  let finishLogs;
  let finishFeedback;
  let finishFeedbackRead;
  let feedbackRecords = structuredClone(feedbackFixture);
  let userRecords = structuredClone(userFixture || [{ id: 'user-1', username: 'owner', role, disabled: false, createdAt: '2026-10-10T00:00:00.000Z' }, { id: 'user-2', username: 'editor', role: 'admin', disabled: false, createdAt: '2026-10-10T00:00:00.000Z' }]);
  const busyChanges = [];
  let articleRefreshes = 0;
  let closed = false;
  const api = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, ...options, method });
    if (url === '/api/admin/requests') { if (pendingRequests) await new Promise(resolve => { finishRequests = resolve; }); return { requests: requestFixture || [request, { ...request, id: 'own-1', requestedBy: { id: 'user-1', username: 'owner' }, status: 'rejected', note: '请核对来源', reviewedBy: { id: 'reviewer', username: 'reviewer' }, reviewedAt: '2026-10-10T02:00:00.000Z' }] }; }
    if (url.startsWith('/api/admin/logs?')) {
      if (pendingLogs) await new Promise(resolve => { finishLogs = resolve; });
      if (failLogs) throw new Error('日志读取失败');
      const query = new URL(url, 'http://localhost').searchParams;
      return { logs: structuredClone(logFixture), total: logTotal, page: Number(query.get('page')), pageSize: Number(query.get('pageSize')), actions: [{ value: 'article.schedule.publish', label: '定时发布 <记录>' }] };
    }
    if (url.startsWith('/api/admin/feedback?')) {
      if (pendingFeedback) await new Promise(resolve => { finishFeedback = resolve; });
      const query = new URL(url, 'http://localhost').searchParams;
      const page = Number(query.get('page')); const size = Number(query.get('pageSize'));
      const visible = feedbackRecords.filter(item => !query.get('status') || item.status === query.get('status'));
      return { feedback: structuredClone(paginateFeedback ? visible.slice((page - 1) * size, page * size) : visible), total: paginateFeedback ? visible.length : 26, page, pageSize: size };
    }
    if (url === '/api/admin/feedback/feedback-1' && method === 'PATCH') {
      if (pendingFeedbackRead) await new Promise(resolve => { finishFeedbackRead = resolve; });
      if (failFeedbackRead) throw new Error('已读状态保存失败');
      const updated = { ...feedbackRecords.find(item => item.id === 'feedback-1'), status: options.data.status, readBy: { id: 'user-1', username: 'owner' }, readAt: '2026-10-10T01:00:00.000Z' };
      feedbackRecords = feedbackRecords.map(item => item.id === updated.id ? updated : item);
      return { feedback: updated };
    }
    if (url.endsWith('/review')) { if (failReview) throw new Error('审批保存失败'); return { request: { ...request, status: options.data.decision === 'approve' ? 'approved' : 'rejected', note: options.data.note, reviewedBy: { id: 'user-1', username: 'owner' }, reviewedAt: '2026-10-10T02:00:00.000Z' } }; }
    if (url === '/api/admin/users' && method === 'GET') return { users: structuredClone(userRecords) };
    if (url === '/api/admin/users' && method === 'POST') { if (pendingCreate) await new Promise(resolve => { finishCreate = resolve; }); if (failCreate) throw new Error('账号已存在'); const user = { id: 'new-user', username: options.data.username, role: options.data.role, disabled: false, createdAt: '2026-10-10T00:00:00.000Z' }; userRecords.push(user); return { user }; }
    if (url.startsWith('/api/admin/users/') && method === 'PUT') { const id = url.split('/').at(-1); const user = { ...userRecords.find(item => item.id === id), ...options.data }; userRecords = userRecords.map(item => item.id === id ? user : item); return { user }; }
    if (url.startsWith('/api/admin/users/') && method === 'DELETE') { userRecords = userRecords.filter(item => item.id !== url.split('/').at(-1)); return { ok: true }; }
    throw new Error(`Unexpected API ${method} ${url}`);
  };
  const controller = createAdminManagement({ document, api, getSession: () => currentSession, toast: message => { node('#toast').textContent = message; }, openModal: (_, content, onConfirm) => { modal = content; action = onConfirm; }, closeModal: () => { closed = true; }, onArticlesChanged: async () => { articleRefreshes++; }, onBusyChange: value => { busyChanges.push(value); } });
  return { node, controller, calls, busyChanges, confirm: () => action(), get modal() { return modal; }, get closed() { return closed; }, get articleRefreshes() { return articleRefreshes; }, switchRole(role) { currentSession.role = role; }, switchAccount() { currentSession = { ...currentSession, userId: 'other-user', username: 'other' }; }, finishRequests: () => finishRequests?.(), finishCreate: () => finishCreate?.(), finishLogs: () => finishLogs?.(), finishFeedback: () => finishFeedback?.(), finishFeedbackRead: () => finishFeedbackRead?.() };
}

test('senior administrators see and approve another account request', async () => {
  const site = await management({ role: 'senioradmin' });
  await site.controller.loadRequests();
  assert.match(site.node('#requests-table').innerHTML, /data-request="request-1"/);
  site.controller.handleClick({ dataset: { request: 'request-1' } });
  assert.match(site.modal, /data-review-decision="approve"/);
  site.controller.handleClick({ dataset: { reviewRequest: 'request-1', reviewDecision: 'approve' } });
  await site.confirm();
  assert.equal(site.calls.find(call => call.url.endsWith('/review'))?.data.decision, 'approve');
  assert.equal(site.articleRefreshes, 1);
});

test('senior administrators read logs with the senior actor label and mark feedback unread', async () => {
  const site = await management({ role: 'senioradmin', logFixture: [{ ...logEntry, actor: { id: 'senior-1', username: 'senior', role: 'senioradmin' } }], feedbackFixture: [{ ...feedbackEntry, status: 'read' }] });
  await site.controller.loadLogs();
  assert.match(site.node('#logs-table').innerHTML, /senior<span class="request-kind">高级管理员<\/span>/);
  await site.controller.loadFeedback();
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  assert.match(site.modal, /data-feedback-status="new"/);
  await site.controller.handleClick({ dataset: { feedbackStatus: 'new', feedbackId: 'feedback-1' } });
  assert.deepEqual(site.calls.find(call => call.method === 'PATCH')?.data, { status: 'new' });
  assert.match(site.modal, /未读/);
});

test('senior creation offers ordinary and senior roles and blocks a forged superadmin choice', async () => {
  for (const role of ['admin', 'senioradmin', 'superadmin']) {
    const site = await management({ role: 'senioradmin' });
    await site.controller.loadUsers();
    assert.match(site.node('#create-role').innerHTML, /value="admin"/);
    assert.match(site.node('#create-role').innerHTML, /value="senioradmin"/);
    assert.doesNotMatch(site.node('#create-role').innerHTML, /value="superadmin"/);
    site.node('#create-username').value = 'created_admin'; site.node('#create-password').value = 'long-password'; site.node('#create-role').value = role;
    await site.node('#create-user-form').listeners.submit({ preventDefault() {} });
    if (role === 'superadmin') {
      assert.equal(site.calls.some(call => call.method === 'POST'), false);
      assert.match(site.node('#create-user-error').textContent, /权限|等级/);
    } else {
      assert.equal(site.calls.find(call => call.method === 'POST')?.data.role, role);
      assert.match(site.node('#users-table').innerHTML, /created_admin/);
      if (role === 'senioradmin') assert.match(site.node('#users-table').innerHTML, /高级管理员/);
    }
  }
});

test('senior account changes omit role entirely while preserving ordinary or senior levels', async () => {
  for (const role of ['admin', 'senioradmin']) {
    const site = await management({ role: 'senioradmin', userFixture: [{ id: 'user-2', username: 'editor', role, disabled: false }] });
    await site.controller.loadUsers();
    site.controller.handleClick({ dataset: { editUser: 'user-2' } });
    assert.doesNotMatch(site.modal, /id="edit-user-role"/);
    assert.match(site.modal, /等级.*超级管理员/);
    site.node('#edit-user-role').value = 'superadmin';
    site.node('#edit-user-disabled').value = 'true'; site.node('#edit-user-password').value = 'replacement-password';
    await site.confirm();
    assert.deepEqual(site.calls.find(call => call.method === 'PUT')?.data, { disabled: true, newPassword: 'replacement-password' });
    assert.match(site.node('#users-table').innerHTML, role === 'senioradmin' ? /高级管理员/ : /普通管理员/);
    assert.doesNotMatch(site.node('#users-table').innerHTML, /超级管理员/);
  }
});

test('senior administrators cannot edit or delete superadmin accounts or their own account', async () => {
  const site = await management({ role: 'senioradmin', userFixture: [{ id: 'user-1', username: 'owner', role: 'senioradmin', disabled: false }, { id: 'user-3', username: 'super_owner', role: 'superadmin', disabled: false }] });
  await site.controller.loadUsers();
  assert.doesNotMatch(site.node('#users-table').innerHTML, /data-(?:edit|delete)-user=/);
  assert.match(site.node('#users-table').innerHTML, /超级管理员.*管理|仅.*超级管理员/);
  for (const id of ['user-1', 'user-3']) {
    site.controller.handleClick({ dataset: { editUser: id } });
    site.controller.handleClick({ dataset: { deleteUser: id } });
  }
  assert.equal(site.modal, '');
  assert.equal(site.calls.some(call => call.method !== 'GET'), false);
});

test('superadmins can choose any of the three levels for another account', async () => {
  for (const role of ['admin', 'senioradmin', 'superadmin']) {
    const site = await management();
    await site.controller.loadUsers();
    assert.match(site.node('#create-role').innerHTML, /value="senioradmin"/);
    assert.match(site.node('#create-role').innerHTML, /value="superadmin"/);
    site.controller.handleClick({ dataset: { editUser: 'user-2' } });
    assert.match(site.modal, /value="senioradmin"/);
    site.node('#edit-user-role').value = role; site.node('#edit-user-disabled').value = 'false';
    await site.confirm();
    assert.deepEqual(site.calls.find(call => call.method === 'PUT')?.data, { role, disabled: false });
  }
});

test('a senior confirmation rechecks changed permissions before sending a user mutation', async () => {
  const site = await management({ role: 'senioradmin' });
  await site.controller.loadUsers(); site.controller.handleClick({ dataset: { editUser: 'user-2' } });
  assert.match(site.modal, /edit-user-disabled/);
  site.switchRole('admin');
  await assert.rejects(site.confirm(), /权限/);
  assert.equal(site.calls.some(call => call.method !== 'GET'), false);
});

// Removing the request owner filter would expose another administrator's request.
test('ordinary request lists contain only the current user requests and their rejection reason', async () => {
  const site = await management({ role: 'admin' });
  await site.controller.loadRequests();
  assert.doesNotMatch(site.node('#requests-table').innerHTML, /data-request="request-1"/);
  assert.match(site.node('#requests-table').innerHTML, /data-request="own-1"/);
  assert.match(site.node('#requests-table').innerHTML, /请核对来源/);
  site.controller.handleClick({ dataset: { request: 'own-1' } });
  assert.match(site.modal, /第一段完整正文/);
  assert.doesNotMatch(site.modal, /data-review-decision/);
});

test('superadmins inspect an escaped deletion snapshot and confirm approval with a reason', async () => {
  const site = await management();
  await site.controller.loadRequests();
  site.controller.handleClick({ dataset: { request: 'request-1' } });
  assert.match(site.modal, /第一段完整正文/);
  assert.match(site.modal, /&lt;script&gt;/);
  assert.match(site.modal, /删除/);
  site.node('#review-note').value = '内容重复，确认删除';
  site.controller.handleClick({ dataset: { reviewRequest: 'request-1', reviewDecision: 'approve' } });
  assert.match(site.modal, /确认/);
  site.node('#review-note').value = '内容重复，确认删除';
  await site.confirm();
  const review = site.calls.find(call => call.url.endsWith('/review'));
  assert.deepEqual(review.data, { decision: 'approve', note: '内容重复，确认删除' });
  assert.equal(site.closed, true);
  assert.equal(site.articleRefreshes, 1);
});

test('failed review leaves the entered rejection reason and confirmation available', async () => {
  const site = await management({ failReview: true });
  await site.controller.loadRequests();
  site.controller.handleClick({ dataset: { request: 'request-1' } });
  site.node('#review-note').value = '缺少依据';
  site.controller.handleClick({ dataset: { reviewRequest: 'request-1', reviewDecision: 'reject' } });
  site.node('#review-note').value = '缺少依据';
  await assert.rejects(site.confirm(), /审批保存失败/);
  assert.equal(site.node('#review-note').value, '缺少依据');
  assert.equal(site.closed, false);
});

test('self management actions are absent and forged own-account actions do not issue a mutation', async () => {
  const site = await management();
  await site.controller.loadUsers();
  assert.doesNotMatch(site.node('#users-table').innerHTML, /data-(?:edit|delete)-user="user-1"/);
  assert.match(site.node('#users-table').innerHTML, /data-edit-user="user-2"/);
  site.controller.handleClick({ dataset: { deleteUser: 'user-1' } });
  site.controller.handleClick({ dataset: { editUser: 'user-1' } });
  assert.equal(site.modal, '');
  assert.equal(site.calls.some(call => call.method !== 'GET'), false);
});

test('a failed account creation keeps all fields for correction', async () => {
  const site = await management({ failCreate: true });
  site.node('#create-username').value = 'editor';
  site.node('#create-password').value = 'long-password';
  await site.node('#create-user-form').listeners.submit({ preventDefault() {} });
  assert.equal(site.node('#create-username').value, 'editor');
  assert.equal(site.node('#create-password').value, 'long-password');
  assert.match(site.node('#create-user-error').textContent, /已存在/);
});

test('other accounts can receive role/status changes and a replacement password', async () => {
  const site = await management();
  await site.controller.loadUsers();
  site.controller.handleClick({ dataset: { editUser: 'user-2' } });
  site.node('#edit-user-role').value = 'superadmin';
  site.node('#edit-user-disabled').value = 'true';
  site.node('#edit-user-password').value = 'replacement-password';
  await site.confirm();
  assert.deepEqual(site.calls.find(call => call.method === 'PUT').data, { role: 'superadmin', disabled: true, newPassword: 'replacement-password' });
  assert.equal(site.closed, true);
});

test('superadmin role changes send the selected level through the real management action', async () => {
  const site = await management({ role: 'superadmin', userFixture: [{ id: 'user-1', username: 'owner', role: 'superadmin', disabled: false }, { id: 'user-2', username: 'editor', role: 'admin', disabled: false }] });
  await site.controller.loadUsers();
  site.controller.handleClick({ dataset: { editUser: 'user-2' } });
  assert.match(site.modal, /id="edit-user-role"/);
  site.node('#edit-user-role').value = 'senioradmin';
  site.node('#edit-user-disabled').value = 'false';
  await site.confirm();
  const update = site.calls.find(call => call.method === 'PUT' && call.url.includes('/api/admin/users/user-2'));
  assert.deepEqual(update?.data, { role: 'senioradmin', disabled: false });
});

test('superadmin has a dedicated role action that sends only the selected level', async () => {
  const site = await management({ role: 'superadmin' });
  await site.controller.loadUsers();
  site.controller.handleClick({ dataset: { roleUser: 'user-2' } });
  assert.match(site.modal, /修改 editor 的等级/);
  site.node('#edit-user-role').value = 'senioradmin';
  await site.confirm();
  const update = site.calls.find(call => call.method === 'PUT' && call.url.includes('/api/admin/users/user-2'));
  assert.deepEqual(update?.data, { role: 'senioradmin' });
});

test('late approval data is discarded after the management controller is cleared', async () => {
  const site = await management({ pendingRequests: true });
  const loading = site.controller.loadRequests();
  site.switchAccount(); site.controller.clear(); site.finishRequests();
  await loading;
  assert.equal(site.node('#requests-table').innerHTML, '');
  assert.equal(site.node('#refresh-requests').disabled, false);
});

test('late account creation cannot unlock a different account mutation or display its success', async () => {
  const site = await management({ pendingCreate: true });
  site.node('#create-username').value = 'editor'; site.node('#create-password').value = 'long-password';
  const creating = site.node('#create-user-form').listeners.submit({ preventDefault() {} });
  site.switchAccount(); site.controller.clear();
  const changesAfterClear = site.busyChanges.length;
  site.finishCreate(); await creating;
  assert.equal(site.node('#users-table').innerHTML, '');
  assert.equal(site.node('#toast').textContent, '');
  assert.equal(site.busyChanges.length, changesAfterClear, 'an old response must not change the new session navigation lock');
});

// Treating every approved publication as immediate would disclose a scheduled
// article early and hide the important elapsed-time approval behavior.
test('scheduled request details and approval explain the full Beijing time and due-time behavior', async () => {
  const scheduledRequest = { ...request, type: 'publish', article: { ...article, status: 'scheduled', scheduledAt: '2099-10-11T01:30:00.000Z' } };
  const site = await management({ requestFixture: [scheduledRequest] });
  await site.controller.loadRequests();
  site.controller.handleClick({ dataset: { request: 'request-1' } });
  assert.match(site.modal, /2099/);
  assert.match(site.modal, /09:30/);
  assert.match(site.modal, /北京时间/);
  assert.match(site.modal, /到时/);
  assert.match(site.modal, /已过.*立即发布/);
  site.controller.handleClick({ dataset: { reviewRequest: 'request-1', reviewDecision: 'approve' } });
  assert.match(site.modal, /09:30/);
  assert.match(site.modal, /已过.*立即发布/);
});

test('operation logs render safe content and Beijing time including system actors', async () => {
  const site = await management();
  assert.equal(typeof site.controller.loadLogs, 'function');
  await site.controller.loadLogs();
  const html = site.node('#logs-table').innerHTML;
  assert.match(html, /08:00/);
  assert.match(html, /系统/);
  assert.match(html, /定时发布/);
  assert.match(html, /&lt;发布目标&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script|href=/);
  assert.match(site.node('#log-action-filter').innerHTML, /&lt;记录&gt;/);
  assert.match(site.node('#logs-status').textContent, /26/);
  assert.equal(site.node('#logs-next').disabled, false, 'total controls paging even when a page contains one entry');
  assert.equal(site.node('#logs-previous').disabled, true);
});

test('operation logs label anonymous actors as visitors while preserving administrator and system roles', async () => {
  const site = await management({ logFixture: [
    { ...logEntry, id: 'visitor-log', actor: { id: '', username: '访客', role: 'anonymous' } },
    { ...logEntry, id: 'owner-log', actor: { id: 'owner-1', username: 'owner', role: 'superadmin' } },
    { ...logEntry, id: 'editor-log', actor: { id: 'editor-1', username: 'editor', role: 'admin' } },
    logEntry
  ] });
  await site.controller.loadLogs();
  const html = site.node('#logs-table').innerHTML;
  assert.match(html, /访客<span class="request-kind">访客<\/span>/);
  assert.match(html, /owner<span class="request-kind">超级管理员<\/span>/);
  assert.match(html, /editor<span class="request-kind">普通管理员<\/span>/);
  assert.match(html, /系统<span class="request-kind">系统任务<\/span>/);
});

test('log filters issue encoded queries and reset the page while paging uses server totals', async () => {
  const site = await management();
  assert.equal(typeof site.controller.loadLogs, 'function');
  await site.controller.loadLogs();
  await site.node('#logs-next').listeners.click();
  let query = new URL(site.calls.at(-1).url, 'http://localhost').searchParams;
  assert.equal(query.get('page'), '2');
  assert.equal(site.node('#logs-next').disabled, true);
  assert.equal(site.node('#logs-previous').disabled, false);
  site.node('#log-search').value = '政府 & <意见>';
  site.node('#log-action-filter').value = 'article.schedule.publish';
  site.node('#log-result-filter').value = 'failure';
  await site.node('#logs-filter-form').listeners.submit({ preventDefault() {} });
  query = new URL(site.calls.at(-1).url, 'http://localhost').searchParams;
  assert.equal(query.get('page'), '1');
  assert.equal(query.get('pageSize'), '25');
  assert.equal(query.get('action'), 'article.schedule.publish');
  assert.equal(query.get('result'), 'failure');
  assert.equal(query.get('search'), '政府 & <意见>');
});

test('empty and failed log loads display usable states with an available refresh', async () => {
  const empty = await management({ logFixture: [], logTotal: 0 });
  assert.equal(typeof empty.controller.loadLogs, 'function');
  await empty.controller.loadLogs();
  assert.equal(empty.node('#logs-empty').hidden, false);
  assert.equal(empty.node('#logs-next').disabled, true);
  const failed = await management({ failLogs: true });
  await failed.controller.loadLogs();
  assert.match(failed.node('#logs-error').textContent, /日志读取失败/);
  assert.equal(failed.node('#refresh-logs').disabled, false);
});

test('ordinary administrators cannot request operation logs', async () => {
  const site = await management({ role: 'admin' });
  assert.equal(typeof site.controller.loadLogs, 'function');
  await site.controller.loadLogs();
  assert.equal(site.calls.length, 0);
});

test('a late log response cannot repopulate another account or restore old filters', async () => {
  const site = await management({ pendingLogs: true });
  assert.equal(typeof site.controller.loadLogs, 'function');
  const loading = site.controller.loadLogs();
  site.switchAccount(); site.controller.clear(); site.finishLogs(); await loading;
  assert.equal(site.node('#logs-table').innerHTML, '');
  assert.equal(site.node('#log-action-filter').value, '');
  assert.equal(site.node('#log-search').value, '');
  assert.equal(site.node('#refresh-logs').disabled, false);
});

test('ordinary administrators inspect full feedback and mark it read without delete controls', async () => {
  const site = await management({ role: 'admin' });
  assert.equal(typeof site.controller.loadFeedback, 'function');
  await site.controller.loadFeedback();
  assert.match(site.node('#feedback-table').innerHTML, /&lt;改进建议&gt;/);
  assert.doesNotMatch(site.node('#feedback-table').innerHTML, /data-delete|删除/);
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  assert.match(site.modal, /第一段完整意见/);
  assert.match(site.modal, /&lt;script&gt;/);
  assert.doesNotMatch(site.modal, /<script|data-feedback-status="new"|删除/);
  await site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  const mutation = site.calls.find(call => call.method === 'PATCH');
  assert.equal(mutation.url, '/api/admin/feedback/feedback-1');
  assert.deepEqual(mutation.data, { status: 'read' });
  assert.match(site.modal, /已读/);
  assert.match(site.modal, /owner/);
});

// Hiding identity fields inside a title subtitle makes them easy to miss.
// Both roles need independent identity cells that survive a status refresh.
for (const role of ['admin', 'senioradmin', 'superadmin']) {
  test(`${role} sees independent game name and QQ columns and full details after marking read`, async () => {
    const site = await management({ role, feedbackFixture: [{ ...feedbackEntry, gameName: 'Player_花生', qq: '00123456789' }] });
    await site.controller.loadFeedback();
    assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="游戏名称"[^>]*>Player_花生<\/td>/);
    assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="QQ号"[^>]*>00123456789<\/td>/);
    site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
    assert.match(site.modal, /<dt>游戏名称<\/dt><dd>Player_花生<\/dd>/);
    assert.match(site.modal, /<dt>QQ号<\/dt><dd>00123456789<\/dd>/);
    await site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
    assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="游戏名称"[^>]*>Player_花生<\/td>/);
    assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="QQ号"[^>]*>00123456789<\/td>/);
    assert.match(site.modal, /<dt>游戏名称<\/dt><dd>Player_花生<\/dd>/);
    assert.match(site.modal, /<dt>QQ号<\/dt><dd>00123456789<\/dd>/);
    assert.match(site.modal, /<dt>阅读人<\/dt><dd>owner<\/dd>/);
    assert.doesNotMatch(site.modal, /旧版未采集/);
  });
}

// Rendering stored identity values as HTML would permit script-bearing markup
// to execute in an administrator's session.
test('feedback game names and QQ remain escaped text in lists and details', async () => {
  const site = await management({ feedbackFixture: [{ ...feedbackEntry, gameName: '<img src=x onerror="alert(1)"> & 玩家', qq: '<a href="javascript:alert(2)">12345</a>' }] });
  await site.controller.loadFeedback();
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  for (const html of [site.node('#feedback-table').innerHTML, site.modal]) {
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; 玩家/);
    assert.match(html, /&lt;a href=&quot;javascript:alert\(2\)&quot;&gt;12345&lt;\/a&gt;/);
    assert.doesNotMatch(html, /<img|<a\s|<script/);
  }
  assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="游戏名称"[^>]*>&lt;img/);
  assert.match(site.node('#feedback-table').innerHTML, /<td\b[^>]*data-label="QQ号"[^>]*>&lt;a/);
});

// Inventing a submitter identity or showing undefined for pre-change records
// would mislead administrators who are reading the historical feedback archive.
test('historical feedback identifies both missing identity fields in lists and details', async () => {
  const site = await management({ feedbackFixture: [feedbackEntry] });
  await site.controller.loadFeedback();
  const html = site.node('#feedback-table').innerHTML;
  assert.match(html, /<td\b[^>]*data-label="游戏名称"[^>]*>旧版未采集<\/td>/);
  assert.match(html, /<td\b[^>]*data-label="QQ号"[^>]*>旧版未采集<\/td>/);
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  assert.match(site.modal, /<dt>游戏名称<\/dt><dd>旧版未采集<\/dd>/);
  assert.match(site.modal, /<dt>QQ号<\/dt><dd>旧版未采集<\/dd>/);
  assert.match(site.modal, /旧版留言.*未采集游戏名称和 QQ 号/);
  assert.doesNotMatch(site.modal, /undefined|null/);
});

test('ordinary administrators cannot forge marking feedback unread and failed reads retain details', async () => {
  const site = await management({ role: 'admin', failFeedbackRead: true });
  assert.equal(typeof site.controller.loadFeedback, 'function');
  await site.controller.loadFeedback();
  await site.controller.handleClick({ dataset: { feedbackStatus: 'new', feedbackId: 'feedback-1' } });
  assert.equal(site.calls.some(call => call.method === 'PATCH'), false);
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  await site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  assert.match(site.node('#feedback-detail-error').textContent, /保存失败/);
  assert.match(site.modal, /第一段完整意见/);
});

test('feedback search and status filters reset pagination and late data is discarded', async () => {
  const site = await management();
  assert.equal(typeof site.controller.loadFeedback, 'function');
  await site.controller.loadFeedback();
  await site.node('#feedback-next').listeners.click();
  assert.equal(new URL(site.calls.at(-1).url, 'http://localhost').searchParams.get('page'), '2');
  site.node('#feedback-search').value = '服务 & 建议'; site.node('#feedback-status-filter').value = 'new';
  await site.node('#feedback-filter-form').listeners.submit({ preventDefault() {} });
  const query = new URL(site.calls.at(-1).url, 'http://localhost').searchParams;
  assert.equal(query.get('page'), '1'); assert.equal(query.get('status'), 'new'); assert.equal(query.get('search'), '服务 & 建议');
  const pending = await management({ pendingFeedback: true });
  const loading = pending.controller.loadFeedback();
  pending.switchAccount(); pending.controller.clear(); pending.finishFeedback(); await loading;
  assert.equal(pending.node('#feedback-table').innerHTML, '');
  assert.equal(pending.node('#feedback-search').value, '');
});

test('a superadmin can mark an opinion unread from its still-open detail after it leaves the unread list', async () => {
  const site = await management();
  site.node('#feedback-status-filter').value = 'new';
  await site.controller.loadFeedback();
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  await site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  assert.doesNotMatch(site.node('#feedback-table').innerHTML, /data-feedback="feedback-1"/);
  assert.match(site.modal, /data-feedback-status="new"/);
  await site.controller.handleClick({ dataset: { feedbackStatus: 'new', feedbackId: 'feedback-1' } });
  assert.equal(site.calls.filter(call => call.method === 'PATCH').length, 2);
  assert.match(site.node('#feedback-table').innerHTML, /data-feedback="feedback-1"/);
  assert.match(site.modal, /未读/);
});

test('marking the last unread item on the final feedback page returns to a valid page', async () => {
  const fixtures = Array.from({ length: 26 }, (_, index) => ({ ...feedbackEntry, id: index === 25 ? 'feedback-1' : `feedback-${index + 2}`, title: `意见 ${index + 1}` }));
  const site = await management({ feedbackFixture: fixtures, paginateFeedback: true });
  site.node('#feedback-status-filter').value = 'new';
  await site.controller.loadFeedback(); await site.node('#feedback-next').listeners.click();
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  await site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  assert.match(site.node('#feedback-page').textContent, /第 1 \/ 1 页/);
  assert.match(site.node('#feedback-table').innerHTML, /意见 1/);
  assert.equal(site.node('#feedback-next').disabled, true);
});

test('late feedback read responses do not unlock or display success in a different account', async () => {
  const site = await management({ pendingFeedbackRead: true });
  await site.controller.loadFeedback();
  site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  const marking = site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  site.switchAccount(); site.controller.clear(); const changesAfterClear = site.busyChanges.length;
  site.finishFeedbackRead(); await marking;
  assert.equal(site.node('#feedback-table').innerHTML, '');
  assert.equal(site.node('#toast').textContent, '');
  assert.equal(site.busyChanges.length, changesAfterClear);
});

test('closing feedback detail while marking read does not reopen the modal when it completes', async () => {
  const site = await management({ pendingFeedbackRead: true });
  await site.controller.loadFeedback(); site.controller.handleClick({ dataset: { feedback: 'feedback-1' } });
  const original = site.modal;
  const marking = site.controller.handleClick({ dataset: { feedbackStatus: 'read', feedbackId: 'feedback-1' } });
  site.controller.closeDetails(); site.finishFeedbackRead(); await marking;
  assert.equal(site.modal, original, 'a closed detail must not be reopened or replaced by a delayed update');
  assert.match(site.node('#feedback-table').innerHTML, /已读/);
});
