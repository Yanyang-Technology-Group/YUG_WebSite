import { randomUUID } from 'node:crypto';
import { HttpError } from './articles.mjs';
export const auditActions = {
  'account.setup': '首次设置超级管理员', 'account.login': '登录', 'account.logout': '退出登录',
  'account.create': '创建管理员', 'account.update': '修改账号权限或密码', 'account.delete': '删除管理员', 'account.password': '修改自己的密码',
  'article.create': '创建文章', 'article.update': '修改文章或发布计划', 'article.delete': '删除文章', 'article.auto_publish': '定时自动发布',
  'article.translate': '文章自动翻译', 'article.translate_retry': '重新生成文章译文',
  'translation.configure': '修改翻译设置', 'translation.test': '测试翻译连接', 'translation.discover': '自动识别翻译模型',
  'request.publish': '提交发布申请', 'request.delete': '提交删除申请', 'request.approve': '批准内容申请', 'request.reject': '驳回内容申请',
  'site.update': '修改网站内容', 'backup.export': '导出内容备份', 'backup.import': '恢复内容备份', 'deployment.export': '下载部署包',
  'feedback.submit': '提交意见反馈', 'feedback.read': '反馈标为已读', 'feedback.unread': '反馈标为未读'
};
const maxBytes = 16 * 1024 * 1024;
const boundedText = (value, max) => typeof value === 'string' && value.length <= max;
export function validateLogs(values) {
  if (!Array.isArray(values) || values.length > 10000) throw new HttpError(400, '操作日志数量或格式不正确。');
  const ids = new Set();
  const logs = values.map(value => {
    if (!value || !boundedText(value.id, 80) || !/^[A-Za-z0-9_-]+$/.test(value.id) || ids.has(value.id) || !Object.hasOwn(auditActions, value.action) || !['success', 'failure'].includes(value.result)
      || !value.actor || !boundedText(value.actor.id, 80) || !boundedText(value.actor.username, 80) || !['admin', 'senioradmin', 'superadmin', 'system', 'anonymous'].includes(value.actor.role)
      || !value.target || !boundedText(value.target.type, 30) || !boundedText(value.target.id, 80) || !boundedText(value.target.title, 200) || !boundedText(value.message, 500)
      || typeof value.at !== 'string' || value.at.length !== 24 || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) throw new HttpError(400, '操作日志格式不正确。');
    ids.add(value.id);
    return { id: value.id, at: value.at, actor: { id: value.actor.id, username: value.actor.username, role: value.actor.role }, action: value.action, actionLabel: auditActions[value.action], target: { type: value.target.type, id: value.target.id, title: value.target.title }, result: value.result, message: value.message };
  });
  if (Buffer.byteLength(JSON.stringify({ version: 1, logs }, null, 2) + '\n') > maxBytes) throw new HttpError(400, '操作日志总容量不能超过 16 MiB。');
  return logs;
}
export function appendAudit(logs, events, now = Date.now()) {
  const incoming = (Array.isArray(events) ? events : [events]).filter(Boolean).map(event => ({ id: randomUUID(), at: new Date(now).toISOString(), actor: event.actor || { id: 'system', username: '自动发布', role: 'system' }, action: event.action, actionLabel: auditActions[event.action], target: { type: event.target?.type || 'site', id: event.target?.id || '', title: event.target?.title || '' }, result: event.result || 'success', message: event.message || '' }));
  validateLogs(incoming);
  let result = [...logs, ...incoming].slice(-10000);
  while (Buffer.byteLength(JSON.stringify({ version: 1, logs: result }, null, 2) + '\n') > maxBytes) result = result.slice(Math.max(1, Math.floor(result.length / 10)));
  return result;
}
export function pageOptions(parameters) {
  const parse = (key, fallback, max) => {
    const value = parameters.get(key);
    if (value === null) return fallback;
    if (!/^[1-9]\d{0,8}$/.test(value) || Number(value) > max) throw new HttpError(400, '分页参数不正确。');
    return Number(value);
  };
  const search = (parameters.get('search') || '').trim();
  if (search.length > 200) throw new HttpError(400, '搜索文字不能超过 200 字。');
  return { page: parse('page', 1, 100000000), pageSize: parse('pageSize', 25, 100), search: search.toLowerCase() };
}
export function logPage(logs, parameters) {
  const { page, pageSize, search } = pageOptions(parameters);
  const action = parameters.get('action') || ''; const result = parameters.get('result') || '';
  if (action && !Object.hasOwn(auditActions, action) || result && !['success', 'failure'].includes(result)) throw new HttpError(400, '日志筛选条件不正确。');
  const filtered = [...logs].reverse().filter(log => (!action || log.action === action) && (!result || log.result === result) && (!search || [log.actor.username, log.actionLabel, log.target.title, log.target.id, log.message].join(' ').toLowerCase().includes(search)));
  return { logs: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, actions: Object.entries(auditActions).map(([value, label]) => ({ value, label })) };
}
